'use strict'

const { getModeDimensions } = require('./config-modes')

/**
 * WO-842 (sweep 4l): dimensions + Caspar mode id of multiview output `n`.
 *
 * The multiview mode lives in `multiview_<n>_mode` / `multiview_mode`, and a non-standard destination size becomes
 * `multiview_mode = 'custom'` with `multiview_custom_width/height/fps` (build-caspar-generator-config-screens.js,
 * `applyMultiviewDestinationOverrides`). `getModeDimensions('custom', …)` reads `screen_<idx>_custom_*`, so the plan
 * resolved a custom multiview against the CASPAR CHANNEL NUMBER's screen keys, found nothing, fell back to 1920x1080
 * and the channel was written as the literal `<video-mode>custom</video-mode>` with no mode registered — Caspar
 * refuses to start on an unknown mode id. Here the custom keys are mapped onto a scratch screen slot so the one
 * `getModeDimensions` rule applies (aliases, WO-484 "custom that is really a standard mode", minted `WxH` id).
 * @param {Record<string, unknown>} config
 * @param {number} n 1-based multiview index
 * @returns {{ width: number, height: number, fps: number, modeId: string, isCustom: boolean }}
 */
function multiviewModeDimensions(config, n = 1) {
	const idx = Math.max(1, parseInt(String(n), 10) || 1)
	const cs = config && typeof config.casparServer === 'object' && config.casparServer ? config.casparServer : {}
	const read = (key) => {
		for (const src of [cs, config]) {
			if (src && Object.prototype.hasOwnProperty.call(src, key) && src[key] !== undefined && src[key] !== '') return src[key]
		}
		return undefined
	}
	const mode = String(read(`multiview_${idx}_mode`) ?? read('multiview_mode') ?? '1080p5000').trim() || '1080p5000'
	if (mode !== 'custom') return getModeDimensions(mode, config, idx)
	const pick = (field) => read(`multiview_${idx}_custom_${field}`) ?? read(`multiview_custom_${field}`)
	return getModeDimensions('custom', {
		screen_1_custom_width: pick('width'),
		screen_1_custom_height: pick('height'),
		screen_1_custom_fps: pick('fps'),
	}, 1)
}

module.exports = { multiviewModeDimensions }
