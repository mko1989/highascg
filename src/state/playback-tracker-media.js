/**
 * Clip identity + duration resolution for playback-tracker (CINF, CLS cache, disk probe).
 */

'use strict'

const { parseCinfMedia } = require('../media/cinf-parse')
const { canonicalMediaBasenameKey } = require('../utils/media-browser-dedupe')

/**
 * @param {string} clip
 * @returns {boolean}
 */
function isRouteClip(clip) {
	return String(clip || '').trim().startsWith('route://')
}

/** First path token of a Caspar clip id, NFC-normalized for comparison with CLS / disk. */
function mediaIdKey(clipId) {
	const raw = String(clipId || '').replace(/^"(.*)"$/, '$1').trim()
	return raw.split(/\s+/)[0].replace(/^"|"$/g, '').normalize('NFC')
}

/** @param {string} a @param {string} b */
function mediaIdsMatch(a, b) {
	return mediaIdKey(a) === mediaIdKey(b)
}

function cinfResponseToStr(data) {
	if (data == null) return ''
	if (Array.isArray(data)) return data.join('\n')
	return String(data)
}

/**
 * HTTP state media list (browser) often has durationMs while mediaDetails keys are UTF-8
 * and the running clip id from Caspar can be mojibake — basename match bridges some cases.
 * @param {{ state?: { getState?: () => { media?: Array<{ id?: string, durationMs?: number, cinf?: string }> } } }} ctx
 * @param {string} clipId
 * @returns {number | null}
 */
function tryDurationFromStateMedia(ctx, clipId) {
	try {
		const list = ctx.state?.getState?.()?.media
		if (!Array.isArray(list)) return null
		const raw = String(clipId).replace(/^"(.*)"$/, '$1').trim().split(/\s+/)[0].replace(/^"|"$/g, '')
		const wantBase = canonicalMediaBasenameKey(raw)
		for (const m of list) {
			if (!m?.id) continue
			if (m.id !== raw && m.id !== clipId && canonicalMediaBasenameKey(m.id) !== wantBase) continue
			if (m.durationMs > 0) return m.durationMs
			if (m.cinf) {
				const p = parseCinfMedia(String(m.cinf))
				if (p.durationMs > 0) return p.durationMs
			}
		}
	} catch {
		/* ignore */
	}
	return null
}

/**
 * Ask Caspar for CINF using the **exact** clip token it is playing — matches ffmpeg/CLS even when
 * our mediaDetails map uses a different Unicode spelling than AMCP reports.
 * @param {{ amcp?: { query?: { cinf?: (id: string) => Promise<unknown> }, isOffline?: boolean }, _mediaProbeCache?: Record<string, { durationMs?: number }> }} ctx
 * @param {string} clipId
 * @returns {Promise<number | null>}
 */
async function resolveClipDurationMsWithAmcpCinf(ctx, clipId) {
	if (!clipId || isRouteClip(clipId)) return null
	if (!ctx.amcp?.query?.cinf || ctx.amcp.isOffline) return null
	const rawToken = String(clipId).replace(/^"(.*)"$/, '$1').trim().split(/\s+/)[0].replace(/^"|"$/g, '')
	if (!rawToken) return null
	const id = mediaIdKey(clipId)
	try {
		const res = await ctx.amcp.query.cinf(rawToken)
		const str = cinfResponseToStr(res?.data)
		if (!str.trim()) return null
		const parsed = parseCinfMedia(str)
		if (parsed.durationMs > 0) {
			ctx._mediaProbeCache = ctx._mediaProbeCache || {}
			ctx._mediaProbeCache[id] = { ...(ctx._mediaProbeCache[id] || {}), durationMs: parsed.durationMs }
			return parsed.durationMs
		}
	} catch {
		/* CINF 404 / PARAMETER_ILLEGAL — fall through */
	}
	return null
}

/**
 * Caspar sometimes reports UTF-8 paths as if each byte were Latin-1 (mojibake). Try reversing that for disk lookup.
 * @param {string} id
 * @returns {string[]}
 */
function clipIdVariantsForDisk(id) {
	const s = String(id || '').trim()
	if (!s) return []
	const out = [...new Set([s, s.normalize('NFC'), s.normalize('NFD')])]
	try {
		const repaired = Buffer.from(s, 'latin1').toString('utf8')
		if (repaired && repaired !== s && !/[\uFFFD]/.test(repaired)) out.push(repaired, repaired.normalize('NFC'))
	} catch {
		/* ignore */
	}
	return out.filter(Boolean)
}

/**
 * @param {{ _mediaProbeCache?: Record<string, { durationMs?: number }>, mediaDetails?: Record<string, string>, CHOICES_MEDIAFILES?: Array<{ id: string, cinf?: string }> }} ctx
 * @param {string} clipId
 * @returns {number | null}
 */
function resolveClipDurationMs(ctx, clipId) {
	if (!clipId || isRouteClip(clipId)) return null
	const id = mediaIdKey(clipId)
	if (!id) return null
	const rawToken = String(clipId).replace(/^"(.*)"$/, '$1').trim().split(/\s+/)[0].replace(/^"|"$/g, '')
	const idMatchKeys = [...new Set([id, ...clipIdVariantsForDisk(rawToken).map((v) => mediaIdKey(v))])].filter(Boolean)

	const cache = ctx._mediaProbeCache || {}
	const cacheHit = Object.keys(cache).find((k) => idMatchKeys.some((ik) => mediaIdsMatch(k, ik)))
	if (cacheHit && cache[cacheHit]?.durationMs > 0) return cache[cacheHit].durationMs

	const mdKeys = Object.keys(ctx.mediaDetails || {})
	const mdKey = mdKeys.find((k) => idMatchKeys.some((ik) => mediaIdsMatch(k, ik)))
	const md = mdKey != null ? ctx.mediaDetails[mdKey] : undefined
	if (md) {
		const parsed = parseCinfMedia(typeof md === 'string' ? md : String(md))
		if (parsed.durationMs > 0) return parsed.durationMs
	}

	const files = ctx.CHOICES_MEDIAFILES || []
	const row = files.find((c) => idMatchKeys.some((ik) => mediaIdsMatch(c.id, ik)))
	if (row?.cinf) {
		const parsed = parseCinfMedia(row.cinf)
		if (parsed.durationMs > 0) return parsed.durationMs
	}

	const fromState = tryDurationFromStateMedia(ctx, clipId)
	if (fromState != null && fromState > 0) return fromState

	return null
}

/**
 * When duration is not in CLS/CINF/cache (common for Unicode paths or id mismatches), probe the file on disk once and cache.
 * @param {{ config?: object, _mediaProbeCache?: Record<string, { durationMs?: number }> }} ctx
 * @param {string} clipId
 * @returns {Promise<number | null>}
 */
async function resolveClipDurationMsWithDiskProbe(ctx, clipId) {
	const quick = resolveClipDurationMs(ctx, clipId)
	if (Number.isFinite(quick) && quick > 0) return quick
	if (!clipId || isRouteClip(clipId)) return null
	const fromAmcp = await resolveClipDurationMsWithAmcpCinf(ctx, clipId)
	if (Number.isFinite(fromAmcp) && fromAmcp > 0) return fromAmcp
	try {
		const { resolveMediaFileOnDisk, probeMedia } = require('../media/local-media')
		const id = mediaIdKey(clipId)
		if (!id) return null
		const rawToken = String(clipId).replace(/^"(.*)"$/, '$1').trim().split(/\s+/)[0].replace(/^"|"$/g, '')
		let filePath = null
		for (const cand of clipIdVariantsForDisk(rawToken)) {
			filePath = resolveMediaFileOnDisk(ctx.config || {}, cand)
			if (filePath) break
		}
		if (!filePath) return null
		const p = await probeMedia(filePath)
		const ms = p?.durationMs > 0 ? p.durationMs : null
		if (ms != null) {
			ctx._mediaProbeCache = ctx._mediaProbeCache || {}
			ctx._mediaProbeCache[id] = { ...(ctx._mediaProbeCache[id] || {}), durationMs: ms }
		}
		return ms
	} catch {
		return null
	}
}

module.exports = {
	isRouteClip,
	mediaIdKey,
	mediaIdsMatch,
	resolveClipDurationMs,
	resolveClipDurationMsWithDiskProbe,
}
