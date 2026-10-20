/**
 * Audio mixer console state: strip gains, mutes and solos (per web strip key).
 * Per-layer stereo pairs use `audioRoute` on scene/dashboard layers (AMCP AF pan), not this store.
 *
 * WO-604 slice 2: the server owns this state (`GET /api/audio/mixer`, src/audio/mixer-state.js) so the web and the
 * Godot console show one mixer. This module is the synchronous cache the strip renderers read; it is filled by
 * audio-mixer-server-sync.js (GET on every WS (re)connect + the `audioMixer` change broadcast). The setters only
 * update the cache optimistically — the server learns a change from the write itself (`key` on /api/audio/volume,
 * /api/audio/mute, `keys` on /api/audio/solo). Was browser localStorage `casparcg_audio_mixer_v1` until then.
 */

import { faderPercentToLinearGain, linearGainToFaderPercent } from './audio-volume-scale.js'

/** @type {{ gains: Record<string, number>, muted: Record<string, boolean>, solos: string[], layerRoutes: Record<string, number> }} */
const cache = { gains: {}, muted: {}, solos: [], layerRoutes: {} }

/**
 * Replace the cache with the server's snapshot ({ gains, muted, solos }).
 * @param {unknown} snap
 */
export function ingestServerMixer(snap) {
	const j = snap && typeof snap === 'object' ? /** @type {any} */ (snap) : {}
	cache.gains = j.gains && typeof j.gains === 'object' ? { ...j.gains } : {}
	cache.muted = j.muted && typeof j.muted === 'object' ? { ...j.muted } : {}
	cache.solos = Array.isArray(j.solos) ? [...j.solos] : []
}

/** @param {string} chKey */
export function getMasterVolume(chKey) {
	const v = cache.gains[chKey]
	return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 1
}

/** @param {string} chKey @param {number} v linear gain */
export function setMasterVolume(chKey, v) {
	cache.gains[chKey] = Math.max(0, Number(v) || 0)
}

/**
 * The gain a strip's fader position stands for: the stored gain while the fader still shows it, else the position's
 * gain. 0 dB falls between two fader steps, so reading unity back from the position sends 0.98629 (−0.12 dB) on every
 * double-click reset and unmute (WO-604; the Godot strip's gain() rule).
 * @param {string} key @param {number | string} percent fader value 0..100
 */
export function faderGain(key, percent) {
	const v = getMasterVolume(key)
	return linearGainToFaderPercent(v) === Math.round(Number(percent)) ? v : faderPercentToLinearGain(percent)
}

/** @param {string} key @returns {boolean} */
export function getMuted(key) {
	return cache.muted[key] === true
}

/** @param {string} key @param {boolean} m */
export function setMuted(key, m) {
	if (m) cache.muted[key] = true
	else delete cache.muted[key]
}

/** @param {number} layerNum @returns {number | null} destination Caspar channel or null */
export function getLayerRoute(layerNum) {
	const k = String(layerNum)
	if (!Object.prototype.hasOwnProperty.call(cache.layerRoutes, k)) return null
	const x = cache.layerRoutes[k]
	return typeof x === 'number' && x > 0 ? x : null
}

/** @param {number} layerNum @param {number | null} destCasparChannel */
export function setLayerRoute(layerNum, destCasparChannel) {
	const k = String(layerNum)
	if (destCasparChannel == null) delete cache.layerRoutes[k]
	else cache.layerRoutes[k] = destCasparChannel
}

/** @returns {Record<string, number | null>} */
export function getAllLayerRoutes() {
	return { ...cache.layerRoutes }
}

/**
 * Toggle solo for a layer.
 * @param {string} layerKey - e.g. "pgm:1:layer:10"
 * @param {boolean} multi - if true, toggle in list; if false, replace list (or clear if already soloed alone)
 */
export function toggleSolo(layerKey, multi) {
	const idx = cache.solos.indexOf(layerKey)
	if (multi) {
		if (idx >= 0) cache.solos.splice(idx, 1)
		else cache.solos.push(layerKey)
	} else {
		if (idx >= 0 && cache.solos.length === 1) cache.solos = []
		else cache.solos = [layerKey]
	}
	return [...cache.solos]
}

/** @param {string} layerKey @returns {boolean} */
export function isSoloed(layerKey) {
	return cache.solos.includes(layerKey)
}

/** @returns {string[]} */
export function getSoloedLayers() {
	return [...cache.solos]
}

/**
 * Map a solo key to its /api/audio/solo target. Layer keys ('pgm:1:layer:10')
 * solo one layer; whole-channel keys ('prv:2', todos03.08 PRV strips) omit
 * `layer` and the server routes the full channel.
 * @param {string} key
 * @returns {{ channel: number, layer?: number }}
 */
export function soloKeyToTarget(key) {
	const parts = String(key).split(':')
	const channel = parseInt(parts[1], 10)
	const layer = parts.length >= 4 ? parseInt(parts[3], 10) : NaN
	return Number.isFinite(layer) ? { channel, layer } : { channel }
}

export function clearSolos() {
	cache.solos = []
}
