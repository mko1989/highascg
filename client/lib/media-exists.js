/**
 * media-exists.js — WO-360: is this clip value known to Caspar? Singleton index over
 * `state.media` (the CLS-backed list every client already receives), tolerant the same way
 * playout is: case-insensitive, extension-stripped, basename fallback.
 *
 * `clipMissing(value)` returns:
 *   true  — a plain media value that is NOT in the media list (⚠ territory)
 *   false — found (or basename-matched)
 *   null  — not a judgeable media value (templates/shaders, route://, live, html, color,
 *           placeholders) — callers must not mark these.
 */

let _ids = new Set()
let _basenames = new Set()
let _ready = false

const NON_MEDIA_RE = /^(route:\/\/|\[html\]|https?:\/\/|decklink|live|color|#)/i
const TEMPLATE_PATH_RE = /(^|\/)(shaders|lower-thirds|lower_thirds|studio|countdown|loop-io|html)\//i

function norm(v) {
	return String(v || '')
		.trim()
		.replace(/\\/g, '/')
		.replace(/\.[a-z0-9]{2,4}$/i, '')
		.toLowerCase()
}

function baseOf(v) {
	const n = norm(v)
	return n.split('/').filter(Boolean).pop() || n
}

function rebuild(media) {
	_ids = new Set()
	_basenames = new Set()
	for (const m of media || []) {
		const id = norm(m?.id ?? m?.name)
		if (!id) continue
		_ids.add(id)
		_basenames.add(baseOf(id))
	}
	_ready = _ids.size > 0
}

/** Call once at app init; keeps the index live. @param {object} stateStore */
export function initMediaExistsIndex(stateStore) {
	rebuild(stateStore.getState()?.media)
	stateStore.on?.('media', (media) => rebuild(media))
	stateStore.on?.('*', (path) => {
		if (path === 'media' || path === '*') rebuild(stateStore.getState()?.media)
	})
}

/** @param {string} value @returns {boolean | null} */
export function clipMissing(value) {
	const raw = String(value || '').trim()
	if (!raw || !_ready) return null
	if (NON_MEDIA_RE.test(raw) || TEMPLATE_PATH_RE.test(raw)) return null
	const n = norm(raw)
	if (_ids.has(n)) return false
	if (_basenames.has(baseOf(n))) return false
	return true
}

/** Missing plain-media values across a look's layers + playlists. @returns {string[]} */
export function missingMediaInScene(scene) {
	const out = []
	for (const layer of scene?.layers || []) {
		const vals = []
		if (layer?.source?.value) vals.push(layer.source.value)
		if (Array.isArray(layer?.playlist)) for (const it of layer.playlist) if (it?.value) vals.push(it.value)
		for (const v of vals) if (clipMissing(v) === true && !out.includes(v)) out.push(v)
	}
	return out
}

/** Take-time warning: toast every missing plain-media value in the outgoing look. */
export function warnMissingMediaOnTake(scene) {
	const missing = missingMediaInScene(scene)
	if (!missing.length) return
	const names = missing.map((v) => String(v).replace(/\\/g, '/').split('/').filter(Boolean).pop()).join(', ')
	window.showToast?.(`⚠ Missing in Caspar media: ${names}`, 'error')
	console.warn('[media-exists] take with missing media:', missing)
}

/** WO-360: toast inner AMCP failures a take response reports (server-collected per take). */
export function toastTakeAmcpFailures(res) {
	const fails = Array.isArray(res?.amcpFailures) ? res.amcpFailures : []
	if (!fails.length) return
	const first = fails[0]
	const cmd = String(first.command || '').split(' ').slice(0, 3).join(' ')
	window.showToast?.(
		`⚠ ${fails.length} command(s) failed during take — first: ${cmd} → ${first.line || first.code}`,
		'error',
	)
	console.warn('[take] AMCP failures:', fails)
}
