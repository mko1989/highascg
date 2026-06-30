'use strict'

const { readScreenSetting } = require('./os-layout-calculator-helpers')

/**
 * @param {object} config
 * @param {number} screenN 1-based
 * @returns {'edid'|'custom'|''}
 */
function readOsModeSourceSetting(config, screenN) {
	const n = Math.max(1, Math.min(8, parseInt(String(screenN), 10) || 1))
	const raw = String(readScreenSetting(config, `screen_${n}_os_mode_source`) || '')
		.trim()
		.toLowerCase()
	if (raw === 'edid' || raw === 'custom') return raw
	return ''
}

/**
 * Effective OS mode source for xrandr apply (explicit setting or legacy inference).
 * @param {object} config
 * @param {number} screenN
 * @param {{ osMode?: string, casparMode?: string }} [head]
 * @returns {'edid'|'custom'}
 */
function resolveEffectiveOsModeSource(config, screenN, head = {}) {
	const explicit = readOsModeSourceSetting(config, screenN)
	if (explicit) return explicit
	const osMode = String(head.osMode ?? readScreenSetting(config, `screen_${screenN}_os_mode`) ?? '').trim()
	if (/^\d+x\d+$/i.test(osMode)) return 'custom'
	const cm = String(head.casparMode ?? readScreenSetting(config, `screen_${screenN}_mode`) ?? '').trim()
	if (cm === 'custom') return 'custom'
	if (osMode) return 'edid'
	return 'edid'
}

module.exports = {
	readOsModeSourceSetting,
	resolveEffectiveOsModeSource,
}
