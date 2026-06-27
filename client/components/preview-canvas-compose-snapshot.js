import {
	getComposePreviewMetaUrl,
	getComposePreviewUrl,
	isSnapshotComposePreview,
	resolveComposeChannelForCell,
} from '../lib/compose-preview-url.js'

/** @type {Map<number, { img: HTMLImageElement, etag: string | null, loading: boolean }>} */
const _cache = new Map()

let _pollTimer = null
/** @type {Set<(channel: number) => void>} */
const _listeners = new Set()

function ensurePoll() {
	if (_pollTimer) return
	_pollTimer = setInterval(() => {
		void pollAllTracked()
	}, 150)
}

function stopPollIfIdle() {
	if (_listeners.size > 0 || _cache.size > 0) return
	if (_pollTimer) {
		clearInterval(_pollTimer)
		_pollTimer = null
	}
}

/**
 * @param {number} channel
 */
async function pollChannelMeta(channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	let entry = _cache.get(ch)
	if (!entry) {
		entry = { img: new Image(), etag: null, loading: false }
		_cache.set(ch, entry)
	}
	if (entry.loading) return
	try {
		const res = await fetch(getComposePreviewMetaUrl(ch), { cache: 'no-store' })
		if (!res.ok) return
		const meta = await res.json()
		const etag = meta?.etag ? String(meta.etag) : null
		if (!etag || etag === entry.etag) return
		entry.loading = true
		const url = getComposePreviewUrl(ch, etag)
		await new Promise((resolve, reject) => {
			const img = new Image()
			img.onload = () => {
				entry.img = img
				entry.etag = etag
				entry.loading = false
				for (const fn of _listeners) {
					try {
						fn(ch)
					} catch {
						/* ignore */
					}
				}
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
 * Track a channel for meta polling (lightweight — PNG only when etag changes).
 * @param {number} channel
 */
export function trackComposePreviewChannel(channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	if (!_cache.has(ch)) {
		_cache.set(ch, { img: new Image(), etag: null, loading: false })
	}
	ensurePoll()
	void pollChannelMeta(ch)
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
