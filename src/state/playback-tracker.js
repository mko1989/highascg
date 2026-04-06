/**
 * Channel×layer playback matrix: AMCP PLAY/STOP intercepts, or Caspar OSC when enabled.
 * @see companion-module-casparcg-server/src/playback-tracker.js
 */

'use strict'

const { parseCinfMedia } = require('../media/cinf-parse')

/**
 * @param {{ oscState?: { getSnapshot?: () => object } | null }} ctx
 * @returns {boolean}
 */
function isOscPlaybackActive(ctx) {
	return !!(ctx && ctx.oscState && typeof ctx.oscState.getSnapshot === 'function')
}

/**
 * @param {object} layer — OSC stage layer aggregate
 * @returns {string}
 */
function pickClipFromOscLayer(layer) {
	const f = layer.file || {}
	if (f.name) return String(f.name)
	if (f.path) return String(f.path)
	const t = layer.template || {}
	if (t.path) return String(t.path)
	const typ = layer.type && String(layer.type) !== 'empty' ? String(layer.type) : ''
	return typ ? `[${typ}]` : ''
}

/**
 * @param {string} clip
 * @returns {boolean}
 */
function isRouteClip(clip) {
	return String(clip || '').trim().startsWith('route://')
}

/**
 * @param {{ _mediaProbeCache?: Record<string, { durationMs?: number }>, mediaDetails?: Record<string, string>, CHOICES_MEDIAFILES?: Array<{ id: string, cinf?: string }> }} ctx
 * @param {string} clipId
 * @returns {number | null}
 */
function resolveClipDurationMs(ctx, clipId) {
	if (!clipId || isRouteClip(clipId)) return null
	const raw = String(clipId).replace(/^"(.*)"$/, '$1').trim()
	const id = raw.split(/\s+/)[0].replace(/^"|"$/g, '')

	const cache = ctx._mediaProbeCache || {}
	if (cache[id]?.durationMs > 0) return cache[id].durationMs

	const md = (ctx.mediaDetails || {})[id]
	if (md) {
		const parsed = parseCinfMedia(typeof md === 'string' ? md : String(md))
		if (parsed.durationMs > 0) return parsed.durationMs
	}

	const files = ctx.CHOICES_MEDIAFILES || []
	const row = files.find((c) => c.id === id)
	if (row?.cinf) {
		const parsed = parseCinfMedia(row.cinf)
		if (parsed.durationMs > 0) return parsed.durationMs
	}

	return null
}

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
	const durationMs = resolveClipDurationMs(ctx, clip)
	ctx._playbackMatrix[key] = {
		channel: ch,
		layer: ln,
		clip: String(clip || ''),
		startedAt: Date.now(),
		durationMs,
		playing: true,
		loop: !!opts.loop,
		isRoute: isRouteClip(clip),
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
 * Build matrix from `/channel/N/stage/layer/L/...` OSC (authoritative when listener is on).
 * @param {{ oscState: { getSnapshot: () => object }, CHOICES_MEDIAFILES?: unknown, mediaDetails?: unknown, _mediaProbeCache?: unknown }} ctx
 */
function buildMatrixFromOsc(ctx) {
	const snap = ctx.oscState.getSnapshot()
	const out = {}
	const channels = (snap && snap.channels) || {}
	for (const k of Object.keys(channels)) {
		const ch = parseInt(k, 10)
		if (!Number.isFinite(ch)) continue
		const chan = channels[k]
		if (!chan || typeof chan !== 'object') continue
		const layers = chan.layers || {}
		for (const lid of Object.keys(layers)) {
			const ln = parseInt(lid, 10)
			if (!Number.isFinite(ln)) continue
			const layer = layers[lid]
			if (!layer || typeof layer !== 'object') continue
			const typ = String(layer.type || 'empty')
			if (typ === 'empty') continue
			const clip = pickClipFromOscLayer(layer)
			if (!clip) continue
			const key = `${ch}-${ln}`
			const f = layer.file || {}
			let durationSec = Number.isFinite(f.duration) ? f.duration : null
			const elapsedSec = Number.isFinite(f.elapsed) ? f.elapsed : null
			let durationMs =
				durationSec != null && durationSec > 0 ? Math.round(durationSec * 1000) : resolveClipDurationMs(ctx, clip)
			let progress = Number.isFinite(f.progress) ? f.progress : null
			if (progress == null && Number.isFinite(f.frameElapsed) && Number.isFinite(f.frameTotal) && f.frameTotal > 0) {
				progress = Math.min(1, Math.max(0, f.frameElapsed / f.frameTotal))
				if (durationMs == null && durationSec == null && Number.isFinite(elapsedSec) && progress > 0.001) {
					const tot = elapsedSec / progress
					if (Number.isFinite(tot) && tot > 0) {
						durationSec = tot
						durationMs = Math.round(tot * 1000)
					}
				}
			}
			let startedAt = Date.now()
			if (elapsedSec != null && elapsedSec >= 0 && durationMs != null && durationMs > 0) {
				startedAt = Date.now() - Math.round(elapsedSec * 1000)
			}
			const remainingSec = Number.isFinite(f.remaining) ? f.remaining : null
			const cell = {
				channel: ch,
				layer: ln,
				clip,
				startedAt,
				durationMs,
				playing: layer.paused !== true,
				loop: !!f.loop,
				isRoute: isRouteClip(clip),
				source: 'osc',
			}
			if (elapsedSec != null) cell.elapsedSec = elapsedSec
			if (remainingSec != null) cell.remainingSec = remainingSec
			if (progress != null) cell.progress = progress
			out[key] = cell
		}
	}
	return out
}

/**
 * Layer numbers on a channel that OSC reports as non-empty (same filter as {@link buildMatrixFromOsc}).
 * Used by FTB to fade only layers that actually have producers.
 * @param {{ oscState?: { getSnapshot?: () => object } }} ctx
 * @param {number} ch — Caspar channel (1-based)
 * @returns {number[]}
 */
function getOccupiedLayerNumbersFromOsc(ctx, ch) {
	if (!isOscPlaybackActive(ctx)) return []
	const snap = ctx.oscState.getSnapshot()
	const channels = (snap && snap.channels) || {}
	const chan = channels[ch] ?? channels[String(ch)]
	if (!chan || !chan.layers) return []
	const out = []
	for (const lid of Object.keys(chan.layers)) {
		const ln = parseInt(lid, 10)
		if (!Number.isFinite(ln)) continue
		const layer = chan.layers[lid]
		if (!layer || typeof layer !== 'object') continue
		const typ = String(layer.type || 'empty')
		if (typ === 'empty') continue
		const clip = pickClipFromOscLayer(layer)
		if (!clip) continue
		out.push(ln)
	}
	return out.sort((a, b) => a - b)
}

/**
 * @param {{ _playbackMatrix?: object, oscState?: object }} ctx
 * @returns {object}
 */
function getMatrixForState(ctx) {
	if (isOscPlaybackActive(ctx)) {
		return buildMatrixFromOsc(ctx)
	}
	return getMatrixSnapshot(ctx)
}

/**
 * @param {{ _playbackMatrix?: object, gatheredInfo?: { channelXml?: Record<string, string> }, state?: import('events').EventEmitter }} ctx
 */
async function reconcilePlaybackMatrixFromGatheredXml(ctx) {
	if (isOscPlaybackActive(ctx)) return
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
	buildMatrixFromOsc,
	getOccupiedLayerNumbersFromOsc,
	isOscPlaybackActive,
	resolveClipDurationMs,
	reconcilePlaybackMatrixFromGatheredXml,
}
