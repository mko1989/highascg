'use strict'

/**
 * WO-739 — a link asked for by another server waits for this server's operator, unless this server auto-accepts.
 * Owner 24.10: "there also needs to be an accept path for connecting servers together, unless the server had
 * autoaccept master invites in the inspector of device".
 *
 * WO-732 made every operator link ask the other server to link back (`link_back: false`), and that server linked at
 * once. Now that request becomes an invite here (cluster-peers.js add() answers 202 `pending`) until the operator
 * accepts it (an operator link of that server) or declines it (cluster-peers.js decline()). The inviter keeps asking
 * every HEAL_MS (its repair), which renews the invite; one not renewed for TTL_MS lapses (the inviter unlinked or went
 * away). Invites live in memory: a restart loses them, and the inviter's next repair brings them back within a minute.
 * `clusterAutoAccept` (device-local persistence, the Devices server page) restores the WO-732 behaviour.
 */

const AUTO_KEY = 'clusterAutoAccept'
const TTL_MS = 3 * 60000

function createInvites({ persistence, now = Date.now }) {
	/** key (device fingerprint, else id) → { id, fp, host, port, name, version, first_at, asked_at, device_key } */
	const pending = new Map()
	const keyOf = (inv) => inv.fp || inv.id

	function fresh() {
		for (const [k, v] of pending) if (now() - v.asked_at > TTL_MS) pending.delete(k)
		return [...pending.values()]
	}

	return {
		autoAccept: () => persistence.get(AUTO_KEY) === true,
		setAutoAccept: (on) => persistence.set(AUTO_KEY, on === true),
		/** Record or renew an invite → true when it is new. */
		record(inv) {
			fresh()
			const prev = pending.get(keyOf(inv))
			pending.set(keyOf(inv), { ...inv, first_at: prev?.first_at || now(), asked_at: now() })
			return !prev
		},
		/** The invite with this id or fingerprint, removed → it, or null. */
		take(key) {
			const inv = fresh().find((v) => v.id === key || (v.fp && v.fp === key))
			if (inv) pending.delete(keyOf(inv))
			return inv || null
		},
		/** A server linked here (accepted, or linked by this operator) is no longer an invite. */
		drop(id, fp) {
			for (const [k, v] of pending) if (v.id === id || (fp && v.fp === fp)) pending.delete(k)
		},
		/** What clients see (no keys). */
		list: () => fresh().map(({ device_key: _key, ...v }) => v),
	}
}

module.exports = { createInvites, TTL_MS, AUTO_KEY }
