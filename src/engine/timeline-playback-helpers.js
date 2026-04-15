'use strict'

const { audioRouteToAudioFilter } = require('./audio-route')
const { param } = require('../caspar/amcp-utils')

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
			return [`MIXER ${cl} ROTATION ${p.degrees ?? 0} 0`]
		case 'anchor':
			return [`MIXER ${cl} ANCHOR ${p.x ?? 0} ${p.y ?? 0} 0`]
		default:
			return null
	}
}

/** @param {object} clip */
function playAfSuffix(clip) {
	const af = audioRouteToAudioFilter(clip.audioRoute || '1+2')
	return af ? ` AF ${param(af)}` : ''
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

/** Caspar layers for timeline (per stack index). Keep separate from scene/looks (typically 1–20) and black CG (9). */
const TIMELINE_LAYER_BASE = 100

const TICK_MS = 40
/** WS `timeline.tick` throttle — client extrapolates between ticks; ~150–180ms reduces jitter over high-latency links. */
const TIMELINE_TICK_BROADCAST_MS = 165

module.exports = {
	buildEffectAmcpLinesPlayback,
	mixerEffectNeutralLines,
	playAfSuffix,
	parseResolutionAspect,
	TIMELINE_LAYER_BASE,
	TICK_MS,
	TIMELINE_TICK_BROADCAST_MS,
}
