'use strict'

/**
 * WO-1029 phase 2a — destination ownership, seen from this server (owner 10.11: "local screendests should be driveable
 * from the local box"; a client on one box "should be able to drive both boxes").
 *
 *   cabled here  the destination has a cable to an output in THIS server's device graph (cluster-fanout.js cabledIds)
 *   owners       the servers it is cabled on: this one + every linked server whose device view cables it (cached 15 s
 *                by cluster-peers.js; a server that went offline keeps its last known cables, an unlinked one drops)
 *   kind         'backup'  cabled here AND on the master: the master mirrors it, this server holds it
 *                          (cluster-fanout-report.js `mirror`)
 *                'own'     cabled here, the master forwards to it: driven here, the master may press too (last press wins)
 *                'remote'  not cabled here, cabled on another server: this server only has a copy channel for it
 *                'local'   not forwarded anywhere / no link / nobody known to own it — as before linking
 *
 * Gates (the AMCP check of amcp-fanout.js `setClusterAirCheck`, `verdict`):
 *   - a backup channel is held while the master's fresh report mirrors it (409 AIR_HELD);
 *   - on a non-master, the PGM channel of a REMOTE screen is refused with 409 REMOTE_SCREEN (a test card, FTB, raw AMCP,
 *     media, timeline there would show on nobody's screen and answer ok); look takes are relayed first (look-relay.js);
 *   - the master changes nothing (it drives every screen and forwards).
 * Unknown owners (an old peer, a view not fetched yet) never refuse anything: wire compatibility is "as before".
 *
 * Press notice (`localPress`): a line this server sends itself on an OWN screen the master forwards here tells the master
 * `dest.pressed { destId, seq }` (signed info call, debounced per destination, never awaited by the press), so the
 * master stops catching that screen up (cluster-holders.js). An old-build master answers "unknown action": logged once,
 * not asked again for 10 minutes.
 */

const { mainChannels, cabledIds } = require('./cluster-fanout')

const NOTICE_MS = 1000
const OLD_PEER_RETRY_MS = 10 * 60 * 1000
const OWN_VIEW_MS = 1000
const { PRESSED } = require('./cluster-fanout-report')

/**
 * @param {{ selfId: () => string, ownView: () => object, peers: () => Array<{ id, name, online }>,
 *   peerView: (id: string) => Promise<object|null>, master: () => object, pairEnabled?: () => boolean,
 *   report: { heldBy: Function, forwardedBy: Function, holderOf: Function, view: Function },
 *   fanout?: () => { active: boolean, peers: object }|null, holder?: (destId: string) => string,
 *   call: (id: string, action: string, args: object, opts: object) => Promise<object>, now?: () => number, log?: Function }} deps
 */
function createOwnership(deps) {
	const now = deps.now || Date.now
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] ${msg}`)
	const peerCables = new Map() // linked server id → Set<destination id>
	const notices = new Map() // destination id → last notice time
	const oldMasters = new Map() // master id → when it answered "unknown action"
	let seq = now()
	let own = null

	/** This server's destinations → { dests: [{ id, label, main, pgm, prv, here }], byCh: Map<channel, dest> } (1 s). */
	function index() {
		if (own && now() - own.at < OWN_VIEW_MS) return own
		let view
		try {
			view = deps.ownView()
		} catch {
			view = null
		}
		const chans = mainChannels(view)
		const here = cabledIds(view)
		const dests = []
		const byCh = new Map()
		for (const d of view?.screenDestinations?.destinations || []) {
			const c = d && chans.get(d.id)
			if (!c) continue
			const main = Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0)
			const x = { id: d.id, label: c.label, main, pgm: c.pgm, prv: c.prv, here: here.has(d.id) }
			dests.push(x)
			byCh.set(c.pgm, x)
			if (c.prv && !byCh.has(c.prv)) byCh.set(c.prv, x)
		}
		own = { at: now(), dests, byCh }
		return own
	}

	/** After every cluster poll: the linked servers' cables (their device views, cached by cluster-peers.js). */
	async function refresh() {
		const list = deps.peers() || []
		for (const id of [...peerCables.keys()]) if (!list.some((p) => p.id === id)) peerCables.delete(id)
		for (const p of list) {
			if (!p?.online || !p.id) continue
			let view
			try {
				view = await deps.peerView(p.id)
			} catch {
				view = null
			}
			if (view?.graph) peerCables.set(p.id, cabledIds(view))
		}
		own = null
	}

	/** Linked servers (not this one) the destination is cabled on → [{ id, name, online }]. */
	function ownersElsewhere(destId) {
		const out = []
		for (const p of deps.peers() || []) if (peerCables.get(p.id)?.has(destId)) out.push({ id: p.id, name: p.name || p.id, online: p.online === true })
		return out
	}

	const isMaster = () => deps.master()?.is_master === true

	/** amcp-fanout.js check: '' | the master's name (held backup) | { code: 'REMOTE_SCREEN', drivenBy, owners } */
	function verdict(ch) {
		const held = deps.report.heldBy(ch)
		if (held) return held
		if (isMaster() || deps.pairEnabled?.()) return ''
		const d = index().byCh.get(Number(ch))
		if (!d || d.here || d.pgm !== Number(ch)) return '' // PRV stays this operator's
		const owners = ownersElsewhere(d.id)
		if (!owners.length) return '' // nobody known to own it: as before
		return { code: 'REMOTE_SCREEN', drivenBy: owners.map((o) => o.name).join(', '), owners: owners.map((o) => o.id) }
	}

	/** amcp-fanout.js: this server sent a line on `ch` itself → the master hears it when that is a forwarded own screen. */
	function localPress(ch) {
		if (isMaster()) return
		const d = index().byCh.get(Number(ch))
		if (!d || !d.here) return
		const fwd = deps.report.forwardedBy(d.pgm)
		if (!fwd || deps.report.heldBy(d.pgm)) return
		const t = now()
		if (t - (notices.get(d.id) || 0) < NOTICE_MS) return
		if (t - (oldMasters.get(fwd.id) ?? -Infinity) < OLD_PEER_RETRY_MS) return
		notices.set(d.id, t)
		seq = Math.max(seq + 1, t)
		Promise.resolve(deps.call(fwd.id, PRESSED, { destId: d.id, seq }, { quiet: true }))
			.catch((e) => ({ ok: false, error: String(e?.message || e) }))
			.then((r) => {
				if (r?.ok) return
				const why = String(r?.json?.error || r?.error || `HTTP ${r?.status}`)
				if (/unknown action/i.test(why)) {
					if (!oldMasters.has(fwd.id)) log('info', `${fwd.name} is an older build (no ${PRESSED}): it keeps catching ${d.label} up`)
					oldMasters.set(fwd.id, now())
				} else log('debug', `${PRESSED} → ${fwd.name}: ${why}`)
			})
	}

	/** Master side: forwarded anywhere? → destination id set (from the fan-out plans). */
	function forwardedIds() {
		const st = deps.fanout?.() || null
		const ids = new Set()
		for (const t of Object.values(st?.active ? st.peers || {} : {})) for (const d of t?.destinations || []) ids.add(d.id)
		return ids
	}

	/** GET /api/cluster `destinations` (rule 6): [{ id, label, main, owners, here, kind, holder }] */
	function destinations() {
		const self = String(deps.selfId?.() || 'self')
		const m = deps.master() || {}
		const fwd = isMaster() ? forwardedIds() : null
		return index().dests.map((d) => {
			const others = ownersElsewhere(d.id).map((o) => o.id)
			const owners = d.here ? [self, ...others] : others
			let kind = 'local'
			let holder = ''
			if (fwd) {
				if (fwd.has(d.id)) kind = d.here ? 'backup' : 'remote'
				if (!d.here && fwd.has(d.id)) holder = deps.holder?.(d.id) || ''
			} else {
				const by = deps.report.forwardedBy(d.pgm)
				const mirror = deps.report.view()?.mirror || []
				if (d.here && (mirror.includes(d.pgm) || (m.master_id && others.includes(m.master_id)))) kind = 'backup'
				else if (d.here && by) kind = 'own'
				else if (!d.here && others.length) kind = 'remote'
				if (kind === 'own') holder = deps.report.holderOf(d.pgm)
			}
			return { id: d.id, label: d.label, main: d.main, owners, here: d.here, kind, holder }
		})
	}

	/** What look-relay.js needs about a destination: the linked servers it is cabled on. */
	const owners = (ids) => (deps.peers() || []).filter((p) => (ids || []).includes(p.id)).map((p) => ({ id: p.id, name: p.name || p.id, online: p.online === true }))

	/** zone-actions.js R3: is this program channel's destination cabled on THIS server? */
	const cabledHere = (ch) => index().byCh.get(Number(ch))?.here === true

	return { refresh, verdict, localPress, destinations, owners, cabledHere }
}

module.exports = { createOwnership }
