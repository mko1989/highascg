'use strict'

/**
 * WO-1029 phase 2a — who pressed last on a destination the master forwards to a server that OWNS it (own / remote seen
 * from that server: cabled there, not on the master). Kept by the master, in memory, per destination id:
 *   'self'      the master's own operator pressed on it during THIS mastership (any line it sent on that destination's
 *               channels: the fan-out sink sees only what this node sent);
 *   <server id> that owner reported a local press (signed `dest.pressed` notice, routes-cluster.js) newer than the last.
 * The map starts EMPTY at every promotion (`clear`). Catch-up / replay (cluster-fanout.js) runs for such a destination
 * only while the holder is 'self', and only from `journal(id)`: the lines sent since the master's operator took it in
 * this mastership — never the boot journal (found 10.11: a new master replayed its own copy channel onto the other box's
 * LED wall), and never after the owner pressed locally (its journal is dropped then).
 * Backup destinations (cabled on the master too) are not kept here: they follow the master as before.
 */

const { createAirJournal } = require('./cluster-air-journal')

function createHolders() {
	/** destination id → { holder: 'self' | server id, seq, at, journal: AirJournal | null } */
	const map = new Map()

	/** The master's operator pressed on it (a line went out on its channels). → true when the holder changed. */
	function pressSelf(id) {
		const h = map.get(id)
		if (h?.holder === 'self') return false
		map.set(id, { holder: 'self', seq: 0, at: Date.now(), journal: createAirJournal() })
		return true
	}

	/** An owner's notice. Older / repeated seq from the same owner is ignored. → true when the holder changed. */
	function ownerPressed(id, owner, seq) {
		const h = map.get(id)
		const n = Number(seq) || 0
		if (h && h.holder === owner && n <= h.seq) return false
		map.set(id, { holder: String(owner), seq: n, at: Date.now(), journal: null }) // its journal is dropped
		return true
	}

	const holder = (id) => map.get(id)?.holder || ''
	/** The lines sent since the master's operator took it (null unless the holder is 'self'). */
	const journal = (id) => (map.get(id)?.holder === 'self' ? map.get(id).journal : null)
	const record = (id, line) => journal(id)?.record(line)
	const clear = () => map.clear()

	return { pressSelf, ownerPressed, holder, journal, record, clear }
}

module.exports = { createHolders }
