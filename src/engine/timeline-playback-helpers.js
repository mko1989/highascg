'use strict'

const { audioRouteToAudioFilter } = require('./audio-route')
const { audioFilterParam } = require('../caspar/amcp-utils')
const { sceneLayerRotationMixerLines } = require('./scene-layer-rotation-amcp')

/**
 * Reset Caspar mixer transforms that persist on a layer (crop, color, key, etc.).
 * Must run before applying `layer.effects` / clip.effects so omitting an effect clears the GPU state.
 * Values mirror buildEffectAmcpLinesPlayback defaults / effect-registry.js.
 * @param {string} cl - e.g. "1-10"
 * @returns {string[]}
 */
function mixerEffectNeutralLines(cl) {
	return [
		`MIXER ${cl} BLEND NORMAL`,
		`MIXER ${cl} BRIGHTNESS 1 0`,
		`MIXER ${cl} CONTRAST 1 0`,
		`MIXER ${cl} SATURATION 1 0`,
		`MIXER ${cl} LEVELS 0 1 1 0 1 0`,
		`MIXER ${cl} CHROMA None 0.34 0.44 1 0`,
		`MIXER ${cl} CROP 0 0 1 1 0`,
		/* CLIP uses x y xScale yScale (same as FILL), not left/width/top/height — 0 1 0 1 would zero width → black. */
		`MIXER ${cl} CLIP 0 0 1 1 0`,
		`MIXER ${cl} PERSPECTIVE 0 0 1 0 1 1 0 1 0`,
	]
}

/**
 * Build AMCP mixer command lines for a single effect during timeline playback (WO-22).
 * Mirrors effect-registry.js effectToAmcpLines() — server CJS version.
 */
function buildEffectAmcpLinesPlayback(type, params, cl) {
	const p = params || {}
	switch (type) {
		case 'blend_mode':
			return [`MIXER ${cl} BLEND ${String(p.mode || 'Normal').toUpperCase()}`]
		case 'brightness':
			return [`MIXER ${cl} BRIGHTNESS ${p.value ?? 1} 0`]
		case 'contrast':
			return [`MIXER ${cl} CONTRAST ${p.value ?? 1} 0`]
		case 'saturation':
			return [`MIXER ${cl} SATURATION ${p.value ?? 1} 0`]
		case 'levels':
			return [`MIXER ${cl} LEVELS ${p.minIn ?? 0} ${p.maxIn ?? 1} ${p.gamma ?? 1} ${p.minOut ?? 0} ${p.maxOut ?? 1} 0`]
		case 'chroma_key':
			return [`MIXER ${cl} CHROMA ${p.key || 'None'} ${p.threshold ?? 0.34} ${p.softness ?? 0.44} ${p.spill ?? 1} ${p.blur ?? 0}`]
		case 'crop':
			return [`MIXER ${cl} CROP ${p.left ?? 0} ${p.top ?? 0} ${p.right ?? 1} ${p.bottom ?? 1} 0`]
		case 'clip_mask':
			return [`MIXER ${cl} CLIP ${p.left ?? 0} ${p.top ?? 0} ${p.width ?? 1} ${p.height ?? 1} 0`]
		case 'perspective':
			return [`MIXER ${cl} PERSPECTIVE ${p.ulX ?? 0} ${p.ulY ?? 0} ${p.urX ?? 1} ${p.urY ?? 0} ${p.lrX ?? 1} ${p.lrY ?? 1} ${p.llX ?? 0} ${p.llY ?? 1} 0`]
		case 'grid':
			return [`MIXER ${cl} GRID ${p.resolution ?? 2} 0`]
		case 'keyer':
			return [`MIXER ${cl} KEYER ${p.enabled ? 1 : 0}`]
		case 'rotation':
			return sceneLayerRotationMixerLines(cl, p.degrees ?? 0)
		case 'anchor':
			return [`MIXER ${cl} ANCHOR ${p.x ?? 0} ${p.y ?? 0} 0`]
		default:
			return null
	}
}

/** @param {object} clip */
function clipAudioRoute(clip) {
	return clip?.audioRoute || '1+2'
}

/** @param {object} clip */
function playAfSuffix(clip, programLayout) {
	const af = audioRouteToAudioFilter(clipAudioRoute(clip), programLayout)
	return af ? ` AF ${audioFilterParam(af)}` : ''
}

/**
 * True when Caspar transport (PLAY/LOAD + AF) must be re-sent for this layer.
 * @param {{ clipId?: string, src?: string, audioRoute?: string, loopAlways?: boolean, isRoute?: boolean } | null | undefined} prev
 * @param {object} clip
 */
function timelineClipTransportStale(prev, clip) {
	if (!prev || !clip) return true
	if (prev.clipId !== clip.id) return true
	const src = String(clip.source?.value || '')
	if ((prev.src || '') !== src) return true
	if ((prev.audioRoute || '1+2') !== clipAudioRoute(clip)) return true
	if ((prev.loopAlways || false) !== !!clip.loopAlways) return true
	if ((prev.isRoute || false) !== src.startsWith('route://')) return true
	return false
}

/**
 * WO-536 — may a looping clip be repositioned with `CALL <ch>-<layer> SEEK <frame>`?
 *
 * Yes, and it is the ONLY safe way. Verified by reading the CasparCG source the running binary was
 * built from — provenance and hashes in WO-536 §5, which is also where to look before trusting these
 * line numbers against a different Caspar build:
 *
 *  - `CALL … SEEK n` reaches `AVProducer::seek` (`ffmpeg_producer.cpp:180`), which only sets `seek_`
 *    and drops the buffer (`av_producer.cpp:1075`). It touches neither `loop_` nor `start_`, so the
 *    loop keeps wrapping to the IN point afterwards (`av_producer.cpp:881` — at EOF,
 *    `if (loop_ && frame_count_ > 2) seek_internal(start)`).
 *  - `PLAY file LOOP SEEK n` is NOT equivalent and must never be used for this:
 *    `auto in = get_param(L"IN", params, seek)` (`ffmpeg_producer.cpp:302`) aliases SEEK onto IN, so
 *    it moves the loop's start point rather than the playhead.
 *
 * The one hazard is that same `frame_count_ > 2` guard: `seek_internal` resets `frame_count_` to 0,
 * so a producer seeked to within ~2 frames of the end reaches EOF before it qualifies to wrap and
 * takes the `sleep(10ms); continue` branch instead — holding the last frame forever, since nothing
 * further is decoded to grow the count. Refuse the seek in that window; the clip then starts at its
 * IN point, which is merely the pre-WO-536 behaviour rather than a stall.
 *
 * @param {{ frame?: number, inFrames?: number, loopSpanFrames?: number, isRoute?: boolean }} meta
 * @returns {boolean}
 */
function loopSeekIsSafe(meta) {
	if (!meta || meta.isRoute) return false
	const frame = Number(meta.frame)
	/* Frame 0 IS a legal target — a scrub back to the loop's start must still be sent. Skipping a
	 * pointless SEEK 0 straight after a `PLAY … LOOP` (which already starts there) is the PLAY
	 * site's business, not this predicate's. */
	if (!Number.isFinite(frame) || frame < 0) return false
	const span = Number(meta.loopSpanFrames)
	// No known span (media duration unresolved) — nothing to be near the end OF, so allow it.
	if (!Number.isFinite(span) || span <= 0) return true
	const lastSafe = (Number(meta.inFrames) || 0) + span - 3
	return frame <= lastSafe
}

/** @param {string|undefined} s */
function parseResolutionAspect(s) {
	if (!s || typeof s !== 'string') return null
	const m = String(s).match(/(\d+)[×x](\d+)/i)
	if (!m) return null
	const w = parseInt(m[1], 10)
	const h = parseInt(m[2], 10)
	if (!(w > 0 && h > 0)) return null
	return w / h
}

/**
 * Caspar layers for timeline (per stack index). Must sit **above** look bank B (110–199) so fills/CG from looks
 * do not cover timeline output; keep separate from bank A (1–99) and black CG (9).
 * WO-160: base moved 200 → 210 and capped at 50 layers (210–259) — the PIP overlay band starts at 260.
 * Constants live in look-layer-ranges.js (single source of truth for all bands).
 */
const {
	TIMELINE_LAYER_BASE,
	TIMELINE_LAYER_MAX_COUNT,
	assertPhysicalLayerBelowCeiling,
} = require('./look-layer-ranges')

let _timelineLayerClampWarned = false

/**
 * Physical Caspar layer for a timeline layer index, clamped to the timeline band.
 * A timeline with more than {@link TIMELINE_LAYER_MAX_COUNT} layers would spill into the
 * PIP overlay band (260+) — extra layers are clamped onto the last slot and warned once.
 * @param {number} layerIndex — 0-based timeline layer index
 * @param {(level: string, msg: string) => void} [log]
 */
function timelineCasparLayer(layerIndex, log) {
	const li = Math.max(0, Number(layerIndex) | 0)
	if (li >= TIMELINE_LAYER_MAX_COUNT) {
		if (!_timelineLayerClampWarned) {
			_timelineLayerClampWarned = true
			const msg = `[timeline] layer index ${li} exceeds max ${TIMELINE_LAYER_MAX_COUNT - 1} — clamped to layer ${
				TIMELINE_LAYER_BASE + TIMELINE_LAYER_MAX_COUNT - 1
			} (timeline band ${TIMELINE_LAYER_BASE}-${TIMELINE_LAYER_BASE + TIMELINE_LAYER_MAX_COUNT - 1}, WO-160)`
			if (typeof log === 'function') log('warn', msg)
			else console.warn(msg)
		}
		return assertPhysicalLayerBelowCeiling(
			TIMELINE_LAYER_BASE + TIMELINE_LAYER_MAX_COUNT - 1,
			'timeline layer',
		)
	}
	return assertPhysicalLayerBelowCeiling(TIMELINE_LAYER_BASE + li, 'timeline layer')
}

const TICK_MS = 40
/** WS `timeline.tick` throttle — client extrapolates between ticks; ~150–180ms reduces jitter over high-latency links. */
const TIMELINE_TICK_BROADCAST_MS = 165
/**
 * Stretched-timeline clips (file shorter than clip duration) loop in Caspar via PLAY LOOP.
 * CALL SEEK only on loop-boundary crossings — not every UI tick (see timeline-playback-amcp.js).
 */
const TIMELINE_AMCP_DRIFT_MS = 500

/** Match client `normalizeSendTo` — program is opt-in; preview defaults on. */
function normalizeTimelineSendTo(raw) {
	if (!raw || typeof raw !== 'object') return { preview: true, program: false, screenIdx: 0 }
	const screenIdx =
		raw.screenIdx === null || raw.screenIdx === 'all'
			? null
			: Number.isFinite(Number(raw.screenIdx))
				? Number(raw.screenIdx)
				: 0
	return {
		preview: raw.preview !== false,
		program: !!raw.program,
		screenIdx,
	}
}

module.exports = {
	buildEffectAmcpLinesPlayback,
	mixerEffectNeutralLines,
	clipAudioRoute,
	playAfSuffix,
	timelineClipTransportStale,
	loopSeekIsSafe,
	parseResolutionAspect,
	TIMELINE_LAYER_BASE,
	TIMELINE_LAYER_MAX_COUNT,
	timelineCasparLayer,
	TICK_MS,
	TIMELINE_TICK_BROADCAST_MS,
	TIMELINE_AMCP_DRIFT_MS,
	normalizeTimelineSendTo,
}
