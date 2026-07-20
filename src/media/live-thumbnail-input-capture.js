/**
 * Lazy live-thumbnail capture for **dedicated input channels** (2026-07-19).
 *
 * A look layer whose source is a DeckLink input has no media file, so the deck card had no
 * thumbnail at all. Its dedicated input channel (`route://<ch>-<slot>`) can be PRINTed like any
 * other channel, and that still IS the captured frame — so `GET /api/thumbnail/live/:channel`
 * now captures on demand for input channels only.
 *
 * "Only for input channels" matters: PGM/PRV buses keep the old behaviour (serve cache or 404,
 * never PRINT from a GET), so a browser cannot make the program bus print on every render.
 *
 * A dead input (DeckLink 4 with the camera powered off → PLAY 404s, PRINT yields nothing) must
 * not turn into a hot retry loop. The capped exponential backoff and the log-on-transition
 * behaviour come from `src/preview/compose-preview-backpressure.js`; `captureLiveThumbnailToCache`
 * already single-flights per channel, so concurrent GETs share one PRINT.
 */
'use strict'

const { createBackoffGate } = require('../preview/compose-preview-backpressure')

/** Slower than the compose-preview schedule: a PRINT is expensive and a dead camera stays dead. */
const INPUT_CAPTURE_BACKOFF_BASE_MS = 3000
const INPUT_CAPTURE_BACKOFF_MAX_MS = 120000

/** Hard ceiling on how long a GET may block on a PRINT round-trip. */
const INPUT_CAPTURE_TIMEOUT_MS = 5000

const _gate = createBackoffGate({
	baseMs: INPUT_CAPTURE_BACKOFF_BASE_MS,
	maxMs: INPUT_CAPTURE_BACKOFF_MAX_MS,
})

/**
 * Channels that host a dedicated capture input (DeckLink / V4L2). Pure.
 * @param {object | null | undefined} channelMap
 * @returns {number[]}
 */
function listInputCaptureChannels(channelMap) {
	const out = new Set()
	const push = (v) => {
		const n = parseInt(String(v), 10)
		if (Number.isFinite(n) && n > 0) out.add(n)
	}
	for (const e of Array.isArray(channelMap?.inputChannels) ? channelMap.inputChannels : []) {
		if (e && (e.kind === 'decklink' || e.kind === 'v4l2')) push(e.channel)
	}
	for (const c of Array.isArray(channelMap?.decklinkInputChannels) ? channelMap.decklinkInputChannels : []) push(c)
	for (const c of Array.isArray(channelMap?.v4l2InputChannels) ? channelMap.v4l2InputChannels : []) push(c)
	return [...out].sort((a, b) => a - b)
}

/**
 * @param {object | null | undefined} channelMap
 * @param {number} channel
 * @returns {boolean}
 */
function isInputCaptureChannel(channelMap, channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch <= 0) return false
	return listInputCaptureChannels(channelMap).includes(ch)
}

/**
 * Pure decision: should this GET run a PRINT capture right now?
 *
 * @param {object} args
 * @param {boolean} args.isInputChannel
 * @param {boolean} args.hasCache — a non-empty cached PNG exists on disk
 * @param {boolean} args.stale — cached meta is older than the live-thumbnail TTL
 * @param {boolean} args.gateAllows — backoff window has elapsed (or the channel is healthy)
 * @param {boolean} [args.amcpReady] — Caspar connected
 * @returns {{ attempt: boolean, reason: string }}
 */
function decideInputThumbnailCapture(args) {
	const { isInputChannel, hasCache, stale, gateAllows, amcpReady = true } = args || {}
	if (!isInputChannel) return { attempt: false, reason: 'not_input_channel' }
	if (!amcpReady) return { attempt: false, reason: 'amcp_disconnected' }
	if (hasCache && !stale) return { attempt: false, reason: 'fresh_cache' }
	// Backoff loses to nothing: a dead input serves its stale frame (or 404s) until the window opens.
	if (!gateAllows) return { attempt: false, reason: 'backoff' }
	return { attempt: true, reason: hasCache ? 'stale_cache' : 'no_cache' }
}

/**
 * @param {Promise<any>} p
 * @param {number} ms
 * @param {any} onTimeout
 */
function withTimeout(p, ms, onTimeout) {
	let t = null
	return Promise.race([
		Promise.resolve(p).finally(() => {
			if (t) clearTimeout(t)
		}),
		new Promise((resolve) => {
			t = setTimeout(() => resolve(onTimeout), Math.max(250, ms))
		}),
	])
}

/**
 * Capture the live thumbnail for a dedicated input channel, respecting TTL + backoff.
 * Never throws and never blocks longer than `INPUT_CAPTURE_TIMEOUT_MS`.
 *
 * @param {object} ctx — app context ({ config, amcp, log? })
 * @param {number} channel
 * @param {{ hasCache?: boolean, stale?: boolean, now?: number, capture?: Function, channelMap?: object, timeoutMs?: number }} [opts]
 * @returns {Promise<{ captured: boolean, reason: string, error?: string }>}
 */
async function ensureInputLiveThumbnail(ctx, channel, opts = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const now = opts.now ?? Date.now()

	let channelMap = opts.channelMap
	if (channelMap === undefined) {
		try {
			channelMap = require('../config/routing').getChannelMap(ctx?.config || {})
		} catch {
			channelMap = null
		}
	}

	const decision = decideInputThumbnailCapture({
		isInputChannel: isInputCaptureChannel(channelMap, ch),
		hasCache: opts.hasCache === true,
		stale: opts.stale === true,
		gateAllows: _gate.canAttempt(ch, now),
		amcpReady: !!ctx?.amcp,
	})
	if (!decision.attempt) return { captured: false, reason: decision.reason }

	const capture =
		opts.capture || require('./live-thumbnail-cache-capture').captureLiveThumbnailToCache

	let res
	try {
		res = await withTimeout(capture(ctx, ch, { force: true }), opts.timeoutMs ?? INPUT_CAPTURE_TIMEOUT_MS, {
			ok: false,
			error: 'capture timed out',
		})
	} catch (e) {
		res = { ok: false, error: e?.message || String(e) }
	}

	if (res?.ok) {
		const rec = _gate.recordSuccess(ch)
		if (rec.changed) {
			logOnce(ctx, 'info', `Live input thumbnail ch${ch}: signal restored after ${rec.failures} failed capture(s)`)
		}
		return { captured: true, reason: decision.reason }
	}

	const fail = _gate.recordFailure(ch, now)
	// Log the degrade edge only — a powered-off camera must not write one line per deck render.
	if (fail.changed) {
		logOnce(ctx, 'warn', `Live input thumbnail ch${ch}: no captured frame (${res?.error || 'capture failed'}) — backing off, deck shows a placeholder`)
	}
	return { captured: false, reason: 'capture_failed', error: res?.error || 'capture failed' }
}

/**
 * @param {object} ctx
 * @param {string} level
 * @param {string} msg
 */
function logOnce(ctx, level, msg) {
	try {
		if (typeof ctx?.log === 'function') ctx.log(level, msg)
		else if (level === 'warn') console.warn(`[live-thumb] ${msg}`)
		else console.log(`[live-thumb] ${msg}`)
	} catch {
		/* logging must never break a thumbnail GET */
	}
}

module.exports = {
	INPUT_CAPTURE_BACKOFF_BASE_MS,
	INPUT_CAPTURE_BACKOFF_MAX_MS,
	INPUT_CAPTURE_TIMEOUT_MS,
	listInputCaptureChannels,
	isInputCaptureChannel,
	decideInputThumbnailCapture,
	ensureInputLiveThumbnail,
	/* test seam */
	_gate,
}
