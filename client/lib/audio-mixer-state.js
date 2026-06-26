/**
 * Persisted audio mixer: program master faders (per Caspar channel key).
 * Per-layer stereo pairs use `audioRoute` on scene/dashboard layers (AMCP AF pan), not this store.
 */

const STORAGE_KEY = 'casparcg_audio_mixer_v1'

/** @typedef {{ master: Record<string, number>, layerRoutes: Record<string, number | null>, soloedLayers: string[] }} AudioMixerPersisted */

function load() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return { master: {}, layerRoutes: {}, soloedLayers: [], muted: {} }
		const j = JSON.parse(raw)
		return {
			master: typeof j.master === 'object' && j.master ? j.master : {},
			layerRoutes: typeof j.layerRoutes === 'object' && j.layerRoutes ? j.layerRoutes : {},
			soloedLayers: Array.isArray(j.soloedLayers) ? j.soloedLayers : [],
			muted: typeof j.muted === 'object' && j.muted ? j.muted : {},
		}
	} catch {
		return { master: {}, layerRoutes: {}, soloedLayers: [], muted: {} }
	}
}

function save(data) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
	} catch {}
}

/** @param {string} chKey */
export function getMasterVolume(chKey) {
	const d = load()
	const v = d.master[chKey]
	return typeof v === 'number' && v >= 0 && v <= 1 ? v : 1
}

/** @param {string} chKey @param {number} v 0..1 */
export function setMasterVolume(chKey, v) {
	const d = load()
	d.master[chKey] = Math.max(0, Math.min(1, v))
	save(d)
}

/** @param {string} key @returns {boolean} */
export function getMuted(key) {
	return !!load().muted[key]
}

/** @param {string} key @param {boolean} m */
export function setMuted(key, m) {
	const d = load()
	d.muted[key] = !!m
	save(d)
}

/** @param {number} layerNum @returns {number | null} destination Caspar channel or null */
export function getLayerRoute(layerNum) {
	const d = load()
	const k = String(layerNum)
	if (!Object.prototype.hasOwnProperty.call(d.layerRoutes, k)) return null
	const x = d.layerRoutes[k]
	return typeof x === 'number' && x > 0 ? x : null
}

/** @param {number} layerNum @param {number | null} destCasparChannel */
export function setLayerRoute(layerNum, destCasparChannel) {
	const d = load()
	const k = String(layerNum)
	if (destCasparChannel == null) delete d.layerRoutes[k]
	else d.layerRoutes[k] = destCasparChannel
	save(d)
}

/** @returns {Record<string, number | null>} */
export function getAllLayerRoutes() {
	return { ...load().layerRoutes }
}

/**
 * Toggle solo for a layer.
 * @param {string} layerKey - e.g. "pgm:1:layer:10"
 * @param {boolean} multi - if true, toggle in list; if false, replace list (or clear if already soloed alone)
 */
export function toggleSolo(layerKey, multi) {
	const d = load()
	const idx = d.soloedLayers.indexOf(layerKey)
	if (multi) {
		if (idx >= 0) d.soloedLayers.splice(idx, 1)
		else d.soloedLayers.push(layerKey)
	} else {
		if (idx >= 0 && d.soloedLayers.length === 1) d.soloedLayers = []
		else d.soloedLayers = [layerKey]
	}
	save(d)
	return [...d.soloedLayers]
}

/** @param {string} layerKey @returns {boolean} */
export function isSoloed(layerKey) {
	return load().soloedLayers.includes(layerKey)
}

/** @returns {string[]} */
export function getSoloedLayers() {
	return [...load().soloedLayers]
}

export function clearSolos() {
	const d = load()
	d.soloedLayers = []
	save(d)
}
