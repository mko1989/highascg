'use strict'

const STRAIGHT_ALPHA_STILL_EXT = new Set(['png', 'webp', 'tiff', 'tif', 'tga'])

const STILL_IMAGE_LOADBG_NO_TRANSITION_EXT = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'bmp',
	'webp',
	'tiff',
	'tif',
	'tga',
	'dpx',
])

function buildEffectAmcpLines(type, params, cl) {
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

function clipPath(layer) {
	const v = layer.source && layer.source.value
	return v != null ? String(v) : ''
}

function chLayerAmcp(channel, layer) {
	const c = parseInt(channel, 10)
	return `${c}-${parseInt(layer, 10)}`
}

function extFromPath(filename) {
	if (!filename || typeof filename !== 'string') return ''
	const base = filename.split(/[/\\]/).pop() || ''
	const i = base.lastIndexOf('.')
	return i < 0 ? '' : base.slice(i + 1).toLowerCase()
}

function shouldApplyStraightAlphaKeyer(clip, straightAlpha) {
	if (!straightAlpha) return false
	const ext = extFromPath(clip)
	return STRAIGHT_ALPHA_STILL_EXT.has(ext)
}

module.exports = {
	buildEffectAmcpLines,
	clipPath,
	chLayerAmcp,
	extFromPath,
	shouldApplyStraightAlphaKeyer,
	STILL_IMAGE_LOADBG_NO_TRANSITION_EXT,
}
