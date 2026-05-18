/**
 * Channel×layer playback matrix: AMCP PLAY/STOP intercepts, or Caspar OSC when enabled.
 * @see companion-module-casparcg-server/src/playback-tracker.js
 */

'use strict'

const media = require('./playback-tracker-media')
const osc = require('./playback-tracker-osc')

/**
 * @param {{ _playbackMatrix?: object, gatheredInfo?: { channelXml?: Record<string, string> }, state?: import('events').EventEmitter }} ctx
 * @param {number|string} channel
 * @param {number|string} layer
 * @param {string} clip
 * @param {{ loop?: boolean }} opts
 */
function recordPlay(ctx, channel, layer, clip, opts = {}) {
	const ch = parseInt(channel, 10)
	const ln = parseInt(layer, 10)
	if (!Number.isFinite(ch) || !Number.isFinite(ln)) return

	if (!ctx._playbackMatrix) ctx._playbackMatrix = {}
	const key = `${ch}-${ln}`
	const durationMs = media.resolveClipDurationMs(ctx, clip)
	ctx._playbackMatrix[key] = {
		channel: ch,
		layer: ln,
		clip: String(clip || ''),
		startedAt: Date.now(),
		durationMs,
		playing: true,
		loop: !!opts.loop,
		isRoute: media.isRouteClip(clip),
	}
	emitMatrix(ctx)
}

/**
 * @param {{ _playbackMatrix?: object, state?: import('events').EventEmitter }} ctx
 */
function recordStop(ctx, channel, layer) {
	const ch = parseInt(channel, 10)
	const ln = parseInt(layer, 10)
	if (!Number.isFinite(ch) || !Number.isFinite(ln)) return
	if (!ctx._playbackMatrix) return
	const key = `${ch}-${ln}`
	delete ctx._playbackMatrix[key]
	emitMatrix(ctx)
}

function emitMatrix(ctx) {
	const snapshot = getMatrixSnapshot(ctx)
	if (ctx.state && typeof ctx.state.emit === 'function') {
		ctx.state.emit('change', 'playback.matrix', snapshot)
	}
}

/**
 * Drop all AMCP-tracked layers for a Caspar channel (after CLEAR channel or equivalent).
 * @param {{ _playbackMatrix?: object, state?: import('events').EventEmitter }} ctx
 * @param {number|string} channel
 */
function clearChannelFromMatrix(ctx, channel) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || !ctx._playbackMatrix) return
	const prefix = `${ch}-`
	for (const key of Object.keys(ctx._playbackMatrix)) {
		if (key.startsWith(prefix)) delete ctx._playbackMatrix[key]
	}
	emitMatrix(ctx)
}

function getMatrixSnapshot(ctx) {
	return { ...(ctx._playbackMatrix || {}) }
}

/**
 * @param {{ _playbackMatrix?: object, oscState?: object }} ctx
 * @returns {object}
 */
function getMatrixForState(ctx) {
	if (osc.isOscPlaybackActive(ctx)) {
		return osc.buildMatrixFromOsc(ctx)
	}
	return getMatrixSnapshot(ctx)
}

/**
 * @param {{ _playbackMatrix?: object, gatheredInfo?: { channelXml?: Record<string, string> }, state?: import('events').EventEmitter }} ctx
 */
async function reconcilePlaybackMatrixFromGatheredXml(ctx) {
	if (osc.isOscPlaybackActive(ctx)) return
	const { parseLayerFgClipsFromChannelXml, pathsMatch } = require('./live-scene-reconcile')
	if (!ctx?._playbackMatrix) return
	const matrix = ctx._playbackMatrix
	const keys = Object.keys(matrix)
	if (keys.length === 0) return

	for (const key of keys) {
		const cell = matrix[key]
		if (!cell?.playing) continue
		if (cell.isRoute) continue

		const ch = cell.channel
		const ln = String(cell.layer)
		const xml = ctx.gatheredInfo?.channelXml?.[String(ch)]
		if (!xml || !String(xml).trim()) continue

		let fgByLayer
		try {
			fgByLayer = await parseLayerFgClipsFromChannelXml(xml)
		} catch {
			continue
		}
		const actual = fgByLayer[ln] != null ? String(fgByLayer[ln]) : ''
		const expected = cell.clip

		if (!String(actual).trim()) {
			recordStop(ctx, ch, ln)
			continue
		}
		if (!pathsMatch(expected, actual)) {
			recordPlay(ctx, ch, ln, actual, { loop: !!cell.loop })
		}
	}
}

module.exports = {
	recordPlay,
	recordStop,
	clearChannelFromMatrix,
	getMatrixForState,
	buildMatrixFromOsc: osc.buildMatrixFromOsc,
	getOccupiedLayerNumbersFromOsc: osc.getOccupiedLayerNumbersFromOsc,
	isOscPlaybackActive: osc.isOscPlaybackActive,
	resolveClipDurationMs: media.resolveClipDurationMs,
	resolveClipDurationMsWithDiskProbe: media.resolveClipDurationMsWithDiskProbe,
	getOscClipEndFadeDelayMs: osc.getOscClipEndFadeDelayMs,
	reconcilePlaybackMatrixFromGatheredXml,
}
