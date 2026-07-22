import {
	getComposePreviewMetaUrl,
	getComposePreviewUrl,
	isSnapshotComposePreview,
	resolveComposeChannelForCell,
	resolveComposePreviewChannelsFromChannelMap,
} from '../lib/compose-preview-url.js'
import {
	computeBackoffDelayMs,
	resolvePollIntervalMs,
	shouldAcceptFramePush,
} from '../lib/compose-preview-backpressure.js'
import {
	drawOperatorLiveCanvas,
	isOperatorLiveCanvasEnabled,
	operatorLiveCanvasHasFrame,
	subscribeOperatorLiveCanvasRepaint,
} from './preview-canvas-live-stream.js'

/**
 * @returns {string} current page visibility ('visible' when there is no document)
 */
function visibility() {
	return typeof document !== 'undefined' ? document.visibilityState : 'visible'
}

/** @type {Set<number>} — channels whose meta returned 404 (no JPEG yet); skip poll spam */
const _metaUnavailable = new Set()

/** @type {Map<number, string>} — server-blocklisted channels (ADD rejected, WO-144): ch → reason */
const _blocklisted = new Map()

/**
 * Last full server-provided blocklist (WS `state` bootstrap + `compose.preview` pushes).
 * Survives {@link resetComposePreviewClientCache} so routing/project changes don't
 * silently regress the badge to a black cell (WO-159 T159.2).
 * @type {Map<number, string>}
 */
const _blocklistSeed = new Map()

/** Re-apply the last server-provided blocklist after a cache wipe (WO-159 T159.2). */
function applyBlocklistSeed() {
	for (const [ch, reason] of _blocklistSeed) _blocklisted.set(ch, reason)
}

/** @type {Map<number, { img: HTMLImageElement, etag: string | null, loading: boolean }>} */
const _cache = new Map()

/** @type {string} */
let _trackedChannelSig = ''

let _pollTimer = null
/** Interval the running `_pollTimer` was created with — retuned on visibility change. */
let _pollIntervalMs = 0
/** @type {Set<(channel: number) => void>} */
const _listeners = new Set()

/**
 * WO-280 backpressure state. All three maps are keyed by channel, so they stay bounded
 * by the tracked channel count and are cleared alongside `_cache`.
 */
/** Consecutive failed frame loads per channel. @type {Map<number, number>} */
const _failures = new Map()
/** Timestamp until which a channel must not be re-requested. @type {Map<number, number>} */
const _backoffUntil = new Map()
/** At most one pending retry timer per channel. @type {Map<number, ReturnType<typeof setTimeout>>} */
const _retryTimers = new Map()
/** Last WS push we actually turned into a fetch — throttles hidden tabs. @type {Map<number, number>} */
const _lastPushAt = new Map()

function notifyComposePreviewListeners(channel) {
	for (const fn of _listeners) {
		try {
			fn(channel)
		} catch {
			/* ignore */
		}
	}
}

// WO-319: decoded live frames arrive ~50/s; coalesce them to one repaint per animation frame so
// the panels' own rAF scheduler (preview-canvas-panel.js) paints at display cadence, not decode
// cadence. The subscription drives the SAME listener set as JPEG refreshes, so a cell already
// wired for compose preview repaints for live frames with no extra plumbing at the call sites.
let _liveRepaintPending = false
subscribeOperatorLiveCanvasRepaint(() => {
	if (_liveRepaintPending) return
	if (typeof requestAnimationFrame !== 'function') {
		notifyComposePreviewListeners(-1)
		return
	}
	_liveRepaintPending = true
	requestAnimationFrame(() => {
		_liveRepaintPending = false
		notifyComposePreviewListeners(-1)
	})
})

/**
 * @param {number} channel
 * @param {string} etag
 */
/**
 * WO-280: is this channel inside its backoff window?
 * @param {number} ch
 * @param {number} [nowMs]
 */
function isBackingOff(ch, nowMs = Date.now()) {
	const until = _backoffUntil.get(ch) || 0
	return until > nowMs
}

/**
 * WO-280: record a failed frame load and arm exactly one retry.
 *
 * Replaces the old fixed 1 s retry (WO-198 T198.3), which did not actually throttle
 * anything: the error path reset `entry.etag = null`, so the very next `compose.preview`
 * push — 40 ms later at 25 fps — re-entered this function. A channel serving 404s
 * therefore produced a full-rate request storm plus a console line per frame from every
 * open tab. The backoff window is now consulted by both the push and the poll path.
 * @param {number} ch
 */
function noteComposePreviewFailure(ch) {
	const failures = (_failures.get(ch) || 0) + 1
	_failures.set(ch, failures)
	const delayMs = computeBackoffDelayMs(failures)
	_backoffUntil.set(ch, Date.now() + delayMs)
	// One line on the healthy → degraded edge only, never per frame.
	if (failures === 1) {
		console.warn(`[compose-preview] ch${ch} frame load failed — backing off (retry in ${delayMs}ms)`)
	}
	if (_retryTimers.has(ch)) return
	_retryTimers.set(
		ch,
		setTimeout(() => {
			_retryTimers.delete(ch)
			// Timer jitter can fire a hair early — open the window explicitly so the
			// scheduled retry is never swallowed by its own backoff check.
			_backoffUntil.delete(ch)
			void pollChannelMeta(ch)
		}, delayMs),
	)
}

/**
 * @param {number} ch
 */
function noteComposePreviewSuccess(ch) {
	if (!_failures.has(ch)) return
	console.info(`[compose-preview] ch${ch} frame load recovered after ${_failures.get(ch)} failure(s)`)
	_failures.delete(ch)
	_backoffUntil.delete(ch)
	const t = _retryTimers.get(ch)
	if (t) {
		clearTimeout(t)
		_retryTimers.delete(ch)
	}
}

async function loadComposePreviewImage(channel, etag) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	let entry = _cache.get(ch)
	if (!entry) {
		entry = { img: new Image(), etag: null, loading: false }
		_cache.set(ch, entry)
	}
	// Never more than one outstanding request per channel (WO-280 req. 2).
	if (entry.loading) return
	if (etag && etag === entry.etag) return
	if (isBackingOff(ch)) return
	entry.loading = true
	try {
		const url = getComposePreviewUrl(ch, etag)
		await new Promise((resolve, reject) => {
			const img = new Image()
			img.onload = () => {
				entry.img = img
				entry.etag = etag
				entry.loading = false
				noteComposePreviewSuccess(ch)
				notifyComposePreviewListeners(ch)
				resolve()
			}
			img.onerror = () => {
				entry.loading = false
				entry.etag = null
				noteComposePreviewFailure(ch)
				reject(new Error('compose preview load failed'))
			}
			img.src = url
		})
	} catch {
		entry.loading = false
	}
}

/**
 * Fallback meta poll when WS is quiet; the primary path is the `compose.preview` push.
 * Hidden tabs drop from 1 Hz to a 30 s heartbeat (WO-280 req. 2) — a backgrounded
 * laptop tab was previously polling and fetching at the full visible rate.
 */
function ensurePoll() {
	const wantMs = resolvePollIntervalMs(visibility())
	if (_pollTimer && _pollIntervalMs === wantMs) return
	if (_pollTimer) clearInterval(_pollTimer)
	_pollIntervalMs = wantMs
	_pollTimer = setInterval(() => {
		void pollAllTracked()
	}, wantMs)
}

function stopPollIfIdle() {
	if (_listeners.size > 0 || _cache.size > 0) return
	if (_pollTimer) {
		clearInterval(_pollTimer)
		_pollTimer = null
		_pollIntervalMs = 0
	}
}

// Retune the poll cadence when the tab is hidden/restored, and catch up immediately on
// return so the operator never looks at a 30 s stale frame.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
	document.addEventListener('visibilitychange', () => {
		if (!_pollTimer) return
		ensurePoll()
		if (visibility() !== 'hidden') void pollAllTracked()
	})
}

/**
 * Push path — server broadcasts on JPG mtime change (much lower latency than meta polling).
 * Also handles cleared flag (WO-198 T198.2) to drop cached etag immediately.
 * @param {{ channel?: number, etag?: string, cleared?: boolean, blocklisted?: boolean }} data
 */
export function ingestComposePreviewWs(data) {
	if (!isSnapshotComposePreview()) return
	const ch = parseInt(String(data?.channel ?? ''), 10)
	if (!Number.isFinite(ch) || ch < 1) return
	// Cleared flag (WO-198 T198.2): file was truncated, drop cached etag and show placeholder.
	if (data?.cleared === true) {
		let entry = _cache.get(ch)
		if (!entry) {
			entry = { img: new Image(), etag: null, loading: false }
			_cache.set(ch, entry)
		}
		entry.etag = null
		_metaUnavailable.delete(ch)
		notifyComposePreviewListeners(ch)
		return
	}
	// Blocklist push (WO-144) shares the `compose.preview` event; no etag payload.
	if (data?.blocklisted !== undefined) {
		if (data.blocklisted) {
			const reason = String(data.reason || 'ADD rejected')
			_blocklisted.set(ch, reason)
			_blocklistSeed.set(ch, reason)
		} else {
			_blocklisted.delete(ch)
			_blocklistSeed.delete(ch)
		}
		notifyComposePreviewListeners(ch)
		return
	}
	const etag = data?.etag != null ? String(data.etag) : null
	if (!etag) return
	_metaUnavailable.delete(ch)
	_blocklisted.delete(ch)
	_blocklistSeed.delete(ch)
	trackComposePreviewChannel(ch)
	// WO-280: the server pushes at the JPEG mtime rate (25/s by default). Browsers throttle
	// timers in hidden tabs but not WS delivery or image loads, so without this gate a
	// backgrounded tab kept pulling a full frame per push — the reported operator GUI lag.
	const now = Date.now()
	if (!shouldAcceptFramePush(visibility(), _lastPushAt.get(ch) || 0, now)) return
	_lastPushAt.set(ch, now)
	void loadComposePreviewImage(ch, etag)
}

/**
 * @param {number} channel
 * @returns {boolean}
 */
export function isComposePreviewChannelBlocklisted(channel) {
	return _blocklisted.has(parseInt(String(channel), 10))
}

/**
 * Replace the client blocklist with the server's full list — WS `state` bootstrap on
 * connect/reconnect carries `composePreview.blocklist` (WO-159 T159.2). Accepts the
 * `getComposeBlocklistStats()` shape or a bare channel array.
 * @param {{ channels?: number[], byChannel?: Record<string, { reason?: string }> } | number[] | null | undefined} blocklist
 */
export function syncComposePreviewBlocklist(blocklist) {
	const channels = Array.isArray(blocklist)
		? blocklist
		: Array.isArray(blocklist?.channels)
			? blocklist.channels
			: null
	if (!channels) return
	const byChannel = (blocklist && !Array.isArray(blocklist) && blocklist.byChannel) || {}
	const touched = new Set([..._blocklisted.keys()])
	_blocklistSeed.clear()
	_blocklisted.clear()
	for (const c of channels) {
		const ch = parseInt(String(c), 10)
		if (!Number.isFinite(ch) || ch < 1) continue
		const reason = String(byChannel[ch]?.reason || byChannel[String(ch)]?.reason || 'ADD rejected')
		_blocklistSeed.set(ch, reason)
		_blocklisted.set(ch, reason)
		touched.add(ch)
	}
	for (const ch of touched) notifyComposePreviewListeners(ch)
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
	if (isBackingOff(ch)) return
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
	// WO-280: drop backpressure bookkeeping for every channel we are about to forget —
	// a pending retry timer for an untracked channel would otherwise outlive its cache
	// entry and keep firing after routing / project changes.
	const dropBackpressure = (ch) => {
		const t = _retryTimers.get(ch)
		if (t) clearTimeout(t)
		_retryTimers.delete(ch)
		_failures.delete(ch)
		_backoffUntil.delete(ch)
		_lastPushAt.delete(ch)
	}
	if (Array.isArray(keepChannels) && keepChannels.length) {
		const keep = new Set(
			keepChannels.map((c) => Math.max(1, parseInt(String(c), 10) || 0)).filter((c) => c > 0),
		)
		for (const ch of [..._cache.keys()]) {
			if (!keep.has(ch)) {
				_cache.delete(ch)
				_metaUnavailable.delete(ch)
				_blocklisted.delete(ch)
				dropBackpressure(ch)
			}
		}
	} else {
		for (const ch of [..._cache.keys()]) dropBackpressure(ch)
		for (const ch of [..._retryTimers.keys()]) dropBackpressure(ch)
		_cache.clear()
		_metaUnavailable.clear()
		_blocklisted.clear()
	}
	// Server blocklist survives client cache resets (WO-159 T159.2) — the WO-144 badge
	// must not regress to a black cell after routing / project changes.
	applyBlocklistSeed()
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
	if (_blocklisted.has(ch)) {
		ctx.fillStyle = '#a66'
		ctx.font = '12px system-ui,sans-serif'
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		ctx.fillText(`preview unavailable on ch ${ch}`, cellW / 2, cellH / 2)
		return
	}
	// WO-319: when the operator live canvas is on and decoding, it IS the composed surface — draw
	// the live frame in place of the JPEG snapshot. Channel-agnostic (the composed channel is not a
	// per-cell PGM/PRV channel); the caller decides which surface hosts it. Falls back to JPEG.
	if (isOperatorLiveCanvasEnabled() && operatorLiveCanvasHasFrame() && drawOperatorLiveCanvas(ctx, cellW, cellH)) return
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
		// Starting up, not dead (WO-159 T159.4) — blocklisted channels take the badge above.
		ctx.fillStyle = '#555'
		ctx.font = '12px system-ui,sans-serif'
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		const label = _metaUnavailable.has(ch) ? `no frame yet — ch ${ch}` : `PGM ch ${ch}…`
		ctx.fillText(label, cellW / 2, cellH / 2)
	}
	if (opts.onLoaded && entry?.etag) opts.onLoaded()
}

export { isSnapshotComposePreview, resolveComposeChannelForCell }
