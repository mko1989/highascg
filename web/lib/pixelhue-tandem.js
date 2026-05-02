/**
 * Optional PixelFlow / PixelHue preset apply chained to look-preset recall (WO tandem).
 * @see docs/PIXELHUE_API.md
 */
import { api } from './api-client.js'

/** @typedef {'prv' | 'pgm'} RecallKind */

const LOAD = { preview: 4, program: 2 }

/**
 * @param {unknown} r
 * @returns {{ list: any[] } | null}
 */
function presetListFromResponse(r) {
	if (!r || typeof r !== 'object') return null
	const d = /** @type {any} */ (r).data
	if (d && Array.isArray(d.list)) return { list: d.list }
	if (Array.isArray(/** @type {any} */ (r).list)) return { list: /** @type {any} */ (r).list }
	return null
}

/**
 * @param {{ tandem?: { pixelhue?: { presetId?: string, targetRegion?: number, order?: string } } } } lookPreset
 * @param {'prv' | 'pgm'} recallKind
 * @param {(msg: string, type?: string) => void} showToast
 * @returns {Promise<boolean>} true if apply was sent
 */
export async function applyPixelhueTandem(lookPreset, recallKind, showToast) {
	const ph = lookPreset && lookPreset.tandem && lookPreset.tandem.pixelhue
	const guid = ph && String(ph.presetId || '').trim()
	if (!guid) return false

	try {
		const st = await api.get('/api/pixelhue/status')
		if (!st || st.enabled === false) {
			showToast('PixelHue is disabled in Settings.', 'error')
			return true
		}
		if (!st.connected) {
			showToast(`PixelHue: ${st.error || 'not connected'}`, 'error')
			return true
		}
	} catch (e) {
		showToast(e?.message || 'PixelHue status failed', 'error')
		return true
	}

	let targetRegion = ph.targetRegion
	if (targetRegion !== 2 && targetRegion !== 4) {
		targetRegion = recallKind === 'prv' ? LOAD.preview : LOAD.program
	}

	let serial = 1
	try {
		const pr = await api.get('/api/pixelhue/presets')
		const parsed = presetListFromResponse(pr)
		const list = parsed?.list || []
		const found = list.find((p) => p && (p.guid === guid || p.presetId === guid))
		if (!found) {
			showToast(`PixelHue: no preset with guid ${guid}`, 'error')
			return true
		}
		if (typeof found.serial === 'number' && Number.isFinite(found.serial)) {
			serial = found.serial
		}
	} catch (e) {
		showToast(e?.message || 'PixelHue preset list failed', 'error')
		return true
	}

	const body = {
		auxiliary: {
			keyFrame: { enable: 1 },
			switchEffect: { type: 1, time: 500 },
			swapEnable: 1,
			effect: { enable: 1 },
		},
		serial,
		targetRegion,
		presetId: guid,
	}

	try {
		const res = await api.post('/api/pixelhue/preset-apply', body)
		const code = res && typeof res === 'object' && 'code' in res ? (/** @type {any} */ (res).code) : 0
		if (code != null && code !== 0 && code !== 200) {
			const msg = (res && (/** @type {any} */ (res).message)) || 'PixelHue rejected preset apply'
			showToast(String(msg), 'error')
		}
	} catch (e) {
		showToast(e?.message || 'PixelHue preset apply failed', 'error')
	}
	return true
}

/**
 * @param {object} lookPreset
 * @returns {boolean}
 */
export function lookPresetHasPixelhue(lookPreset) {
	const g = lookPreset && lookPreset.tandem && lookPreset.tandem.pixelhue && lookPreset.tandem.pixelhue.presetId
	return typeof g === 'string' && g.trim() !== ''
}

/**
 * @param {object} lookPreset
 * @param {'prv' | 'pgm'} recallKind
 * @returns {boolean} true = PixelHue before Caspar
 */
export function pixelhueBeforeCaspar(lookPreset) {
	const o = lookPreset && lookPreset.tandem && lookPreset.tandem.pixelhue && lookPreset.tandem.pixelhue.order
	if (o === 'beforeCaspar') return true
	if (o === 'afterCaspar') return false
	// default: after Caspar (device follows layer routing after our take)
	return false
}
