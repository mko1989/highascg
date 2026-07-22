/**
 * WO-319 — the operator LIVE CANVAS: the operator-GUI composed channel (server-selected, channel 4
 * on this box), NVENC-encoded once and decoded in-browser by WebCodecs, shown as live motion in the
 * preview surfaces (compose preview, looks editor, multiview editor) in place of the ~1 Hz JPEG.
 *
 * TOGGLE-DRIVEN, not automatic. Each connected browser starts an NVENC session server-side, so the
 * operator turns this on explicitly (persisted per-client in localStorage); off is the JPEG path,
 * i.e. exactly today's behaviour. The stream is channel-AGNOSTIC to the caller: it carries "the
 * operator canvas", and any preview surface can draw it with {@link drawOperatorLiveCanvas} — it is
 * NOT matched to a per-cell channel (the composed channel is not one of the compose cells' PGM/PRV
 * channels; it IS the whole surface).
 *
 * NETWORK: the relay is served by the highascg HTTP server, so every client that enables the toggle
 * decodes the SAME stream — one NVENC encode on the box, N independent WebCodecs decoders, each
 * served keyframe-first by the server GOP buffer. Extra viewers cost a decode on their own machine,
 * not extra GPU on the playout box.
 */

import {
	acquireGuiStream,
	releaseGuiStream,
	guiStreamChannel,
	guiStreamFrame,
	guiStreamSupported,
	guiStreamStats,
	subscribeGuiStreamFrames,
} from '../lib/gui-stream-client.js'

const LS_KEY = 'highascg.operatorLiveCanvas'
/** Re-ask the server occasionally — the feature can appear/disappear across a service restart. */
const STATUS_TTL_MS = 60000

/** Server feature availability + which channel it carries (null = disabled/unknown). */
let _available = false
let _channel = null
let _statusFetchedAt = 0
let _statusFetching = false

/** Operator toggle (persisted). Acquiring the stream only happens when enabled AND available. */
let _enabled = readPersistedEnabled()
let _acquired = false
let _unsubFrames = null

/** Repaint subscribers (each preview surface schedules its own redraw on a new frame). */
const _repaint = new Set()
/** Toggle-state subscribers (the toggle button re-renders when availability/enabled changes). */
const _stateSubs = new Set()

function readPersistedEnabled() {
	try {
		return globalThis.localStorage?.getItem(LS_KEY) === '1'
	} catch {
		return false
	}
}
function persistEnabled(on) {
	try {
		globalThis.localStorage?.setItem(LS_KEY, on ? '1' : '0')
	} catch {
		/* private mode / no storage — in-memory only */
	}
}

function notifyState() {
	for (const fn of _stateSubs) {
		try {
			fn(operatorLiveCanvasState())
		} catch {
			/* a bad listener must not break the toggle */
		}
	}
}

async function fetchStatus(force = false) {
	if (_statusFetching) return
	if (!force && Date.now() - _statusFetchedAt < STATUS_TTL_MS) return
	_statusFetching = true
	try {
		const res = await fetch('/api/gui-stream/status', { cache: 'no-store' })
		_statusFetchedAt = Date.now()
		if (!res.ok) {
			_available = false
			_channel = null
			return
		}
		const j = await res.json()
		_available = j?.enabled === true
		_channel = Number.isFinite(j?.channel) ? j.channel : null
	} catch {
		_statusFetchedAt = Date.now()
		_available = false
		_channel = null
	} finally {
		_statusFetching = false
		reconcile()
		notifyState()
	}
}

/** Acquire/release the stream to match (enabled AND available AND WebCodecs present). */
function reconcile() {
	const want = _enabled && _available && guiStreamSupported()
	if (want && !_acquired) {
		_acquired = true
		acquireGuiStream()
		_unsubFrames = subscribeGuiStreamFrames(() => {
			for (const fn of _repaint) {
				try {
					fn()
				} catch {
					/* keep the frame path alive */
				}
			}
		})
	} else if (!want && _acquired) {
		_acquired = false
		if (_unsubFrames) _unsubFrames()
		_unsubFrames = null
		releaseGuiStream()
	}
}

/** Call once at UI init: restore the persisted toggle and probe availability. */
export function initOperatorLiveCanvas() {
	if (guiStreamSupported()) void fetchStatus(true)
	else notifyState()
	// WO-319 diagnostic: window.__liveCanvas() reports the full client-side state (streaming, whether
	// a decoded frame is on hand, decoder frame count, and the last decode error) so a remote client
	// can be inspected from its console without a rebuild.
	try {
		globalThis.__liveCanvas = () => ({ ...operatorLiveCanvasState(), stream: guiStreamStats() })
	} catch {
		/* no global — ignore */
	}
}

/**
 * The operator toggled live preview. Persists and acquires/releases accordingly. When turning on
 * without a fresh availability read, this re-probes so a stale "disabled" doesn't block it.
 * @param {boolean} on
 */
export function setOperatorLiveCanvasEnabled(on) {
	_enabled = on === true
	persistEnabled(_enabled)
	if (_enabled && !_available) void fetchStatus(true)
	reconcile()
	notifyState()
}

export function isOperatorLiveCanvasEnabled() {
	return _enabled
}
export function isOperatorLiveCanvasAvailable() {
	return _available && guiStreamSupported()
}
export function operatorLiveCanvasChannel() {
	return _channel
}

/** True once a decoded frame is on hand — surfaces use this to decide live-vs-JPEG per paint. */
export function operatorLiveCanvasHasFrame() {
	return _acquired && !!guiStreamFrame()
}

/** Current decoded frame dimensions {width,height}, or null — for aspect-correct letterbox layout. */
export function operatorLiveCanvasFrameSize() {
	const f = guiStreamFrame()
	if (!f || !(f.displayWidth > 0) || !(f.displayHeight > 0)) return null
	return { width: f.displayWidth, height: f.displayHeight }
}

export function operatorLiveCanvasState() {
	return {
		enabled: _enabled,
		available: isOperatorLiveCanvasAvailable(),
		channel: _channel,
		streaming: _acquired,
		hasFrame: operatorLiveCanvasHasFrame(),
	}
}

/** @param {() => void} fn called once per decoded frame — schedule a repaint of your surface. */
export function subscribeOperatorLiveCanvasRepaint(fn) {
	_repaint.add(fn)
	return () => _repaint.delete(fn)
}

/** @param {(state: ReturnType<typeof operatorLiveCanvasState>) => void} fn toggle/availability change */
export function subscribeOperatorLiveCanvasState(fn) {
	_stateSubs.add(fn)
	return () => _stateSubs.delete(fn)
}

/**
 * Draw the newest live frame letterboxed into a w×h rect at the current transform origin. Returns
 * false when there is nothing to draw (caller should fall back to its JPEG/snapshot path). The
 * stream is channel-agnostic — this draws whatever the operator canvas carries.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @returns {boolean}
 */
export function drawOperatorLiveCanvas(ctx, w, h) {
	if (!_acquired) return false
	const frame = guiStreamFrame()
	if (!frame) return false
	const iw = frame.displayWidth
	const ih = frame.displayHeight
	if (!(iw > 0) || !(ih > 0) || !(w > 0) || !(h > 0)) return false
	const scale = Math.min(w / iw, h / ih)
	const dw = iw * scale
	const dh = ih * scale
	try {
		ctx.drawImage(frame, (w - dw) / 2, (h - dh) / 2, dw, dh)
		return true
	} catch {
		// Frame closed mid-draw (teardown race) — caller falls back this paint.
		return false
	}
}

/**
 * Draw the newest live frame STRETCHED to fill a w×h rect (no letterbox) at the current transform
 * origin. Used as the tiles backdrop: the chrome tiles are positioned as fractions of the same
 * compose area, so a fill (not a fit) keeps the routes under their tiles regardless of aspect.
 * @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h @returns {boolean}
 */
export function drawOperatorLiveCanvasFill(ctx, w, h) {
	if (!_acquired) return false
	const frame = guiStreamFrame()
	if (!frame || !(w > 0) || !(h > 0)) return false
	try {
		ctx.drawImage(frame, 0, 0, w, h)
		return true
	} catch {
		return false
	}
}

/**
 * Draw a CROP of the newest live frame — the source region given as FRACTIONS [0..1] of the frame,
 * stretched to fill the dest rect. This is what the operator compose tiles use: the operator channel
 * is a mosaic of routed feeds, and each tile shows the sub-region of that mosaic that its punch-hole
 * used to reveal (the same viewport-fraction the screen consumer mapped). No letterbox — the source
 * crop already matches the tile's aspect because the FILL that built the mosaic used the tile's rect.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} fx @param {number} fy @param {number} fw @param {number} fh source fractions [0..1]
 * @param {number} dx @param {number} dy @param {number} dw @param {number} dh dest pixels
 * @returns {boolean}
 */
export function drawOperatorLiveCanvasCrop(ctx, fx, fy, fw, fh, dx, dy, dw, dh) {
	if (!_acquired) return false
	const frame = guiStreamFrame()
	if (!frame) return false
	const iw = frame.displayWidth
	const ih = frame.displayHeight
	if (!(iw > 0) || !(ih > 0) || !(dw > 0) || !(dh > 0)) return false
	// Clamp the source rect inside the frame — a tile dragged partly off-screen must not ask for
	// pixels outside the decoded frame (drawImage throws on an out-of-bounds source rect).
	const sx = Math.max(0, Math.min(fx, 1)) * iw
	const sy = Math.max(0, Math.min(fy, 1)) * ih
	const sw = Math.max(1, Math.min(fw, 1 - fx) * iw)
	const sh = Math.max(1, Math.min(fh, 1 - fy) * ih)
	try {
		ctx.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh)
		return true
	} catch {
		return false
	}
}
