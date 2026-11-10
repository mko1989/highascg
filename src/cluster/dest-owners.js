'use strict'

/**
 * WO-1029 plan 07 (Wave B) — THE owner lookup: on which linked servers each destination is cabled.
 *
 * One index per server process (`ownerIndexOf(ctx)`, kept on `ctx._destOwnerIndex`), read by every consumer that asks
 * "who owns this screen": destination-ownership.js (the AMCP gate, GET /api/cluster `destinations`, hence the media
 * needs of cluster-media-service.js), api/screen-not-here.js (the `owners` of a 409 NOT_HERE) and dest-route.js (where
 * a dest.* call goes). Before Wave B two caches did this (screen-not-here `warmOwners` and the ownership's own map);
 * a master that knew only its own destinations then missed the media a remote screen needs (found live 10.11).
 *
 *   refresh()        every online linked server's cables from its device view (cluster-peers.js caches the view 15 s);
 *                    a silent server keeps its last known cables, an unlinked one drops. Called after every poll.
 *   warm()           refresh() only when it never ran or is older than WARM_MS (a route asking between polls)
 *   ownersOf(id)     → [{ id, name, online, caps }] the linked servers (not this one) the destination is cabled on;
 *                    online / caps are the CURRENT peer state (cluster-peers.js snapshot), the cables the last known
 *   known()          → true once a refresh ran
 *
 * Cabled = config/destination-cabling.js through cluster-fanout.js `cabledIds` (an old peer's view without a
 * destination list is asked about its `destination_in` connectors, as before).
 */

const WARM_MS = 15 * 1000

/**
 * @param {{ peers: () => Array<{ id, name, online, caps? }>, peerView: (id: string) => Promise<object|null>,
 *   now?: () => number }} deps
 */
function createOwnerIndex(deps) {
	const now = deps.now || Date.now
	const cables = new Map() // linked server id → Set<destination id>
	let at = 0
	let busy = null
	const peersNow = () => {
		try {
			return deps.peers() || []
		} catch {
			return []
		}
	}

	async function refresh() {
		if (busy) return busy
		busy = (async () => {
			const { cabledIds } = require('./cluster-fanout')
			const list = peersNow()
			for (const id of [...cables.keys()]) if (!list.some((p) => p?.id === id)) cables.delete(id)
			for (const p of list) {
				if (!p?.id || p.online === false) continue
				const view = await Promise.resolve().then(() => deps.peerView(p.id)).catch(() => null)
				if (view?.graph) cables.set(p.id, cabledIds(view))
			}
			at = now()
		})()
		try {
			await busy
		} finally {
			busy = null
		}
	}

	const warm = () => (at && now() - at < WARM_MS ? Promise.resolve() : refresh())

	function ownersOf(destId) {
		if (!destId) return []
		const out = []
		for (const p of peersNow()) {
			if (!p?.id || !cables.get(p.id)?.has(destId)) continue
			out.push({ id: p.id, name: p.name || p.id, online: p.online === true, caps: Array.isArray(p.caps) ? p.caps : [] })
		}
		return out
	}

	return { refresh, warm, ownersOf, known: () => at > 0, cabledOn: (id) => cables.get(id) || new Set() }
}

/** The process' index over the cluster layer of this ctx (null while the cluster never started here). */
function ownerIndexOf(ctx) {
	if (ctx?._destOwnerIndex) return ctx._destOwnerIndex
	const cluster = ctx?._cluster // never create the cluster just to answer an owner question
	if (!cluster) return null
	ctx._destOwnerIndex = createOwnerIndex({
		peers: () => cluster.snapshot?.().peers || [],
		peerView: async (id) => {
			const r = await cluster.deviceView?.(id)
			return r?.status === 200 ? r.body : null
		},
	})
	return ctx._destOwnerIndex
}

module.exports = { createOwnerIndex, ownerIndexOf }
