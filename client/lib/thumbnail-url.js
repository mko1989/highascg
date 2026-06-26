import { getApiBase } from './api-client.js'

/**
 * @param {unknown} x
 * @returns {number | null}
 */
function normalizePositiveChannel(x) {
	const n = parseInt(String(x), 10)
	return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Channel for Caspar PRINT → `/api/thumbnail/live/:channel`.
 * - `route://N` or `route://N-L` → full-frame still for channel **N**
 * - Routed NDI / browser tiles can set `thumbnailChannel` (Caspar PRINT target). Direct `ndi://` ignores it.
 * @param {{ type?: string, value?: string, thumbnailChannel?: number, liveThumbChannel?: number, producerChannel?: number, useDirect?: boolean } | null | undefined} source
 * @param {unknown} fallbackChannel — e.g. preview bus when source does not imply a channel
 * @returns {number | null}
 */
export function getLiveThumbnailChannelForSource(source, fallbackChannel = null) {
	const fb = normalizePositiveChannel(fallbackChannel)
	if (!source || typeof source !== 'object') return fb
	const v = source.value
	// Direct NDI is keyed on `ndi://` at take/update time — Caspar PRINT on an arbitrary thumb channel shows the wrong PGM still.
	const isDirectNdi =
		source.useDirect === true && typeof v === 'string' && /^ndi:\/\//i.test(v.trim())
	if (isDirectNdi) return null
	if (typeof v === 'string' && /^route:\/\//i.test(v)) {
		const m = v.match(/^route:\/\/(\d+)(?:-(\d+))?/i)
		if (m) {
			const ch = parseInt(m[1], 10)
			if (Number.isFinite(ch) && ch > 0) return ch
		}
	}
	const fromMeta = normalizePositiveChannel(source.thumbnailChannel ?? source.liveThumbChannel ?? source.producerChannel)
	if (fromMeta != null) return fromMeta
	return fb
}

/**
 * Build a thumbnail URL preferring HighAsCG local ffmpeg extraction.
 * `hq=1` hints server-side local extraction before any Caspar fallback path.
 */
export function getThumbnailUrl(fileId, width = 960, seekSec = 2) {
	if (!fileId) return null
	const w = Math.max(64, Math.min(1920, Number(width) || 960))
	const t = Math.max(0, Number(seekSec) || 0)
	return `${getApiBase()}/api/thumbnail/${encodeURIComponent(String(fileId))}?hq=1&w=${w}&t=${t}`
}

export function getLiveThumbnailUrl(channel, cacheBust) {
	const ch = Math.max(1, parseInt(String(channel || 1), 10) || 1)
	const base = `${getApiBase()}/api/thumbnail/live/${ch}`
	if (cacheBust != null && String(cacheBust).trim() !== '') {
		const v = encodeURIComponent(String(cacheBust))
		return `${base}?v=${v}`
	}
	return base
}
