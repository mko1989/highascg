/**
 * Channel×layer playback matrix: AMCP PLAY/STOP intercepts, or Caspar OSC when enabled.
 * @see companion-module-casparcg-server/src/playback-tracker.js
 */

'use strict'

const { parseCinfMedia } = require('../media/cinf-parse')
const { canonicalMediaBasenameKey } = require('../utils/media-browser-dedupe')

/**
 * @param {{ oscState?: { getSnapshot?: () => object } | null }} ctx
 * @returns {boolean}
 */
function isOscPlaybackActive(ctx) {
	return !!(ctx && ctx.oscState && typeof ctx.oscState.getSnapshot === 'function')
}

/**
 * @param {object} layer — OSC stage layer aggregate
 * @returns {string}
 */
function pickClipFromOscLayer(layer) {
	const f = layer.file || {}
	if (f.name) return String(f.name)
	if (f.path) return String(f.path)
	const t = layer.template || {}
	if (t.path) return String(t.path)
	const typ = layer.type && String(layer.type) !== 'empty' ? String(layer.type) : ''
	return typ ? `[${typ}]` : ''
}

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

/**
 * @param {{ _playbackMatrix?: object, gatheredInfo?: { channelXml?: Record<string, string> }, state?: import('events').EventEmitter }} ctx
 * @param {number|string} channel
 * @param {number|string} layer
 * @param {string} clip
 * @param {{ loop?: boolean }} opts
 */
function recordPlay(ctx, channel, layer, clip, opts = {}) {
	const ch = parseInt(channel, 10)
	const ln = parseInt(layer, 10)
	if (!Number.isFinite(ch) || !Number.isFinite(ln)) return

	if (!ctx._playbackMatrix) ctx._playbackMatrix = {}
	const key = `${ch}-${ln}`
	const durationMs = resolveClipDurationMs(ctx, clip)
	ctx._playbackMatrix[key] = {
		channel: ch,
		layer: ln,
		clip: String(clip || ''),
		startedAt: Date.now(),
		durationMs,
		playing: true,
		loop: !!opts.loop,
		isRoute: isRouteClip(clip),
	}
	emitMatrix(ctx)
}

/**
 * @param {{ _playbackMatrix?: object, state?: import('events').EventEmitter }} ctx
 */
function recordStop(ctx, channel, layer) {
	const ch = parseInt(channel, 10)
	const ln = parseInt(layer, 10)
	if (!Number.isFinite(ch) || !Number.isFinite(ln)) return
	if (!ctx._playbackMatrix) return
	const key = `${ch}-${ln}`
	delete ctx._playbackMatrix[key]
	emitMatrix(ctx)
}

function emitMatrix(ctx) {
	const snapshot = getMatrixSnapshot(ctx)
	if (ctx.state && typeof ctx.state.emit === 'function') {
		ctx.state.emit('change', 'playback.matrix', snapshot)
	}
}

/**
 * Drop all AMCP-tracked layers for a Caspar channel (after CLEAR channel or equivalent).
 * @param {{ _playbackMatrix?: object, state?: import('events').EventEmitter }} ctx
 * @param {number|string} channel
 */
function clearChannelFromMatrix(ctx, channel) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || !ctx._playbackMatrix) return
	const prefix = `${ch}-`
	for (const key of Object.keys(ctx._playbackMatrix)) {
		if (key.startsWith(prefix)) delete ctx._playbackMatrix[key]
	}
	emitMatrix(ctx)
}

function getMatrixSnapshot(ctx) {
	return { ...(ctx._playbackMatrix || {}) }
}

/**
 * Whether OSC-reported clip id matches the clip used on take (path or basename).
 * @param {string} oscClip
 * @param {string} clipId
 */
function oscClipMatchesTakeClip(oscClip, clipId) {
	if (!oscClip || !clipId || isRouteClip(clipId)) return false
	if (mediaIdsMatch(oscClip, clipId)) return true
	const a = mediaIdKey(oscClip)
	const b = mediaIdKey(clipId)
	const ba = a.replace(/^.*[/\\]/, '')
	const bb = b.replace(/^.*[/\\]/, '')
	return Boolean(ba && bb && ba.normalize('NFC') === bb.normalize('NFC'))
}

/**
 * Milliseconds from **now** until the opacity fade should start (N frames before visible end),
 * from OSC `file/time`, `remaining`, or frame progress. Returns `null` if OSC inactive or timing unknown.
 * @param {{ oscState?: { getSnapshot?: () => object } }} ctx
 * @param {number} channel
 * @param {number} physLayer
 * @param {string} clipId
 * @param {number} fadeFrames
 * @param {number} framerate
 * @returns {number | null}
 */
function getOscClipEndFadeDelayMs(ctx, channel, physLayer, clipId, fadeFrames, framerate) {
	if (!isOscPlaybackActive(ctx) || !clipId) return null
	const snap = ctx.oscState.getSnapshot()
	const channels = (snap && snap.channels) || {}
	const chan = channels[channel] ?? channels[String(channel)]
	if (!chan || !chan.layers) return null
	const layer = chan.layers[physLayer] ?? chan.layers[String(physLayer)]
	if (!layer || typeof layer !== 'object') return null
	if (String(layer.type || '') === 'empty') return null
	const oscClip = pickClipFromOscLayer(layer)
	if (!oscClip || !oscClipMatchesTakeClip(oscClip, clipId)) return null

	const f = layer.file || {}
	if (f.loop === true || f.loop === 1) return null

	const fps = framerate > 0 ? framerate : 50
	const fadeDurMs = (Math.max(1, Number(fadeFrames)) / fps) * 1000

	let remainingMs = null
	if (Number.isFinite(f.remaining) && f.remaining >= 0) {
		remainingMs = f.remaining * 1000
	} else if (
		Number.isFinite(f.duration) &&
		f.duration > 0 &&
		Number.isFinite(f.elapsed) &&
		f.elapsed >= 0
	) {
		remainingMs = Math.max(0, f.duration - f.elapsed) * 1000
	} else if (Number.isFinite(f.duration) && f.duration > 0) {
		remainingMs = f.duration * 1000
	} else if (Number.isFinite(f.frameElapsed) && Number.isFinite(f.frameTotal) && f.frameTotal > 0) {
		const prog = f.frameElapsed / f.frameTotal
		if (Number.isFinite(f.elapsed) && prog > 0.001) {
			const totalSec = f.elapsed / prog
			remainingMs = Math.max(0, totalSec - f.elapsed) * 1000
		}
	}

	if (remainingMs == null || remainingMs <= 0) return null
	const delay = remainingMs - fadeDurMs
	if (remainingMs < fadeDurMs - 1e-6) return null
	return Math.max(0, delay)
}

/**
 * Build matrix from `/channel/N/stage/layer/L/...` OSC (authoritative when listener is on).
 * @param {{ oscState: { getSnapshot: () => object }, CHOICES_MEDIAFILES?: unknown, mediaDetails?: unknown, _mediaProbeCache?: unknown }} ctx
 */
function buildMatrixFromOsc(ctx) {
	const snap = ctx.oscState.getSnapshot()
	const out = {}
	const channels = (snap && snap.channels) || {}
	for (const k of Object.keys(channels)) {
		const ch = parseInt(k, 10)
		if (!Number.isFinite(ch)) continue
		const chan = channels[k]
		if (!chan || typeof chan !== 'object') continue
		const layers = chan.layers || {}
		for (const lid of Object.keys(layers)) {
			const ln = parseInt(lid, 10)
			if (!Number.isFinite(ln)) continue
			const layer = layers[lid]
			if (!layer || typeof layer !== 'object') continue
			const typ = String(layer.type || 'empty')
			if (typ === 'empty') continue
			const clip = pickClipFromOscLayer(layer)
			if (!clip) continue
			const key = `${ch}-${ln}`
			const f = layer.file || {}
			let durationSec = Number.isFinite(f.duration) ? f.duration : null
			const elapsedSec = Number.isFinite(f.elapsed) ? f.elapsed : null
			let durationMs =
				durationSec != null && durationSec > 0 ? Math.round(durationSec * 1000) : resolveClipDurationMs(ctx, clip)
			let progress = Number.isFinite(f.progress) ? f.progress : null
			if (progress == null && Number.isFinite(f.frameElapsed) && Number.isFinite(f.frameTotal) && f.frameTotal > 0) {
				progress = Math.min(1, Math.max(0, f.frameElapsed / f.frameTotal))
				if (durationMs == null && durationSec == null && Number.isFinite(elapsedSec) && progress > 0.001) {
					const tot = elapsedSec / progress
					if (Number.isFinite(tot) && tot > 0) {
						durationSec = tot
						durationMs = Math.round(tot * 1000)
					}
				}
			}
			let startedAt = Date.now()
			if (elapsedSec != null && elapsedSec >= 0 && durationMs != null && durationMs > 0) {
				startedAt = Date.now() - Math.round(elapsedSec * 1000)
			}
			const remainingSec = Number.isFinite(f.remaining) ? f.remaining : null
			const cell = {
				channel: ch,
				layer: ln,
				clip,
				startedAt,
				durationMs,
				playing: layer.paused !== true,
				loop: !!f.loop,
				isRoute: isRouteClip(clip),
				source: 'osc',
			}
			if (elapsedSec != null) cell.elapsedSec = elapsedSec
			if (remainingSec != null) cell.remainingSec = remainingSec
			if (progress != null) cell.progress = progress
			out[key] = cell
		}
	}
	return out
}

/**
 * Layer numbers on a channel that OSC reports as non-empty (same filter as {@link buildMatrixFromOsc}).
 * Used by FTB to fade only layers that actually have producers.
 * @param {{ oscState?: { getSnapshot?: () => object } }} ctx
 * @param {number} ch — Caspar channel (1-based)
 * @returns {number[]}
 */
function getOccupiedLayerNumbersFromOsc(ctx, ch) {
	if (!isOscPlaybackActive(ctx)) return []
	const snap = ctx.oscState.getSnapshot()
	const channels = (snap && snap.channels) || {}
	const chan = channels[ch] ?? channels[String(ch)]
	if (!chan || !chan.layers) return []
	const out = []
	for (const lid of Object.keys(chan.layers)) {
		const ln = parseInt(lid, 10)
		if (!Number.isFinite(ln)) continue
		const layer = chan.layers[lid]
		if (!layer || typeof layer !== 'object') continue
		const typ = String(layer.type || 'empty')
		if (typ === 'empty') continue
		const clip = pickClipFromOscLayer(layer)
		if (!clip) continue
		out.push(ln)
	}
	return out.sort((a, b) => a - b)
}

/**
 * @param {{ _playbackMatrix?: object, oscState?: object }} ctx
 * @returns {object}
 */
function getMatrixForState(ctx) {
	if (isOscPlaybackActive(ctx)) {
		return buildMatrixFromOsc(ctx)
	}
	return getMatrixSnapshot(ctx)
}

/**
 * @param {{ _playbackMatrix?: object, gatheredInfo?: { channelXml?: Record<string, string> }, state?: import('events').EventEmitter }} ctx
 */
async function reconcilePlaybackMatrixFromGatheredXml(ctx) {
	if (isOscPlaybackActive(ctx)) return
	const { parseLayerFgClipsFromChannelXml, pathsMatch } = require('./live-scene-reconcile')
	if (!ctx?._playbackMatrix) return
	const matrix = ctx._playbackMatrix
	const keys = Object.keys(matrix)
	if (keys.length === 0) return

	for (const key of keys) {
		const cell = matrix[key]
		if (!cell?.playing) continue
		if (cell.isRoute) continue

		const ch = cell.channel
		const ln = String(cell.layer)
		const xml = ctx.gatheredInfo?.channelXml?.[String(ch)]
		if (!xml || !String(xml).trim()) continue

		let fgByLayer
		try {
			fgByLayer = await parseLayerFgClipsFromChannelXml(xml)
		} catch {
			continue
		}
		const actual = fgByLayer[ln] != null ? String(fgByLayer[ln]) : ''
		const expected = cell.clip

		if (!String(actual).trim()) {
			recordStop(ctx, ch, ln)
			continue
		}
		if (!pathsMatch(expected, actual)) {
			recordPlay(ctx, ch, ln, actual, { loop: !!cell.loop })
		}
	}
}

module.exports = {
	recordPlay,
	recordStop,
	clearChannelFromMatrix,
	getMatrixForState,
	buildMatrixFromOsc,
	getOccupiedLayerNumbersFromOsc,
	isOscPlaybackActive,
	resolveClipDurationMs,
	resolveClipDurationMsWithDiskProbe,
	getOscClipEndFadeDelayMs,
	reconcilePlaybackMatrixFromGatheredXml,
}
