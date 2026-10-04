/**
 * WO-592 — per-file media defaults (trim in/out, mute), set in the media-file inspector and copied
 * onto a look layer when that clip becomes the layer's source (owner 04.10: "per-file defaults
 * that looks copy when you add the clip"). Synchronous lookup over a cache of
 * GET /api/media/library/defaults so the central sceneState.patchLayer hook stays sync.
 */
import { api } from './api-client.js'
import { getDefaultUploadSubdir } from './project-media-context.js'

/** @type {Map<string, { trimInMs?: number|null, trimOutMs?: number|null, muted?: boolean }>} */
let byPath = new Map()
const key = (p) => String(p || '').normalize('NFC').replace(/\\/g, '/').toLowerCase()

export async function refreshMediaFileDefaults() {
	try {
		const r = await api.get('/api/media/library/defaults')
		byPath = new Map(Object.entries(r?.defaults || {}).map(([p, d]) => [key(p), d]))
	} catch {
		/* keep the last cache */
	}
}

/** Keep the cache in step after the inspector saves (no refetch needed). */
export function setLocalMediaFileDefaults(path, defaults) {
	byPath.set(key(path), defaults || {})
}

/** @param {string} value - layer source value (full media id, or project-relative) */
export function mediaFileDefaultsFor(value) {
	const v = String(value || '')
	if (!v) return null
	const hit = byPath.get(key(v))
	if (hit) return hit
	const sub = getDefaultUploadSubdir()
	return sub && !v.includes('/') ? byPath.get(key(`${sub}/${v}`)) || null : null
}

/**
 * Patch rewrite for a layer whose media source CHANGES: copy the file's defaults unless the
 * patch already sets those fields. Unchanged source / no defaults → patch returned as-is.
 * @param {object} layer - current layer
 * @param {object} patch
 */
export function withMediaFileDefaults(layer, patch) {
	const src = patch?.source
	if (!src || typeof src !== 'object') return patch
	const type = String(src.type || 'media').toLowerCase()
	if (type !== 'media' && type !== 'image' && type !== 'video') return patch
	if (String(layer?.source?.value || '') === String(src.value || '')) return patch
	const d = mediaFileDefaultsFor(src.value)
	if (!d) return patch
	const out = { ...patch }
	if (!('trimInMs' in out) && d.trimInMs != null) out.trimInMs = d.trimInMs
	if (!('trimOutMs' in out) && d.trimOutMs != null) out.trimOutMs = d.trimOutMs
	if (!('muted' in out) && d.muted) out.muted = true
	return out
}

if (typeof window !== 'undefined') void refreshMediaFileDefaults()
