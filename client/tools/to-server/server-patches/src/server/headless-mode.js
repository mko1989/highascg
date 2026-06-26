'use strict'

/**
 * When HIGHASCG_HEADLESS is set, non-API HTTP returns 404 JSON (no static UI).
 * Default (unset): serve dist-web/ on playout :4200 (WO-52).
 * @returns {boolean}
 */
function isHeadlessMode() {
	const v = process.env.HIGHASCG_HEADLESS
	if (v == null || v === '') return false
	const s = String(v).trim().toLowerCase()
	return s === 'true' || s === '1' || s === 'yes'
}

module.exports = { isHeadlessMode }
