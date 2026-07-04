import {
	getComposePreviewMetaUrl,
	getComposePreviewUrl,
	isSnapshotComposePreview,
	resolveComposeChannelForCell,
	resolveComposePreviewChannelsFromChannelMap,
} from '../lib/compose-preview-url.js'

/** @type {Set<number>} — channels whose meta returned 404 (no JPEG yet); skip poll spam */
const _metaUnavailable = new Set()

/** @type {Map<number, { img: HTMLImageElement, etag: string | null, loading: boolean }>} */
const _cache = new Map()

/** @type {string} */
let _trackedChannelSig = ''

let _pollTimer = null
/** @type {Set<(channel: number) => void>} */
const _listeners = new Set()

function notifyComposePreviewListeners(channel) {
	for (const fn of _listeners) {
		try {
			fn(channel)
		} catch {
			/* ignore */
		}
	}
}

/**
 * @param {number} channel
 * @param {string} etag
 */
async function loadComposePreviewImage(channel, etag) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	let entry = _cache.get(ch)
	if (!entry) {
		entry = { img: new Image(), etag: null, loading: false }
		_cache.set(ch, entry)
	}
	if (entry.loading) return
	if (etag && etag === entry.etag) return
	entry.loading = true
	try {
		const url = getComposePreviewUrl(ch, etag)
		await new Promise((resolve, reject) => {
			const img = new Image()
			img.onload = () => {
				entry.img = img
				entry.etag = etag
				entry.loading = false
				notifyComposePreviewListeners(ch)
				resolve()
			}
			img.onerror = () => {
				entry.loading = false
				reject(new Error('compose preview load failed'))
			}
			img.src = url
		})
	} catch {
		entry.loading = false
	}
}

function ensurePoll() {
	if (_pollTimer) return
	// Fallback when WS is quiet; primary path is `compose.preview` push from server.
	_pollTimer = setInterval(() => {
		void pollAllTracked()
	}, 1000)
}

function stopPollIfIdle() {
	if (_listeners.size > 0 || _cache.size > 0) return
	if (_pollTimer) {
		clearInterval(_pollTimer)
		_pollTimer = null
	}
}

/**
 * Push path — server broadcasts on JPG mtime change (much lower latency than meta polling).
 * @param {{ channel?: number, etag?: string }} data
 */
export function ingestComposePreviewWs(data) {
	if (!isSnapshotComposePreview()) return
	const ch = parseInt(String(data?.channel ?? ''), 10)
	const etag = data?.etag != null ? String(data.etag) : null
	if (!Number.isFinite(ch) || ch < 1 || !etag) return
	_metaUnavailable.delete(ch)
	trackComposePreviewChannel(ch)
	void loadComposePreviewImage(ch, etag)
}

/**
 * @param {number} channel
 */
async function pollChannelMeta(channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	if (_metaUnavailable.has(ch)) return
	let entry = _cache.get(ch)
	if (!entry) {
		entry = { img: new Image(), etag: null, loading: false }
		_cache.set(ch, entry)
	}
	if (entry.loading) return
	try {
		const res = await fetch(getComposePreviewMetaUrl(ch), { cache: 'no-store' })
		if (!res.ok) {
			if (res.status === 404) _metaUnavailable.add(ch)
			return
		}
		_metaUnavailable.delete(ch)
		const meta = await res.json()
		const etag = meta?.etag ? String(meta.etag) : null
		if (!etag || etag === entry.etag) return
		await loadComposePreviewImage(ch, etag)
	} catch {
		/* ignore */
	}
}

async function pollAllTracked() {
	if (!isSnapshotComposePreview()) return
	const channels = [..._cache.keys()]
	await Promise.all(channels.map((ch) => pollChannelMeta(ch)))
}

/**
 * @param {(channel: number) => void} fn
 */
export function subscribeComposePreviewRefresh(fn) {
	_listeners.add(fn)
	ensurePoll()
	return () => {
		_listeners.delete(fn)
		stopPollIfIdle()
	}
}

/**
 * Clear client-side compose preview image cache (e.g. after routing / new project).
 * @param {number[]} [keepChannels] — when set, only drop channels not in this list
 */
export function resetComposePreviewClientCache(keepChannels) {
	if (Array.isArray(keepChannels) && keepChannels.length) {
		const keep = new Set(
			keepChannels.map((c) => Math.max(1, parseInt(String(c), 10) || 0)).filter((c) => c > 0),
		)
		for (const ch of [..._cache.keys()]) {
			if (!keep.has(ch)) {
				_cache.delete(ch)
				_metaUnavailable.delete(ch)
			}
		}
	} else {
		_cache.clear()
		_metaUnavailable.clear()
	}
	_trackedChannelSig = ''
	stopPollIfIdle()
}

/**
 * @param {number[]} channels
 */
/**
 * Track compose-preview JPEG channels from server channelMap (bootstrap + WS state).
 * @param {{ programChannels?: number[], previewChannels?: number[], decklinkInputChannels?: number[], v4l2InputChannels?: number[], hostLiveChannels?: { channel?: number }[], inputChannels?: { channel?: number }[] } | null | undefined} channelMap
 */
export function syncComposePreviewFromChannelMap(channelMap) {
	if (!channelMap || typeof channelMap !== 'object') return
	syncComposePreviewClientChannels(resolveComposePreviewChannelsFromChannelMap(channelMap))
}

export function syncComposePreviewClientChannels(channels) {
	const list = (channels || [])
		.map((c) => Math.max(1, parseInt(String(c), 10) || 0))
		.filter((c) => c > 0)
	const sig = [...new Set(list)].sort((a, b) => a - b).join(',')
	if (sig === _trackedChannelSig) return
	_trackedChannelSig = sig
	resetComposePreviewClientCache(list)
	for (const ch of list) trackComposePreviewChannel(ch, { poll: true })
}

/**
 * Track a channel for meta polling (lightweight — PNG only when etag changes).
 * @param {number} channel
 * @param {{ poll?: boolean }} [opts]
 */
export function trackComposePreviewChannel(channel, opts = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const hadEntry = _cache.has(ch)
	if (!hadEntry) {
		_cache.set(ch, { img: new Image(), etag: null, loading: false })
	}
	ensurePoll()
	if (opts.poll !== false && !hadEntry) void pollChannelMeta(ch)
}

/**
 * Draw Caspar snapshot into compose cell canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cellW
 * @param {number} cellH
 * @param {number} channel
 * @param {{ onLoaded?: () => void }} [opts]
 */
export function drawComposeSnapshotCell(ctx, cellW, cellH, channel, opts = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	trackComposePreviewChannel(ch)
	const entry = _cache.get(ch)
	ctx.fillStyle = '#0a0a0c'
	ctx.fillRect(0, 0, cellW, cellH)
	if (entry?.img?.complete && entry.img.naturalWidth > 0) {
		const iw = entry.img.naturalWidth
		const ih = entry.img.naturalHeight
		const scale = Math.min(cellW / iw, cellH / ih)
		const dw = iw * scale
		const dh = ih * scale
		const dx = (cellW - dw) / 2
		const dy = (cellH - dh) / 2
		ctx.drawImage(entry.img, dx, dy, dw, dh)
	} else {
		ctx.fillStyle = '#555'
		ctx.font = '12px system-ui,sans-serif'
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		ctx.fillText(`PGM ch ${ch}…`, cellW / 2, cellH / 2)
	}
	if (opts.onLoaded && entry?.etag) opts.onLoaded()
}

export { isSnapshotComposePreview, resolveComposeChannelForCell }
