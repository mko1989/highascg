/**
 * WO-319 — live-motion overlay for the compose preview.
 *
 * When the GUI live stream (one NVENC-encoded composed channel, see src/preview/gui-stream-*)
 * carries a channel that a visible compose cell is showing, that cell draws the DECODED VIDEO
 * FRAME instead of the 1 Hz JPEG snapshot. Everything else — including every error path — falls
 * back to the JPEG, so this module can never make the preview worse than today.
 *
 * CONNECTING IS NOT FREE: the first WS client starts the NVENC consumer server-side. So the
 * stream is only acquired once BOTH are true — /api/gui-stream/status says the feature is enabled
 * AND the set of channels the compose preview is actually tracking includes the streamed channel.
 * When cells change (project/routing) the acquisition follows, releasing when no visible cell
 * shows the stream. `noteTrackedChannels` is the single entry point for that decision, called by
 * preview-canvas-compose-snapshot on every tracking change.
 */

import {
	acquireGuiStream,
	releaseGuiStream,
	guiStreamChannel,
	guiStreamFrame,
	guiStreamSupported,
	subscribeGuiStreamFrames,
} from '../lib/gui-stream-client.js'

/** Stream channel per the server, or null when disabled/unknown. */
let _statusChannel = null
let _statusFetchedAt = 0
let _statusFetching = false
/** Re-ask the server occasionally — the feature can appear after a service restart. */
const STATUS_TTL_MS = 60000

let _acquired = false
let _unsubFrames = null
/** @type {Set<(channel: number) => void>} */
const _repaint = new Set()
/** @type {number[]} last channel set handed to noteTrackedChannels (re-evaluated after status) */
let _lastTracked = []

async function fetchStatus() {
	if (_statusFetching) return
	if (Date.now() - _statusFetchedAt < STATUS_TTL_MS) return
	_statusFetching = true
	try {
		const res = await fetch('/api/gui-stream/status', { cache: 'no-store' })
		_statusFetchedAt = Date.now()
		if (!res.ok) {
			_statusChannel = null
			return
		}
		const j = await res.json()
		_statusChannel = j?.enabled && Number.isFinite(j.channel) ? j.channel : null
	} catch {
		_statusFetchedAt = Date.now()
		_statusChannel = null
	} finally {
		_statusFetching = false
		reevaluate()
	}
}

function reevaluate() {
	const want = guiStreamSupported() && _statusChannel != null && _lastTracked.includes(_statusChannel)
	if (want && !_acquired) {
		_acquired = true
		acquireGuiStream()
		_unsubFrames = subscribeGuiStreamFrames(() => {
			const ch = guiStreamChannel()
			if (ch == null) return
			for (const fn of _repaint) {
				try {
					fn(ch)
				} catch {
					/* a bad listener must not break the frame path */
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

/**
 * The compose preview's current channel set changed — decide whether the live stream should run.
 * @param {number[]} channels
 */
export function noteTrackedChannels(channels) {
	_lastTracked = Array.isArray(channels) ? channels : []
	if (_lastTracked.length && guiStreamSupported()) void fetchStatus()
	reevaluate()
}

/** @param {(channel: number) => void} fn repaint scheduler, called once per decoded frame */
export function subscribeLiveStreamRepaint(fn) {
	_repaint.add(fn)
	return () => _repaint.delete(fn)
}

/**
 * Draw the newest live frame into a compose cell IF the stream carries this cell's channel.
 * Same letterbox math as the JPEG path. Returns false when the JPEG fallback should draw instead.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cellW
 * @param {number} cellH
 * @param {number} channel
 * @returns {boolean}
 */
export function drawLiveStreamCell(ctx, cellW, cellH, channel) {
	if (!_acquired) return false
	if (guiStreamChannel() !== channel) return false
	const frame = guiStreamFrame()
	if (!frame) return false
	const iw = frame.displayWidth
	const ih = frame.displayHeight
	if (!(iw > 0) || !(ih > 0)) return false
	const scale = Math.min(cellW / iw, cellH / ih)
	const dw = iw * scale
	const dh = ih * scale
	try {
		ctx.drawImage(frame, (cellW - dw) / 2, (cellH - dh) / 2, dw, dh)
		return true
	} catch {
		// A frame closed mid-draw (stream teardown race) — JPEG fallback this paint.
		return false
	}
}

/** Test/inspection hook. */
export function liveStreamPreviewState() {
	return { acquired: _acquired, statusChannel: _statusChannel, tracked: [..._lastTracked] }
}
