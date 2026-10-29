/**
 * Shared media / template catalog lists for HTTP GET /api/media and WS catalog_chunk (PF-01 C).
 */
'use strict'

const { parseCinfMedia } = require('../media/cinf-parse')
const { enrichMediaListWithCinfAndProbe } = require('../utils/media-snapshot-cinf')
const {
	resolveSafe,
	probeMedia,
	getMediaIngestBasePath,
	scanMediaRecursiveForBrowser,
	normalizeMediaIdKey,
} = require('../media/local-media')
const { dedupeMediaList } = require('../utils/media-browser-dedupe')

/** How long one /api/media call keeps starting new ffprobe batches of 120 (the batch in flight always finishes). */
const PROBE_BUDGET_MS = 3000

function isHiddenThumbnailBucket(id) {
	const norm = String(id || '').replace(/\\/g, '/').toLowerCase()
	return norm === 'tb' || norm.startsWith('tb/') || norm === '.tb' || norm.startsWith('.tb/')
}

/**
 * CLS (+ optional disk scan) rows — no ffprobe batch, no CINF parse. Same ordering as `/api/media` pre-enrichment.
 * @param {object} ctx
 * @returns {object[]}
 */
function getRawMediaCatalog(ctx) {
	const stateMedia = ctx.state?.getState?.()?.media || []
	let media =
		stateMedia.length > 0
			? stateMedia
			: (ctx.CHOICES_MEDIAFILES || []).map((c) => ({ id: c.id, label: c.label }))
	media = media.filter((m) => !isHiddenThumbnailBucket(m?.id))
	try {
		const ingestBase = getMediaIngestBasePath(ctx.config)
		const diskItems = scanMediaRecursiveForBrowser(ingestBase)
		if (diskItems.length > 0) {
			const seen = new Set(media.map((m) => normalizeMediaIdKey(m.id)))
			for (const item of diskItems) {
				if (isHiddenThumbnailBucket(item?.id)) continue
				const key = normalizeMediaIdKey(item.id)
				if (!seen.has(key)) {
					seen.add(key)
					media.push({ id: item.id, label: item.id, isDir: item.isDir })
				}
			}
		}
	} catch {
		/* ignore scan errors */
	}
	return dedupeMediaList(media)
}

/**
 * @param {object} ctx
 * @returns {{ id: string, label: string }[]}
 */
function getTemplateCatalog(ctx) {
	const fromChoices = (ctx.CHOICES_TEMPLATES || []).map((c) => ({ id: c.id, label: c.label }))
	if (fromChoices.length > 0) return fromChoices
	const fromState = ctx.state?.getState?.()?.templates
	if (Array.isArray(fromState) && fromState.length > 0) {
		return fromState.map((c) => ({ id: c.id, label: c.label }))
	}
	return fromChoices
}

/**
 * Probe (bounded) + CINF enrichment — matches legacy `/api/media` body after raw list build.
 * @param {object} ctx
 * @param {object[]} media
 * @param {{ forceFullCinf?: boolean, skipFinalDedupe?: boolean, probeBudgetMs?: number }} [opts] — set **`skipFinalDedupe`** for WS catalog chunks so row count stays aligned with slice offsets; `probeBudgetMs` overrides PROBE_BUDGET_MS (tests).
 * @returns {Promise<object[]>}
 */
async function enrichMediaListForHttp(ctx, media, opts = {}) {
	const basePath = (ctx.config?.local_media_path || '').trim() || getMediaIngestBasePath(ctx.config)
	if (basePath) {
		ctx._mediaProbeCache = ctx._mediaProbeCache || {}
		const tried = (ctx._mediaProbeTried = ctx._mediaProbeTried || new Set())
		// Skip ids already probed (WO-497 rule) — else every call re-probed the SAME first 120 and a large library's
		// later files never got a resolution (owner 20.10: 225 of 345 clips, takes fell back to 16:9).
		const pending = media.filter((m) => !m.isDir && !tried.has(m.id) && (!m.resolution || (m.fps == null && m.fps !== 0)))
		// Live e2e 29.10: the Godot client fetches /api/media once at boot, so after a node restart it showed codec /
		// resolution (and the WO-818 NotchLC ⚠) for the first 120 files only. Work through the rest in batches of 120
		// within one call, up to a time budget (≈20 ms per ffprobe here); what is left goes to the next call as before.
		const budgetMs = opts.probeBudgetMs != null ? opts.probeBudgetMs : PROBE_BUDGET_MS
		const t0 = Date.now()
		for (let i = 0; i < pending.length; i += 120) {
			if (i > 0 && Date.now() - t0 >= budgetMs) break
			await Promise.all(
				pending.slice(i, i + 120).map(async (m) => {
					const fp = resolveSafe(basePath, m.id)
					if (fp) {
						const probed = await probeMedia(fp)
						tried.add(m.id) // even when empty — "tried, nothing" is an answer too (a playback durationMs-only entry is not)
						if (Object.keys(probed).length) ctx._mediaProbeCache[m.id] = { ...(ctx._mediaProbeCache[m.id] || {}), ...probed }
					}
				}),
			)
		}
		media = media.map((m) => ({ ...m, ...(ctx._mediaProbeCache[m.id] || {}) }))
	}
	if (!opts.skipFinalDedupe) media = dedupeMediaList(media)
	const forceFullCinf = opts.forceFullCinf === true
	const capOverride = forceFullCinf ? 0 : undefined
	const { list } = enrichMediaListWithCinfAndProbe(
		media,
		ctx,
		(m) => {
			const cinf = m.cinf || (ctx.mediaDetails || {})[m.id] || ''
			const parsed = parseCinfMedia(cinf)
			const probed = (ctx._mediaProbeCache || {})[m.id] || {}
			return { ...m, ...parsed, ...probed }
		},
		capOverride,
	)
	return list
}

function getWsCatalogChunkLimit() {
	return Math.max(50, Math.min(2000, parseInt(process.env.HIGHASCG_WS_CATALOG_CHUNK_LIMIT || '600', 10) || 600))
}

/**
 * @param {number} offset
 * @param {number} limit
 * @param {number} totalCount
 */
function normalizeChunkRange(offset, limit, totalCount) {
	const o = Math.max(0, Math.min(totalCount, parseInt(offset, 10) || 0))
	const maxL = getWsCatalogChunkLimit()
	const rawLim = parseInt(limit, 10)
	const lim = Math.max(1, Math.min(maxL, Number.isFinite(rawLim) && rawLim > 0 ? rawLim : maxL))
	const end = Math.min(totalCount, o + lim)
	const sliceLen = end - o
	return { offset: o, limit: lim, end, sliceLen }
}

module.exports = {
	isHiddenThumbnailBucket,
	getRawMediaCatalog,
	getTemplateCatalog,
	enrichMediaListForHttp,
	normalizeChunkRange,
	getWsCatalogChunkLimit,
}
