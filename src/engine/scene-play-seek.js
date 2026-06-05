'use strict'

const { normalizeStartBehaviour } = require('../config/editor-defaults')
const { getMatrixForState } = require('../state/playback-tracker')
const { isOscPlaybackActive } = require('../state/playback-tracker-osc')
const { resolveClipDurationMs } = require('../state/playback-tracker')
const { PGM_BANK_B_OFFSET } = require('./scene-transition')

/**
 * @param {number|string} physicalLayer
 * @returns {number|null} logical scene layer number (1-based)
 */
function logicalLayerFromPhysical(physicalLayer) {
	const n = parseInt(physicalLayer, 10)
	if (!Number.isFinite(n) || n < 1) return null
	if (n > PGM_BANK_B_OFFSET) return n - PGM_BANK_B_OFFSET
	return n
}

function lastPlayKey(channel, layerNumber) {
	return `${parseInt(channel, 10)}-${parseInt(layerNumber, 10)}`
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {number} layerNumber logical scene layer
 * @param {number} frame
 */
function rememberLastPlayFrame(ctx, channel, layerNumber, frame) {
	if (!Number.isFinite(frame)) return
	const ch = parseInt(channel, 10)
	const ln = parseInt(layerNumber, 10)
	if (!Number.isFinite(ch) || !Number.isFinite(ln)) return
	if (!ctx._lastPlayFrameByChannelLayer) ctx._lastPlayFrameByChannelLayer = {}
	ctx._lastPlayFrameByChannelLayer[lastPlayKey(ch, ln)] = Math.max(0, Math.floor(frame))
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {number} layerNumber
 * @returns {number|null}
 */
function getLastPlayFrame(ctx, channel, layerNumber) {
	const key = lastPlayKey(channel, layerNumber)
	const v = ctx._lastPlayFrameByChannelLayer?.[key]
	return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null
}

/**
 * @param {{ clips?: object[] } | null | undefined} layer
 * @param {number} ms
 */
function clipAtTimelineMs(layer, ms) {
	if (!layer?.clips?.length) return null
	for (const c of layer.clips) {
		const st = c.startTime || 0
		const dur = c.duration || 0
		if (ms >= st && ms < st + dur) return c
	}
	return null
}

/**
 * @param {object} layer incoming scene layer
 * @param {object|null} timelineClip active clip when inheriting
 * @returns {'beginning' | 'relativeToPrevious'}
 */
function resolveEffectiveStartBehaviour(layer, timelineClip) {
	const raw = layer?.startBehaviour
	if (raw === 'beginning' || raw === 'relativeToPrevious') return raw
	if (timelineClip) return normalizeStartBehaviour(timelineClip.startBehaviour)
	return 'beginning'
}

/**
 * @param {object} ctx
 */
function getActiveTimelineForTake(ctx) {
	const eng = ctx?.timelineEngine
	if (!eng || typeof eng.getPlayback !== 'function') return null
	const pb = eng.getPlayback()
	if (!pb?.timelineId || !eng.timelines) return null
	const model = eng.timelines.get(pb.timelineId)
	if (!model) return null
	let positionMs = pb.position ?? 0
	if (pb.playing && typeof eng._currentPositionMs === 'function') {
		positionMs = eng._currentPositionMs()
	} else if (pb.playing && pb._p0 != null && pb._t0 != null) {
		positionMs = pb._p0 + (Date.now() - pb._t0)
	}
	return { model, positionMs, timelineId: pb.timelineId }
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {number} physicalLayer on-air Caspar layer
 * @param {number} fps
 * @returns {number|null}
 */
function getLivePlayheadFrames(ctx, channel, physicalLayer, fps) {
	const ch = parseInt(channel, 10)
	const ln = parseInt(physicalLayer, 10)
	const rate = Math.max(1, fps || 25)
	if (!Number.isFinite(ch) || !Number.isFinite(ln)) return null

	if (isOscPlaybackActive(ctx) && ctx.oscState) {
		const snap = ctx.oscState.getSnapshot()
		const chan = snap?.channels?.[ch] ?? snap?.channels?.[String(ch)]
		const layer = chan?.layers?.[ln] ?? chan?.layers?.[String(ln)]
		if (layer && String(layer.type || '') !== 'empty') {
			const f = layer.file || {}
			if (Number.isFinite(f.frameElapsed) && f.frameElapsed >= 0) {
				return Math.max(0, Math.floor(f.frameElapsed))
			}
			if (Number.isFinite(f.elapsed) && f.elapsed >= 0) {
				return Math.max(0, Math.floor(f.elapsed * rate))
			}
		}
	}

	const vars = ctx.variables
	if (vars && typeof vars === 'object') {
		const ts = vars[`channel_${ch}_layer_${ln}_time_sec`]
		if (ts !== undefined && ts !== null && String(ts).trim() !== '') {
			const sec = parseFloat(String(ts))
			if (Number.isFinite(sec) && sec >= 0) return Math.max(0, Math.floor(sec * rate))
		}
	}

	const matrix = getMatrixForState(ctx)
	const cell = matrix[`${ch}-${ln}`]
	if (cell?.playing && !cell.isRoute) {
		const elapsedMs = Math.max(0, Date.now() - (cell.startedAt || Date.now()))
		let capMs = elapsedMs
		if (cell.durationMs != null && cell.durationMs > 0) {
			capMs = cell.loop ? elapsedMs : Math.min(elapsedMs, cell.durationMs)
		}
		return Math.max(0, Math.floor((capMs * rate) / 1000))
	}

	return null
}

/**
 * @param {object} ctx app ctx
 * @param {number} channel
 * @param {number} physicalLayer
 * @param {number} fps
 */
function elapsedFramesFromPlayback(ctx, channel, physicalLayer, fps) {
	return getLivePlayheadFrames(ctx, channel, physicalLayer, fps) ?? 0
}

/**
 * Timeline clip at take / inherit — beginning → in-point; relativeToPrevious → live PGM then timeline offset.
 * @param {object} clip
 * @param {number} positionMs
 * @param {number} fps
 * @param {'beginning' | 'relativeToPrevious'} sb
 * @param {object} ctx
 * @param {number} channel
 * @param {number} onAirPhysicalLayer
 * @param {boolean} forceCut
 */
function seekFramesFromTimelineClip(clip, positionMs, fps, sb, ctx, channel, onAirPhysicalLayer, forceCut) {
	const src = String(clip.source?.value || '')
	if (src.startsWith('route://')) return null
	const rate = Math.max(1, fps || 25)
	const inFrames = Number(clip.inPoint) || 0
	if (sb === 'beginning') return inFrames

	if (!forceCut) {
		const live = getLivePlayheadFrames(ctx, channel, onAirPhysicalLayer, rate)
		if (live != null) return live
	}
	const localMs = Math.max(0, positionMs - (clip.startTime || 0))
	return inFrames + Math.floor((localMs * rate) / 1000)
}

/**
 * Scene take SEEK resolution (WO-33).
 * @param {object} layer
 * @param {object} ctx
 * @param {{ channel: number, layerNumber: number, physicalLayer: number, fps: number, forceCut?: boolean, phys: Function, activeBank: string, incoming: object }} opts
 * @returns {number|null}
 */
function resolvePlaySeekFramesForSceneLayer(layer, ctx, opts) {
	const channel = parseInt(opts.channel, 10)
	const layerNumber = parseInt(opts.layerNumber ?? layer.layerNumber, 10)
	const fps = Math.max(1, opts.fps || 25)
	const forceCut = !!opts.forceCut
	const phys = opts.phys
	const activeBank = opts.activeBank
	const incoming = opts.incoming

	if (layer.playSeekFrames != null && Number.isFinite(Number(layer.playSeekFrames))) {
		const f = Math.max(0, Math.floor(Number(layer.playSeekFrames)))
		rememberLastPlayFrame(ctx, channel, layerNumber, f)
		return f
	}

	const timelineCtx = getActiveTimelineForTake(ctx)
	const layers = incoming?.layers || []
	const layerIdx = layers.findIndex((l) => l.layerNumber === layerNumber)
	const tlIdx = layerIdx >= 0 ? layerIdx : Math.max(0, layerNumber - 1)
	const tlLayer = timelineCtx?.model?.layers?.[tlIdx]
	const clip = tlLayer && timelineCtx ? clipAtTimelineMs(tlLayer, timelineCtx.positionMs) : null
	const sb = resolveEffectiveStartBehaviour(layer, clip)
	const onAirPhys = phys(layerNumber, activeBank)

	if (clip && timelineCtx) {
		const frames = seekFramesFromTimelineClip(
			clip,
			timelineCtx.positionMs,
			fps,
			sb,
			ctx,
			channel,
			onAirPhys,
			forceCut
		)
		if (frames != null) {
			rememberLastPlayFrame(ctx, channel, layerNumber, frames)
			return frames
		}
	}

	if (sb === 'beginning') return 0

	if (!forceCut) {
		const live = getLivePlayheadFrames(ctx, channel, onAirPhys, fps)
		if (live != null) {
			rememberLastPlayFrame(ctx, channel, layerNumber, live)
			return live
		}
	}

	const last = getLastPlayFrame(ctx, channel, layerNumber)
	if (last != null) return last

	if (!forceCut && sb === 'relativeToPrevious') {
		const matrixFallback = getLivePlayheadFrames(ctx, channel, onAirPhys, fps)
		if (matrixFallback != null && matrixFallback > 0) return matrixFallback
	}

	return null
}

/**
 * Timeline program transport frame.
 * @param {object} clip
 * @param {number} ms
 * @param {object} tl
 * @param {object} self app ctx
 * @param {{ atEntry?: boolean, channel?: number, physicalLayer?: number }} [opts]
 */
function resolveTimelineClipFrame(clip, ms, tl, self, opts = {}) {
	const src = String(clip.source?.value || '')
	const isRoute = src.startsWith('route://')
	const fps = Math.max(1, tl.fps || 25)
	const inFrames = Number(clip.inPoint) || 0
	const localMs = Math.max(0, ms - clip.startTime)
	const relativeFrame = Math.floor((localMs * fps) / 1000)
	const atEntry = !!opts.atEntry
	const sb = normalizeStartBehaviour(clip.startBehaviour)
	const channel = opts.channel
	const physicalLayer = opts.physicalLayer

	let frame = 0
	if (!isRoute) {
		if (atEntry && sb === 'beginning') {
			frame = inFrames
		} else if (atEntry && sb === 'relativeToPrevious' && channel != null && physicalLayer != null) {
			const live = getLivePlayheadFrames(self, channel, physicalLayer, fps)
			frame = live != null ? live : inFrames + relativeFrame
		} else {
			frame = inFrames + relativeFrame
		}
	}

	let implicitLoop = false
	if (!isRoute && src) {
		const durMs = resolveClipDurationMs(self, src)
		if (durMs != null && durMs > 0) {
			const totalFrames = Math.max(1, Math.floor((durMs * fps) / 1000))
			if (inFrames < totalFrames) {
				const spanFrames = totalFrames - inFrames
				const spanMs = (spanFrames * 1000) / fps
				if (clip.duration > spanMs + 0.5) {
					implicitLoop = true
					if (!atEntry || sb !== 'beginning') {
						frame = inFrames + (relativeFrame % spanFrames)
					}
				}
			}
		}
	}

	const logical = physicalLayer != null ? logicalLayerFromPhysical(physicalLayer) : null
	if (logical != null && channel != null && !isRoute) {
		rememberLastPlayFrame(self, channel, logical, frame)
	}

	return {
		frame,
		implicitLoop,
		isRoute,
		relativeFrame,
		inFrames,
		fps,
	}
}

module.exports = {
	logicalLayerFromPhysical,
	rememberLastPlayFrame,
	getLastPlayFrame,
	clipAtTimelineMs,
	resolveEffectiveStartBehaviour,
	getLivePlayheadFrames,
	getActiveTimelineForTake,
	elapsedFramesFromPlayback,
	resolvePlaySeekFramesForSceneLayer,
	resolveTimelineClipFrame,
	seekFramesFromTimelineClip,
}
