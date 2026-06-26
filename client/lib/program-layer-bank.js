/**
 * Must match src/program-layer-bank.js — which PGM stack (10+ vs 110+) is live.
 * @param {unknown} v
 * @returns {'a'|'b'}
 */
export function normalizeProgramLayerBank(v) {
	if (v === 'b' || v === true) return 'b'
	return 'a'
}
