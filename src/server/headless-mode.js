'use strict'

/** @returns {boolean} */
function isHeadlessMode() {
	const v = process.env.HIGHASCG_HEADLESS
	if (v == null || v === '') return false
	const s = String(v).trim().toLowerCase()
	return s === 'true' || s === '1' || s === 'yes'
}

module.exports = { isHeadlessMode }
