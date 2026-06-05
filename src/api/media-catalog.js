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
	return (ctx.CHOICES_TEMPLATES || []).map((c) => ({ id: c.id, label: c.label }))
}

/**
 * Probe (bounded) + CINF enrichment — matches legacy `/api/media` body after raw list build.
 * @param {object} ctx
 * @param {object[]} media
 * @param {{ forceFullCinf?: boolean, skipFinalDedupe?: boolean }} [opts] — set **`skipFinalDedupe`** for WS catalog chunks so row count stays aligned with slice offsets.
 * @returns {Promise<object[]>}
 */
async function enrichMediaListForHttp(ctx, media, opts = {}) {
	const basePath = (ctx.config?.local_media_path || '').trim() || getMediaIngestBasePath(ctx.config)
	if (basePath) {
		ctx._mediaProbeCache = ctx._mediaProbeCache || {}
		const toProbe = media
			.filter((m) => !m.isDir && (!m.resolution || (m.fps == null && m.fps !== 0)))
			.slice(0, 120)
		await Promise.all(
			toProbe.map(async (m) => {
				const fp = resolveSafe(basePath, m.id)
				if (fp) {
					const probed = await probeMedia(fp)
					if (Object.keys(probed).length) ctx._mediaProbeCache[m.id] = probed
				}
			}),
		)
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
