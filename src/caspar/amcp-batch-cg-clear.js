'use strict'

/**
 * WO-1037 — inside ONE BEGIN…COMMIT batch, Caspar loses a `CG <ch>-<layer> ADD` when the same batch clears that layer
 * first (`CG <ch>-<layer> CLEAR` or `CLEAR <ch>-<layer>`): every line answers 202, and the layer ends up empty — the
 * clear lands after the add. Measured on the box (11.11, build 5c3373ec5), four batches on channel 4 layer 264:
 *   MIXER CLEAR + CG ADD → layer there        CG CLEAR + CG ADD → gone        CLEAR + CG ADD → gone
 *   CG CLEAR in one batch, CG ADD in the next → layer there
 * Seen as: a PIP border new on a layer of a PGM-only screen never showed (the take strips the overlay slot, then adds
 * the border, in one batch — pip-overlay.js; owner 11.11 "the border does not show up").
 *
 * The clear is redundant there: `CG ADD` puts a new template producer on the layer whatever was on it. So such a clear
 * is left out of the batch. A clear with no later `CG ADD` on its layer in the same batch stays.
 */

const CLEAR_RE = /^(?:CG\s+(\d+-\d+)\s+CLEAR|CLEAR\s+(\d+-\d+))\s*$/i
const CG_ADD_RE = /^CG\s+(\d+-\d+)\s+ADD\b/i

/**
 * @param {string[]} lines the commands of one batch, in order
 * @returns {string[]} the same lines without the clears a later `CG ADD` on the same layer makes redundant
 */
function dropClearsBeforeCgAdd(lines) {
	const lastAdd = new Map()
	lines.forEach((l, i) => {
		const m = CG_ADD_RE.exec(String(l).trim())
		if (m) lastAdd.set(m[1], i)
	})
	if (!lastAdd.size) return lines
	return lines.filter((l, i) => {
		const m = CLEAR_RE.exec(String(l).trim())
		return !(m && lastAdd.get(m[1] || m[2]) > i)
	})
}

module.exports = { dropClearsBeforeCgAdd }
