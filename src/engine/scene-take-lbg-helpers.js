const { buildEffectAmcpLinesPlayback } = require('./timeline-playback-helpers')
const { resolveClipForAmcpLoad } = require('../media/caspar-cls-id')

/** Containers/codecs Caspar ffmpeg often plays with an alpha channel (QT Animation, ProRes 4444, VP9, …). */
const STRAIGHT_ALPHA_VIDEO_EXT = new Set(['mov', 'webm', 'mkv', 'mxf'])

/** Still image formats that may carry straight alpha (premultiplied keyer off). */
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

/* WO-830b: one builder for look takes, timeline playback and the PRV nudge — the take copy interpolated look JSON
 * (project import, cluster replication) raw into MIXER lines; the playback builder coerces numbers and quotes strings. */
function buildEffectAmcpLines(type, params, cl) {
	return buildEffectAmcpLinesPlayback(type, params, cl)
}

function clipPath(layer) {
	const v = layer.source && layer.source.value
	return v != null ? String(v) : ''
}

/**
 * Scene/project stored clip → Caspar CLS id (project folder, then catalog).
 * @param {string} clip
 * @param {{ config?: object, persistence?: object, CHOICES_MEDIAFILES?: unknown } | null | undefined} ctx
 * @returns {string}
 */
function resolveSceneClipForAmcp(clip, ctx) {
	const raw = clip != null ? String(clip).trim() : ''
	if (!raw) return raw
	return resolveClipForAmcpLoad(raw, ctx)
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
	const id = String(clip || '').trim().replace(/^"(.*)"$/, '$1')
	if (!id || id.startsWith('route://') || /^\[HTML\]/i.test(id)) return false
	const ext = extFromPath(id)
	return STRAIGHT_ALPHA_STILL_EXT.has(ext) || STRAIGHT_ALPHA_VIDEO_EXT.has(ext)
}

module.exports = {
	buildEffectAmcpLines,
	clipPath,
	resolveSceneClipForAmcp,
	chLayerAmcp,
	extFromPath,
	shouldApplyStraightAlphaKeyer,
	STILL_IMAGE_LOADBG_NO_TRANSITION_EXT,
	STRAIGHT_ALPHA_STILL_EXT,
	STRAIGHT_ALPHA_VIDEO_EXT,
}
