'use strict'

/**
 * WO-1029 plan 07 C0 — capabilities: what each linked server supports, never guessed from version strings.
 *
 * Every server advertises `caps: string[]` in its ping (/api/replication/ping) and in its signed hello. Linked servers
 * run mixed builds during a rollout; a feature that needs both ends is switched per link with peerHas / allPeersHave.
 * A peer that sends no `caps` (older build) has `[]`. Caps live on the peer entry only (never persisted): every poll /
 * hello replaces them and a peer going offline clears them. The hello's `caps` field is NOT in the signed text (an
 * older receiver verifies the old text), so it is advisory like the ping — it only ever switches optional features.
 */

/** What THIS build supports (advertised). Add one line per capability, with what it promises. */
const SUPPORTED = [
	'hello', // signed hello (POST /api/cluster/hello): re-addressing by device key, one-way reachability
	'fanout-report', // the master's forwarded / mirror report served to linked servers
	'dest-pressed', // holder notices: a destination's pressed state reaches the other servers
	'apply', // cluster apply: GET /api/caspar-config/dirty + the apply plan answer for this server
	'orphan-edges', // the cabling view lists orphan edges (cabled outputs with no destination)
	'call-signed', // clock-free signed node-to-node call transport (cluster-call.js)
]

/** Names reserved for the coming plan 07 steps. NOT advertised until the step lands: move a name into SUPPORTED. */
const RESERVED = [
	'dest-actions', // node-to-node dest.* calls
	'channels-cabled', // channels only where cabled
	'feed-relay', // the picture relay
]

/** A wire value → sorted unique short names; anything else (older build: absent) → []. */
const normalize = (v) =>
	Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9._-]{0,39}$/.test(x)))].sort().slice(0, 64) : []

/** The list this build advertises. */
const supported = () => normalize(SUPPORTED)

/**
 * The peer-side API over the cluster's peer map (entries `{ saved, live }`, caps in `live.caps`).
 * @param {Map<string, object>} peers
 */
function createCapsApi(peers) {
	const peerCaps = (id) => {
		const p = peers.get(id)
		return p && p.live.online !== false ? normalize(p.live.caps) : []
	}
	const peerHas = (id, cap) => peerCaps(id).includes(cap)
	/** Every linked server must have `cap`; an offline one counts as missing (its caps are unknown). */
	function allPeersHave(cap) {
		const missing = []
		for (const [id, p] of peers) {
			const name = p.saved.name || id
			if (p.live.online !== true) missing.push({ id, name, reason: 'offline' })
			else if (!normalize(p.live.caps).includes(cap)) missing.push({ id, name, reason: 'no ' + cap })
		}
		return { ok: missing.length === 0, missing }
	}
	return { peerCaps, peerHas, allPeersHave }
}

module.exports = { SUPPORTED, RESERVED, normalize, supported, createCapsApi }
