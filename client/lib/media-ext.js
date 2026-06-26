/**
 * Classify media filenames for UI (loop, etc.)
 */

const STILL_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif'])
const VIDEO_EXT = new Set([
	'mov', 'mp4', 'mxf', 'avi', 'mkv', 'webm', 'mpg', 'mpeg', 'm2v', 'm4v', 'wmv', 'flv', 'ts', 'm2ts',
])
const AUDIO_EXT = new Set(['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'wma'])

function extFromPath(filename) {
	if (!filename || typeof filename !== 'string') return ''
	const base = filename.split(/[/\\]/).pop() || ''
	const i = base.lastIndexOf('.')
	if (i < 0) return ''
	return base.slice(i + 1).toLowerCase()
}

/**
 * @param {string} [filename]
 * @returns {boolean}
 */
export function isStillImageFilename(filename) {
	const ext = extFromPath(filename)
	return ext !== '' && STILL_IMAGE_EXT.has(ext)
}

/**
 * True for common video container extensions (Caspar ffmpeg producer).
 * @param {string} [filename]
 */
export function isVideoLikeFilename(filename) {
	const ext = extFromPath(filename)
	return ext !== '' && VIDEO_EXT.has(ext)
}

/**
 * Show "Loop" only for sources that actually have continuous playback (video, timeline).
 * Still images, routes, templates, audio, etc. get no loop control.
 * @param {string} [value] - clip path or route
 * @param {string} [sourceType] - media | file | template | timeline | …
 */
export function sourceSupportsLoopPlayback(value, sourceType) {
	if (!value) return false
	const t = String(sourceType || '').toLowerCase()
	if (t === 'timeline') return true
	const v = String(value).trim()
	if (v.startsWith('route://')) return false
	if (t === 'template') return false
	if (isStillImageFilename(v)) return false
	const ext = extFromPath(v)
	if (ext && AUDIO_EXT.has(ext)) return true
	if (isVideoLikeFilename(v)) return true
	// Caspar clip paths often have no ".ext" in the id — allow loop for media/file when not clearly a still
	if ((t === 'media' || t === 'file') && !ext) return true
	// Unknown extension on media/file: assume loopable unless clearly still or audio
	if ((t === 'media' || t === 'file') && ext && !STILL_IMAGE_EXT.has(ext) && !AUDIO_EXT.has(ext)) return true
	return false
}

/** Caspar KEYER on video / opaque clips often blanks the layer — only still formats with real alpha. */
const STRAIGHT_ALPHA_STILL_EXT = new Set(['png', 'webp', 'tiff', 'tif', 'tga'])

/**
 * MIXER KEYER: only for still image formats that can carry straight alpha.
 * Video (mov/mp4/…) is ignored — enabling KEYER there hides the layer without codec detection.
 * @param {boolean} straightAlpha
 * @param {string} [pathOrValue]
 */
export function shouldApplyStraightAlphaKeyer(straightAlpha, pathOrValue) {
	if (!straightAlpha) return false
	const ext = extFromPath(String(pathOrValue || ''))
	return STRAIGHT_ALPHA_STILL_EXT.has(ext)
}

/**
 * @param {string} [filename]
 * @returns {'still' | 'video' | 'audio' | 'unknown'}
 */
export function classifyMediaKind(filename) {
	const v = String(filename || '')
	const ext = extFromPath(v)
	if (isStillImageFilename(v)) return 'still'
	if (ext && AUDIO_EXT.has(ext)) return 'audio'
	if (isVideoLikeFilename(v)) return 'video'
	if (!ext && v.length > 0) return 'unknown'
	return 'unknown'
}

/** ffprobe video stream codec_name — when filename has no extension */
const FFPROBE_VIDEO_CODECS = new Set([
	'h264',
	'hevc',
	'prores',
	'dnxhd',
	'dnxhr',
	'vp9',
	'av1',
	'mpeg2video',
	'mpeg4',
	'wmv3',
	'dvvideo',
	'ffv1',
	'qtrle',
	'rawvideo',
])
/** Still-ish codecs on a video stream (Caspar stills / single-frame) */
const FFPROBE_STILL_CODECS = new Set(['png', 'gif', 'tiff', 'bmp', 'jpeg2000', 'webp'])

/**
 * Pill kind for media browser rows: prefer extension; else infer from ffprobe only when clear.
 * Otherwise `unknown` → MED in UI.
 * @param {{ id?: string, label?: string, codec?: string, durationMs?: number, resolution?: string }} [item]
 * @returns {'still' | 'video' | 'audio' | 'unknown'}
 */
export function classifyMediaItem(item) {
	const id = item?.id ?? item?.label ?? ''
	const fromName = classifyMediaKind(String(id))
	if (fromName !== 'unknown') return fromName

	const codec = String(item?.codec || '').toLowerCase()
	const dur = item?.durationMs
	if (codec && FFPROBE_STILL_CODECS.has(codec)) return 'still'
	if (codec === 'mjpeg') return dur > 0 ? 'video' : 'still'
	if (codec && FFPROBE_VIDEO_CODECS.has(codec)) return 'video'
	if (dur > 0 && item?.resolution) return 'video'
	return 'unknown'
}
