'use strict'

/**
 * WO-1029 plan 06 S5 / S6 (owner D1: "yes" — destinations are shared whenever servers are linked, without the "share
 * the show" toggle). One list of screen destinations on every linked server that advertises CAP; the operator GUI is
 * never part of it (S1: per server). Independent of `clusterShow.on`.
 *
 * One writer: the master of the claim (or, with no claim, the lowest fingerprint among this server and the online
 * linked servers with CAP — stable, no election). A Devices edit (add / update / remove a destination, the CRUD
 * itself, device-view-crud.js) is:
 *   on the writer   applied there (as before), pushed at once to every online linked server: info `dests.push`
 *                   { epoch, hash, list, tombs }
 *   elsewhere       applied there, then proposed as an op to the writer: info `dests.propose` { epoch, ops } —
 *                   op = { upsert: dest, index } | { remove: id }; kept (store) and retried each poll while the writer
 *                   is unreachable; the writer applies it and pushes the result to everyone.
 * A push is taken through the guard (shared-show-dests-ctx.js `takeList`):
 *   - a destination missing from the list and CABLED here is kept, and the state says so:
 *     `{ conflict: 'cabled here', destId }` (never silently removed: plan 06 / report 03 F1.3);
 *   - only an EXPLICIT delete removes one (its id travels in `tombs`) — and then its cables here go too (S6, D7);
 *     a tombstoned id that is already gone here has its orphan cables deleted (the clean-up a server that was offline
 *     during the delete does when it comes back) — never on a list that merely lacks it;
 *   - an empty list without tombstones never empties a server that has destinations (a transient empty list).
 * A follower's New project / Load / settings write is not an edit: the next poll puts the held list back (`drifted`).
 * Pending ops survive a restart (store); a server back from a flap gets the writer's list at the next poll — both
 * converge. Info, not actions: like the Devices relay, a destination edit is configuration, not a press on air
 * (`accept_remote` does not lock it out).
 */

const { hashShow } = require('./show-merge')

const CAP = 'dests-shared'
const STORE_KEY = 'clusterDests'
const HEARTBEAT_MS = 30000
const RETRY_MS = 5000
const MAX_TOMBS = 64
const TOMB_MS = 7 * 24 * 3600 * 1000

/**
 * @param {{ store: { get: Function, set: Function }, selfFp: () => string, claim: () => ({ epoch: number, master: string }|null),
 *   peers: () => Array<{ id: string, name: string, fp: string, online: boolean, caps?: string[] }>,
 *   call: (id: string, action: string, args: object, o?: object) => Promise<{ ok: boolean, status: number, json?: object, error?: string }>,
 *   list: () => object[], take: (list: object[], tombs: string[]) => ({ conflicts: object[], pruned: string[] }),
 *   applyOps: (ops: object[]) => void, pairEnabled?: () => boolean, broadcast?: Function, now?: () => number, log?: Function }} deps
 */
function createSharedDests(deps) {
	const now = deps.now || Date.now
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] destinations: ${msg}`)
	const saved = () => ({ pending: [], tombs: [], conflicts: [], ...(deps.store.get(STORE_KEY) || {}) })
	const save = (patch) => deps.store.set(STORE_KEY, { ...saved(), ...patch })
	const peerState = new Map() // writer: peer id → { acked, tombs: Set, at, busy, failing, conflicts }
	let proposing = false

	const capable = (p) => Array.isArray(p?.caps) && p.caps.includes(CAP)
	const peersNow = () => {
		try {
			return deps.peers() || []
		} catch {
			return []
		}
	}
	const hashOf = (list) => hashShow(list || [])

	/** The writer's fingerprint: the claim's master, else the lowest fingerprint among this server + capable online peers. */
	function writerFp() {
		const c = deps.claim?.()
		if (c?.epoch > 0 && c.master) return c.master
		return [deps.selfFp(), ...peersNow().filter((p) => p.online && capable(p)).map((p) => p.fp)].filter(Boolean).sort()[0] || ''
	}
	const amWriter = () => writerFp() === deps.selfFp()
	const writerPeer = () => peersNow().find((p) => p.fp === writerFp()) || null
	/** Shared at all: not in a hot-backup pair, and some linked server speaks CAP (a writer on an older build: never). */
	function active() {
		if (deps.pairEnabled?.()) return false
		if (amWriter()) return peersNow().some(capable) || peersNow().some((p) => saved().capable?.includes(p.id))
		const w = writerPeer()
		return capable(w) || (!!w && saved().writer === w.fp) // offline now: its caps are unknown, the last push said it shares
	}
	const epoch = () => deps.claim?.()?.epoch || 0

	const liveTombs = () => saved().tombs.filter((x) => now() - x.at < TOMB_MS).slice(-MAX_TOMBS)

	// ── writer ────────────────────────────────────────────────────────────────────────────────────────────────

	async function pushAll(force = false) {
		if (!amWriter() || deps.pairEnabled?.()) return
		const list = deps.list()
		const msg = { epoch: epoch(), hash: hashOf(list), list, tombs: liveTombs().map((x) => x.id) }
		const ids = peersNow().filter(capable).map((p) => p.id)
		if (ids.length) save({ capable: [...new Set([...(saved().capable || []), ...ids])] })
		await Promise.all(peersNow().filter((p) => p.online && capable(p)).map((p) => pushTo(p, msg, force)))
	}

	async function pushTo(p, msg, force) {
		if (!peerState.has(p.id)) peerState.set(p.id, { acked: '', tombs: new Set(), at: 0, busy: false, failing: '', conflicts: [] })
		const s = peerState.get(p.id)
		if (s.busy) return void (s.again = true)
		if (!force && s.acked === msg.hash && now() - s.at < HEARTBEAT_MS) return
		if (!force && s.failing && now() - s.at < RETRY_MS) return
		Object.assign(s, { busy: true, at: now(), again: false })
		const r = await deps.call(p.id, 'dests.push', msg, { quiet: true })
		s.busy = false
		const why = r.ok ? '' : r.json?.error || r.error || `HTTP ${r.status}`
		if (r.ok && r.status !== 202) {
			s.acked = msg.hash
			s.tombs = new Set(msg.tombs)
			s.conflicts = Array.isArray(r.json?.conflicts) ? r.json.conflicts : []
		}
		if (why !== s.failing) {
			log(why ? 'warn' : 'info', `${p.name}: ${why || 'takes the list'}`)
			s.failing = why
			changed()
		}
		if (s.again) return pushTo(p, { ...msg, ...current() }, true)
	}
	const current = () => {
		const list = deps.list()
		return { epoch: epoch(), hash: hashOf(list), list, tombs: liveTombs().map((x) => x.id) }
	}

	/** Info `dests.propose` on the writer. */
	function onPropose(args, peer) {
		if (!amWriter()) return refuse(409, 'this server does not hold the destination list', { writer: writerFp() })
		if (Number(args?.epoch || 0) !== epoch()) return refuse(409, `epoch ${args?.epoch} is not this server's (${epoch()})`, { epoch: epoch() })
		const ops = Array.isArray(args?.ops) ? args.ops.filter(validOp) : []
		if (!ops.length) return refuse(400, 'no ops')
		for (const op of ops) if (op.remove) tomb(op.remove)
		deps.applyOps(ops)
		log('info', `${peer?.name || 'a linked server'}: ${ops.map(opText).join(', ')}`)
		void pushAll(true) // the others hear it now, not at the next poll
		changed()
		return { status: 200, body: { ok: true, hash: hashOf(deps.list()) } }
	}

	const tomb = (id) => save({ tombs: [...saved().tombs.filter((x) => x.id !== id), { id: String(id), at: now() }].slice(-MAX_TOMBS) })

	// ── every other server ────────────────────────────────────────────────────────────────────────────────────

	/** Info `dests.push` from the writer. */
	function onPush(args, peer) {
		if (deps.pairEnabled?.()) return refuse(409, 'this server is in a hot-backup pair')
		if (amWriter()) return refuse(409, 'this server holds the destination list')
		if (!peer || peer.fp !== writerFp()) return refuse(403, 'not the server that holds the destination list here')
		if (epoch() && Number(args?.epoch) !== epoch()) return refuse(409, `epoch ${args?.epoch} is not this server's (${epoch()})`)
		if (!Array.isArray(args?.list) || hashOf(args.list) !== args.hash) return refuse(400, 'list did not arrive whole')
		if (saved().pending.length || proposing) return { status: 202, body: { ok: true, deferred: 'proposing an edit' } }
		return { status: 200, body: { ok: true, held: args.hash, ...takeHeld({ hash: args.hash, list: args.list, tombs: Array.isArray(args.tombs) ? args.tombs.map(String) : [] }) } }
	}

	function takeHeld(held) {
		const r = deps.take(held.list, held.tombs) || { conflicts: [], pruned: [] }
		save({ held, applied: hashOf(deps.list()), conflicts: r.conflicts || [], writer: writerFp() })
		if (r.conflicts?.length) log('warn', `kept here (cabled): ${r.conflicts.map((c) => c.destId).join(', ')}`)
		changed()
		return { conflicts: r.conflicts || [], pruned: r.pruned || [] }
	}

	async function propose() {
		if (proposing) return
		const pending = saved().pending
		const w = writerPeer()
		if (!pending.length || !w?.online) return
		proposing = true
		let r
		try {
			r = await deps.call(w.id, 'dests.propose', { epoch: epoch(), ops: pending }, { quiet: true })
		} finally {
			proposing = false
		}
		const left = saved().pending.slice(pending.length) // ops made while this one travelled
		if (r.ok) save({ pending: left, error: '' })
		else if (r.status === 0 || r.status >= 500 || (r.status === 409 && r.json?.epoch !== undefined)) return log('warn', `edit waits for ${w.name}: ${r.json?.error || r.error || 'HTTP ' + r.status}`)
		else {
			save({ pending: left, error: r.json?.error || `HTTP ${r.status}` })
			log('warn', `${w.name} refused the edit (${r.json?.error || r.status}): back to its list`)
			const held = saved().held
			if (held && !left.length) takeHeld(held)
		}
		changed()
		if (left.length) return propose()
	}

	/**
	 * The CRUD hook: an operator's Devices edit here. Returns null when nothing is shared, else the report the client
	 * shows: { writer, sent: [server names], pending: [server names offline (they clean up when back)] }.
	 */
	function localEdit(op) {
		if (!validOp(op) || !active()) return null
		const linked = peersNow()
		const report = { writer: amWriter() ? 'self' : writerPeer()?.id || '', sent: linked.filter((p) => p.online).map((p) => p.name || p.id), pending: linked.filter((p) => !p.online).map((p) => p.name || p.id) }
		if (amWriter()) {
			if (op.remove) tomb(op.remove)
			void pushAll(true)
		} else {
			save({ pending: [...saved().pending, op] })
			void propose()
		}
		changed()
		return report
	}

	/** After every cluster poll. */
	async function tick() {
		prune()
		if (!active()) return
		if (amWriter()) return pushAll()
		if (saved().pending.length) return propose()
		// a Load / New project / settings write here changed the list: the shared one comes back (it is not an edit)
		const s = saved()
		if (s.held && s.applied && hashOf(deps.list()) !== s.applied) {
			log('info', 'the list here changed outside the Devices edits: back to the shared list')
			takeHeld(s.held)
		}
	}

	function prune() {
		const ids = new Set(peersNow().map((p) => p.id))
		for (const id of [...peerState.keys()]) if (!ids.has(id)) peerState.delete(id)
	}

	/** True while this list is governed here (the show must not also apply destinations: shared-show-ctx.js). */
	const owns = () => active()

	function view() {
		const s = saved()
		const writer = amWriter() ? 'self' : writerPeer()?.id || ''
		const tombs = liveTombs()
		const peers = Object.fromEntries([...peerState].map(([id, p]) => [id, { in_sync: p.acked === hashOf(deps.list()), error: p.failing, conflicts: p.conflicts }]))
		// S6: an explicit delete is pending on a linked server until it took a list that carries the tombstone
		const removals = amWriter()
			? tombs.map((t) => ({ destId: t.id, at: new Date(t.at).toISOString(), pending: peersNow().filter((p) => capable(p) || s.capable?.includes(p.id)).filter((p) => !peerState.get(p.id)?.tombs.has(t.id)).map((p) => p.id) }))
			: []
		return { active: active(), writer, hash: hashOf(deps.list()), held: s.held?.hash || '', pending: s.pending.length, error: s.error || '', conflicts: s.conflicts || [], peers, removals }
	}
	const changed = () => deps.broadcast?.('cluster:destinations', view())

	function refuse(status, error, extra = {}) {
		return { status, body: { error, ...extra } }
	}

	return { localEdit, tick, view, owns, active, amWriter, info: { 'dests.push': onPush, 'dests.propose': onPropose }, _pushAll: pushAll }
}

function validOp(op) {
	if (!op || typeof op !== 'object') return false
	if (op.remove) return typeof op.remove === 'string'
	return !!op.upsert && typeof op.upsert === 'object' && typeof op.upsert.id === 'string' && op.upsert.mode !== 'operator_gui' && op.upsert.mode !== 'host_channel'
}
const opText = (op) => (op.remove ? `removed ${op.remove}` : `${op.upsert.label || op.upsert.id}`)

module.exports = { createSharedDests, CAP, STORE_KEY }
