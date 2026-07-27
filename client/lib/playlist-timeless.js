/**
 * Timeless playlist items — graphics, templates, shaders: anything with no intrinsic length
 * that the server advances by wall-clock timer. Client mirror of isTimelessPlaylistItem in
 * src/engine/scene-take-lbg-playlist.js; shared by the layer inspector and the compact
 * Playlists footer panel (todos27).
 */

const TIMED_EXT_RE = /\.(mp4|mov|mkv|avi|webm|mxf|m2ts?|ts|mpg|mpeg|m4v|mp3|wav|m4a|aac|flac|ogg)$/i

/** @param {{ type?: string, value?: string } | null | undefined} it */
export function isTimelessItem(it) {
	const t = String(it?.type || '')
	if (t === 'image' || t === 'template' || t === 'shader' || t === 'graphic') return true
	const v = String(it?.value || '')
	return /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(v) || !TIMED_EXT_RE.test(v)
}

/**
 * The seconds value the "Timeless items (s)" input should SHOW: the duration already set on
 * the playlist's timeless items (first one wins), else the 20 s default. Fixes the
 * "input resets to 20 after Apply" bug — 20 was hard-coded as the input's value.
 * @param {Array<object> | null | undefined} playlist
 */
export function timelessSecsOf(playlist) {
	for (const it of playlist || []) {
		if (isTimelessItem(it) && Number.isFinite(Number(it?.duration)) && Number(it.duration) > 0) {
			return Number(it.duration)
		}
	}
	return 20
}
