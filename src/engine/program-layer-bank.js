'use strict'

/**
 * Normalize persisted program stack id. Corrupt values (e.g. boolean true from bad `|| 'a'`
 * reads) must not reach physicalProgramLayer — only 'a'|'b' are valid.
 * @param {unknown} v
 * @returns {'a'|'b'}
 */
function normalizeProgramLayerBank(v) {
	if (v === 'b' || v === true) return 'b'
	return 'a'
}

module.exports = { normalizeProgramLayerBank }
