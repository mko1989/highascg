'use strict'

const dirty = require('./compose-preview-dirty')
const playbackTracker = require('../state/playback-tracker')
const { isOscPlaybackActive, pickClipFromOscLayer } = require('../state/playback-tracker-osc')

const SETTLE_BUFFER_MS = 100
const STILL_SETTLE_MS = 150
const DEFAULT_MIX_SETTLE_MS = 600
const DEFAULT_FPS = 50
/** Seconds — treat as ended when remaining at or below this. */
const REMAINING_EPSILON = 0.02

/** @type {Map<number, { mode: 'idle' | 'settling', settleUntil: number, pendingFinal: boolean, idleCaptured: boolean, lastContentSig: string, wasOscLive: boolean }>} */
const _channels = new Map()

function _st(channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return null
	if (!_channels.has(ch)) {
		_channels.set(ch, {
			mode: 'idle',
			settleUntil: 0,
			pendingFinal: false,
			idleCaptured: false,
			lastContentSig: '',
			wasOscLive: false,
		})
	}
	return _channels.get(ch)
}

/**
 * @param {string} clip
 * @returns {boolean}
 */
function isStillImageClip(clip) {
	const id = String(clip || '')
		.trim()
		.split(/\s+/)[0]
		.replace(/^["']|["']$/g, '')
	if (!id) return true
	if (id.startsWith('[HTML]') || /^ndi:\/\//i.test(id) || id.startsWith('route://')) return false
	return /\.(png|jpe?g|gif|bmp|tga|svg|webp)$/i.test(id)
}

/**
 * @param {object} [config]
 * @returns {number}
 */
function resolveFps(config) {
	const cs = config?.casparServer || {}
	const mode = String(cs.screen_1_mode || cs.screen_2_mode || '1080p5000')
	const m = mode.match(/p(\d+)\s*$/i)
	if (m) {
		const n = parseInt(m[1], 10)
		if (n >= 1000) return Math.max(1, Math.round(n / 100))
		if (n > 0 && n <= 120) return n
	}
	return DEFAULT_FPS
}

/**
 * @param {{ transition?: string, durationFrames?: number }} opts
 * @param {object} [config]
 */
function transitionMsFromOpts(opts, config) {
	const t = String(opts?.transition || 'CUT').toUpperCase()
	if (!t || t === 'CUT') return STILL_SETTLE_MS
	const frames = parseInt(String(opts?.durationFrames ?? ''), 10)
	if (Number.isFinite(frames) && frames > 0) {
		return Math.ceil((frames / resolveFps(config)) * 1000) + SETTLE_BUFFER_MS
	}
	return DEFAULT_MIX_SETTLE_MS
}

/**
 * @param {object} f
 * @returns {number | null} remaining seconds, or null if unknown/still
 */
function resolveFileRemainingSec(f) {
	if (!f || typeof f !== 'object') return null
	if (Number.isFinite(f.remaining)) return f.remaining
	if (Number.isFinite(f.duration) && Number.isFinite(f.elapsed)) {
		return Math.max(0, f.duration - f.elapsed)
	}
	return null
}

/**
 * Layer has OSC remaining > 0 (or looping video still playing).
 * @param {number | null} remSec
 * @param {object} f
 * @param {object} layer
 */
function fileHasActiveRemaining(remSec, f, layer) {
	if (f?.loop === true || f?.loop === 1) {
		return layer?.paused !== true
	}
	if (remSec == null) return false
	return remSec > REMAINING_EPSILON
}

/**
 * @param {object} layer
 * @returns {boolean}
 */
function layerHasVisibleContent(layer) {
	if (!layer || typeof layer !== 'object') return false
	// Caspar often omits type until later OSC; only skip when explicitly empty.
	if (layer.type != null && String(layer.type) === 'empty') return false
	const fg = layer.file || {}
	const bg = layer.backgroundFile || {}
	if (fg.name || fg.path) return true
	if (bg.name || bg.path) return true
	if (layer.template?.path) return true
	return !!pickClipFromOscLayer(layer)
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @returns {{ hasContent: boolean, hasActiveRemaining: boolean, contentSig: string, source: 'osc' | 'fallback' }}
 */
function analyzeChannelOsc(ctx, channel) {
	const ch = parseInt(String(channel), 10)
	if (isOscPlaybackActive(ctx)) {
		const snap = ctx.oscState.getSnapshot()
		const channels = snap?.channels || {}
		const chan = channels[ch] ?? channels[String(ch)]
		if (!chan?.layers) {
			return { hasContent: false, hasActiveRemaining: false, contentSig: '', source: 'osc' }
		}
		let hasContent = false
		let hasActiveRemaining = false
		const sigParts = []
		for (const lid of Object.keys(chan.layers).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
			const layer = chan.layers[lid]
			if (!layerHasVisibleContent(layer)) continue
			hasContent = true
			sigParts.push(`${lid}:${layer.type}:${pickClipFromOscLayer(layer)}`)
			const fg = layer.file || {}
			const bg = layer.backgroundFile || {}
			if (fg.name || fg.path) {
				const rem = resolveFileRemainingSec(fg)
				sigParts.push(`fg:${rem ?? 'null'}`)
				if (fileHasActiveRemaining(rem, fg, layer)) hasActiveRemaining = true
			}
			if (bg.name || bg.path) {
				const rem = resolveFileRemainingSec(bg)
				sigParts.push(`bg:${rem ?? 'null'}`)
				if (fileHasActiveRemaining(rem, bg, layer)) hasActiveRemaining = true
			}
		}
		return {
			hasContent,
			hasActiveRemaining,
			contentSig: sigParts.join('|'),
			source: 'osc',
		}
	}
	return { ...analyzeChannelFallback(ctx, ch), source: 'fallback' }
}

/**
 * @param {object} ctx
 * @param {number} channel
 */
function analyzeChannelFallback(ctx, channel) {
	const matrix = playbackTracker.getMatrixForState(ctx)
	let hasContent = false
	let hasActiveRemaining = false
	const sigParts = []
	for (const cell of Object.values(matrix || {})) {
		if (!cell || cell.channel !== channel) continue
		hasContent = true
		sigParts.push(`${cell.layer}:${cell.clip}`)
		if (!cell.playing) continue
		if (cell.loop) {
			hasActiveRemaining = true
			sigParts.push('loop')
			continue
		}
		if (isStillImageClip(cell.clip)) continue
		if (Number.isFinite(cell.remainingSec)) {
			if (cell.remainingSec > REMAINING_EPSILON) hasActiveRemaining = true
			sigParts.push(`rem:${cell.remainingSec}`)
		} else if (cell.durationMs > 0 && cell.startedAt) {
			const rem = (cell.durationMs - (Date.now() - cell.startedAt)) / 1000
			if (rem > REMAINING_EPSILON) hasActiveRemaining = true
			sigParts.push(`rem:${rem.toFixed(2)}`)
		} else {
			hasActiveRemaining = true
			sigParts.push('live')
		}
	}
	return { hasContent, hasActiveRemaining, contentSig: sigParts.join('|') }
}

/** @deprecated use analyzeChannelOsc */
function channelHasPlayingVideo(ctx, channel) {
	return analyzeChannelOsc(ctx, channel).hasActiveRemaining
}

/**
 * @param {number|string} channel
 * @param {number} ms
 */
function scheduleSettle(channel, ms) {
	const st = _st(channel)
	if (!st) return
	st.mode = 'settling'
	st.settleUntil = Date.now() + Math.max(STILL_SETTLE_MS, ms)
	st.pendingFinal = false
}

function onProgramMutation(ctx, channel, opts = {}) {
	scheduleSettle(channel, transitionMsFromOpts(opts, ctx?.config))
}

function onPlaybackPlay() {}

function onPlaybackPaused() {}

function onPlaybackStop() {}

function onChannelClear(channel) {
	const st = _st(channel)
	if (!st) return
	st.mode = 'idle'
	st.settleUntil = 0
	st.pendingFinal = false
	st.idleCaptured = true
	st.lastContentSig = ''
	st.wasOscLive = false
}

function onSceneTake(channel, fadeDurFrames, fps) {
	const rate = fps > 0 ? fps : DEFAULT_FPS
	const ms =
		fadeDurFrames > 0 ? Math.ceil((fadeDurFrames / rate) * 1000) + SETTLE_BUFFER_MS : STILL_SETTLE_MS
	scheduleSettle(channel, ms)
}

function onTimelinePlaying() {}

function onTimelinePaused() {}

/**
 * True when compose preview WS broadcast is allowed (transition settle complete).
 * @param {number|string} channel
 * @returns {boolean}
 */
function isComposePreviewSettled(channel) {
	const st = _st(channel)
	if (!st) return true
	const now = Date.now()
	if (st.mode === 'settling') {
		if (now < st.settleUntil) return false
		st.mode = 'idle'
	}
	return true
}

/**
 * @param {object} ctx
 * @param {number|string} channel
 * @param {number} tickIntervalMs
 */
function shouldCaptureOnTick(ctx, channel, tickIntervalMs) {
	const st = _st(channel)
	if (!st) return false
	const ch = parseInt(String(channel), 10)
	const now = Date.now()

	if (st.mode === 'settling') {
		if (now < st.settleUntil) return false
		st.mode = 'idle'
	}

	const osc = analyzeChannelOsc(ctx, ch)

	if (!osc.hasContent) {
		st.pendingFinal = false
		st.idleCaptured = true
		st.wasOscLive = false
		st.lastContentSig = ''
		return false
	}

	if (osc.contentSig !== st.lastContentSig) {
		st.idleCaptured = false
		st.pendingFinal = false
		st.lastContentSig = osc.contentSig
	}

	if (osc.hasActiveRemaining) {
		st.wasOscLive = true
		st.idleCaptured = false
		st.pendingFinal = false
		dirty.bumpDirty(ch, 'osc.live')
		return dirty.shouldCapture(ch, { minIntervalMs: Math.max(0, tickIntervalMs - 10) })
	}

	if (st.idleCaptured) {
		return false
	}

	if (!st.pendingFinal) {
		st.pendingFinal = true
		st.wasOscLive = false
		dirty.bumpDirty(ch, 'osc.final')
	}
	return dirty.shouldCapture(ch, { minIntervalMs: 0 })
}

/**
 * @param {object} ctx
 * @param {number|string} channel
 */
function onCaptureComplete(ctx, channel) {
	const st = _st(channel)
	if (!st) return
	const ch = parseInt(String(channel), 10)
	const osc = analyzeChannelOsc(ctx, ch)
	if (st.pendingFinal || !osc.hasActiveRemaining) {
		st.pendingFinal = false
		st.idleCaptured = true
		st.wasOscLive = false
	}
}

function requestInitialCapture(channels) {
	for (const ch of channels) {
		scheduleSettle(ch, STILL_SETTLE_MS)
		const st = _st(ch)
		if (st) {
			st.idleCaptured = false
			st.pendingFinal = true
		}
	}
}

function reset() {
	_channels.clear()
}

function getStats() {
	let settling = 0
	let pendingFinal = 0
	let oscLive = 0
	let idleCaptured = 0
	for (const st of _channels.values()) {
		if (st.mode === 'settling') settling += 1
		if (st.pendingFinal) pendingFinal += 1
		if (st.wasOscLive) oscLive += 1
		if (st.idleCaptured) idleCaptured += 1
	}
	return { tracked: _channels.size, settling, pendingFinal, oscLive, idleCaptured }
}

module.exports = {
	isStillImageClip,
	analyzeChannelOsc,
	channelHasPlayingVideo,
	resolveFileRemainingSec,
	fileHasActiveRemaining,
	scheduleSettle,
	onProgramMutation,
	onPlaybackPlay,
	onPlaybackPaused,
	onPlaybackStop,
	onChannelClear,
	onSceneTake,
	onTimelinePlaying,
	onTimelinePaused,
	isComposePreviewSettled,
	shouldCaptureOnTick,
	onCaptureComplete,
	requestInitialCapture,
	reset,
	getStats,
	transitionMsFromOpts,
}
