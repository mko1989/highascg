import { getApiBase } from './api-client.js'
import { isDecklinkInputChannel } from './input-channels.js'

/**
 * Client mirror of the server `live_thumbnail_ttl_ms` default
 * (`src/config/defaults-core.js` / `config/general.json`). The deck reuses one URL for the
 * whole window so a repaint storm costs zero extra requests.
 */
export const LIVE_THUMBNAIL_TTL_MS = 30000

/**
 * Cache-bust token quantised to the live-thumbnail TTL: constant inside a window, so the
 * browser (and the canvas thumb cache) reuse one image per channel per TTL instead of
 * refetching on every render.
 * @param {number} [ttlMs]
 * @param {number} [nowMs]
 * @returns {number}
 */
export function liveThumbnailCacheBustWindow(ttlMs = LIVE_THUMBNAIL_TTL_MS, nowMs = Date.now()) {
	const ttl = Math.max(1000, Number(ttlMs) || LIVE_THUMBNAIL_TTL_MS)
	const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
	return Math.floor(now / ttl)
}

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

/**
 * @param {{ type?: string, value?: string, isPlaceholder?: boolean }} source
 * @returns {boolean}
 */
export function isMediaOrFileSourceValue(source) {
	if (!source?.value) return false
	if (source.isPlaceholder || source.type === 'placeholder') return false
	const t = String(source.type || '').toLowerCase()
	return (t === 'media' || t === 'file')
}

/**
 * True when a layer source is a **dedicated DeckLink input** channel rather than a program bus.
 *
 * A DeckLink input layer is stored as `{ type: 'route', value: 'route://<ch>-<slot>' }`, usually
 * with `routeType: 'decklink'`. Older looks were saved without `routeType`, so the channel map is
 * the authoritative check — `route://1` (PGM) must never match, which is what keeps WO-63 intact.
 *
 * @param {object | null | undefined} source
 * @param {object | null | undefined} channelMap — `state.channelMap`
 * @param {number | null} [fallbackChannel]
 * @returns {boolean}
 */
export function isDecklinkInputSource(source, channelMap, fallbackChannel = null) {
	if (!source?.value) return false
	if (source.isPlaceholder || source.type === 'placeholder') return false
	const t = String(source.type || '').toLowerCase()
	if (t !== 'route' && t !== 'live') return false
	if (String(source.routeType || '').toLowerCase() === 'decklink') return true
	const ch = getLiveThumbnailChannelForSource(source, fallbackChannel)
	if (ch == null || ch <= 0) return false
	return isDecklinkInputChannel(channelMap, ch)
}

/**
 * Resolve a deck/compose thumbnail URL for a layer or clip source.
 * Returns null when no static thumbnail applies (timeline, templates, direct NDI, etc.).
 * @param {object | null | undefined} source
 * @param {{ maxWidth?: number, seekSec?: number, channelForLive?: number | null, cacheBust?: number | string, deckIdleMode?: boolean, channelMap?: object | null }} [opts]
 * @returns {string | null}
 */
export function resolveSourceThumbnailUrl(source, opts = {}) {
	if (!source?.value) return null
	const maxW = opts.maxWidth ?? 960
	const seekSec = opts.seekSec ?? 0
	const channelForLive = opts.channelForLive ?? null

	if (isMediaOrFileSourceValue(source)) {
		return getThumbnailUrl(source.value, maxW, seekSec)
	}

	// Idle look deck cards: media thumbs only — never full-bus PRINT stills (WO-63).
	// Exception (2026-07-19): a DeckLink INPUT layer has no media file, and its dedicated input
	// channel is not a program bus — the captured frame IS the layer's content, so it is exactly
	// what the deck card should show. Everything else still bails out here.
	if (opts.deckIdleMode && !isDecklinkInputSource(source, opts.channelMap, opts.channelForLive)) {
		return null
	}

	const t = String(source.type || '').toLowerCase()
	if (t === 'timeline' || t === 'template' || t === 'cg' || t === 'html') return null
	if (source.isPlaceholder || t === 'placeholder') return null

	const ch = getLiveThumbnailChannelForSource(source, channelForLive)
	if (ch == null || ch <= 0) return null

	const v = String(source.value || '').trim()
	const isRoutable =
		t === 'route' ||
		t === 'live' ||
		t === 'live_audio' ||
		t === 'ndi' ||
		t === 'browser' ||
		/^route:\/\//i.test(v)
	if (!isRoutable) return null

	return getLiveThumbnailUrl(ch, opts.cacheBust)
}
