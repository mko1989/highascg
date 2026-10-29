'use strict'

/**
 * WO-746 — one show on every linked server that switched "Share the show" on. The master is the one writer: its show
 * goes out by revision; an edit made on another server is proposed to the master, merged there (show-merge.js), and
 * comes back to everyone. The gates (each one is a test in smoke-wo746-*):
 *
 *   G1  off by default, per server (device-local `clusterShow.on`): a server with it off sends, takes and proposes
 *       nothing — its own project stays as it is.
 *   G2  never next to the hot-backup pair (replication.enabled): that pair syncs its own way.
 *   G3  only the master's pushes are taken: the signer must be the master in the claim this server holds.
 *   G4  epoch fence: a push or a proposal carries the master epoch; a different one is refused (an old master that
 *       comes back cannot overwrite the new one's show; a proposal made for the old master is not merged by the new).
 *   G5  stale / repeated pushes change nothing (same epoch + show, lower rev; same hash).
 *   G6  proposals are signed ACTIONS: the master's "Linked servers may press here" (accept_remote) locks them out.
 *   G7  concurrent edits: 3-way merge per item (look, timeline, cell …). Where two operators changed the same item the
 *       master's version stays; the proposer's own version is kept as a file and both servers say so (WS cluster:show).
 *   G8  the first show taken backs up this server's project (owner question 1); a show taken over local edits the
 *       master never had (after a split network) backs those up too. Backups: projects/_cluster/ (box-local).
 *   G9  device-local slices and stream keys never travel (show-merge.js showOf / intoProject, both ends).
 *   G10 a taken show never restarts Caspar: `caspar_apply` says when this server's Caspar layout no longer matches.
 *
 * Wire (cluster-call.js): info `show.push` { epoch, slug, rev, hash, base?, ops? | show } master → server, and action
 * `show.propose` { epoch, base, hash, ops } server → master → { hash, rev, conflicts, ops } (ops = theirs → merged).
 * Deltas are item-level ops against a show the receiver holds (the 6.7 MB project must not travel per autosave);
 * a receiver that does not hold the base answers 409 need_full and gets the whole show once.
 */

const M = require('./show-merge')

const HEARTBEAT_MS = 5000
const HISTORY = 48
const FULL_TIMEOUT_MS = 30000
const STORE_KEY = 'clusterShow'

/**
 * @param {{ store: { get: Function, set: Function }, isMaster: () => boolean, claim: () => ({ epoch: number,
 *   master: string }|null), fpOf: (peer: object) => string, peers: () => Array<{ id: string, name: string,
 *   online: boolean }>, call: Function, callMaster: Function, current: () => ({ slug: string, project: object }|null),
 *   commit: (project: object, slug: string, how: { own: boolean }) => Promise<object|void>|object|void,
 *   backup: (slug: string, project: object, tag: string) => string, pairEnabled: () => boolean,
 *   casparApply?: () => boolean, broadcast?: Function, now?: () => number, log?: Function }} deps
 */
function createSharedShow(deps) {
	const now = deps.now || Date.now
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] show: ${msg}`)
	const saved = () => ({ on: false, ...(deps.store.get(STORE_KEY) || {}) })
	const history = new Map() // hash → show (what the master pushed, merged or was proposed): bases for deltas / merges
	const peerState = new Map() // master: peer id → { acked, busy, at, failing, full }
	let held = saved().held ? { ...saved().held, show: null } : null // { show, hash, epoch, slug, rev }: the last master show taken (meta survives a restart)
	let local = null // { show, hash } — this server's show now (what its next edit builds on)
	let pending = null // follower: { base, baseShow, show, hash } waiting to be proposed
	let proposing = false
	let applying = false // our own commit is persisting: the write hook must not see it as an edit
	let lastConflict = null
	let cache = { key: '', show: null, hash: '' }

	const on = () => saved().on === true && !deps.pairEnabled()
	const follower = () => on() && !deps.isMaster() && !!deps.claim()?.epoch

	function remember(hash, show) {
		history.delete(hash)
		history.set(hash, show)
		while (history.size > HISTORY) history.delete(history.keys().next().value)
	}

	/** This server's show now: { slug, rev, show, hash, project } (hash cached per slug + rev + savedAt). */
	function mine() {
		const c = deps.current()
		if (!c?.project) return null
		const key = `${c.slug}|${c.project.rev}|${c.project.savedAt}`
		if (cache.key !== key) {
			const show = M.showOf(c.project)
			cache = { key, show, hash: M.hashShow(show) }
		}
		return { slug: c.slug, rev: Number(c.project.rev) || 0, show: cache.show, hash: cache.hash, project: c.project }
	}

	async function commit(show, slug, own) {
		const base = deps.current()?.project
		applying = !own
		try {
			await deps.commit(M.intoProject(base, show), slug, { own })
		} finally {
			applying = false
		}
	}

	function setOn(v) {
		const s = saved()
		// off: forget the shared state, so switching on again backs this server's project up again (G8)
		deps.store.set(STORE_KEY, v ? { ...s, on: true } : { on: false, before_share: s.before_share || '' })
		if (!v) [held, local, pending] = [null, null, null]
		log('info', v ? 'sharing switched on' : 'sharing switched off (this server keeps its project)')
		changed()
		if (v) void tick() // a master catches the others up now, not at the next poll
		return view()
	}
	const changed = () => deps.broadcast?.('cluster:show', view())

	/** The show content of `held` (after a restart only its meta is known: it is this server's show when hashes match). */
	function heldShow(m = mine()) {
		if (held && !held.show && m?.hash === held.hash) held.show = m.show
		return held?.show || null
	}

	function take(show, hash, epoch, slug, rev) {
		held = { show, hash, epoch, slug, rev }
		local = { show, hash }
		deps.store.set(STORE_KEY, { ...saved(), held: { hash, epoch, slug, rev } })
	}

	/** Follower: what the next edit builds on, read BEFORE the edit (the write hook sees the project after it). Only
	 *  once a master show was taken: before that (master off, or an older master) the edits stay this server's own. */
	function prime() {
		if (local || pending || proposing || !held || !follower()) return
		const m = mine()
		if (m) local = { show: m.show, hash: m.hash }
	}

	// ── master ────────────────────────────────────────────────────────────────────────────────────────────────

	/** The persist hook: any write of this server's project. */
	function written() {
		if (applying || !on()) return
		if (deps.isMaster()) return void pushAll()
		if (!follower()) return
		const m = mine()
		if (!m || !local || m.hash === local.hash) return // not primed yet: the next push or tick resyncs
		if (!pending) pending = { base: local.hash, baseShow: local.show }
		Object.assign(pending, { show: m.show, hash: m.hash, slug: m.slug })
		local = { show: m.show, hash: m.hash }
		void propose()
	}

	async function pushAll() {
		const m = mine()
		if (!m) return
		remember(m.hash, m.show)
		local = { show: m.show, hash: m.hash }
		await Promise.all(deps.peers().filter((p) => p.online).map((p) => pushTo(p, m)))
	}

	async function pushTo(p, m) {
		if (!peerState.has(p.id)) peerState.set(p.id, { acked: '', busy: false, at: 0, failing: '', full: false })
		const s = peerState.get(p.id)
		if (s.busy || (s.acked === m.hash && now() - s.at < HEARTBEAT_MS * 6)) return
		if (s.failing && now() - s.at < HEARTBEAT_MS) return
		const claim = deps.claim()
		const args = { epoch: claim?.epoch || 0, slug: m.slug, rev: m.rev, hash: m.hash }
		const base = !s.full && s.acked && s.acked !== m.hash ? history.get(s.acked) : null
		if (base) Object.assign(args, { base: s.acked, ops: M.diff(base, m.show) })
		else if (s.full) args.show = m.show
		// heartbeat, first contact, retry after a refusal: a probe — the receiver's gates answer it, a receiver that
		// already has this show takes it as is, and only an explicit need_full brings the whole show
		else Object.assign(args, { base: m.hash, ops: [] })
		Object.assign(s, { busy: true, at: now() })
		const r = await deps.call(p.id, 'show.push', args, { quiet: true, timeoutMs: args.show ? FULL_TIMEOUT_MS : undefined })
		s.busy = false
		if (r.json?.need_full && !args.show) {
			s.full = true // not a refusal: it does not hold that base — the whole show goes now, not at the heartbeat
			return pushTo(p, m)
		}
		const why = r.ok ? '' : r.json?.error || r.error || `HTTP ${r.status}`
		if (r.ok && r.status !== 202) {
			Object.assign(s, { acked: r.json?.held || m.hash, full: false })
			if (!saved().shared_at) deps.store.set(STORE_KEY, { ...saved(), shared_at: new Date(now()).toISOString() }) // G8: a show taken later is "diverged"
		}
		if (why !== s.failing && r.status !== 202) {
			log(why ? 'warn' : 'info', `${p.name}: ${why || 'taking the show'}`)
			s.failing = why
			changed()
		}
	}

	/** Action `show.propose` on the master. */
	async function onPropose(args, peer) {
		if (!on()) return refuse(409, 'shared show is off on the master')
		if (!deps.isMaster()) return refuse(409, 'this server is not the master')
		const epoch = deps.claim()?.epoch || 0
		if (Number(args.epoch) !== epoch) return refuse(409, `epoch ${args.epoch} is not the master's (${epoch})`, { epoch })
		const m = mine()
		if (!m) return refuse(409, 'the master has no project')
		remember(m.hash, m.show)
		const s = peerState.get(peer.id)
		const base = args.base === m.hash ? m.show : history.get(String(args.base || ''))
		if (!base || !Array.isArray(args.ops)) {
			if (s) s.acked = '' // it gets the whole show at the next push
			return refuse(409, 'the master does not hold the show this edit started from', { base_unknown: true })
		}
		const theirs = M.apply(base, args.ops).doc
		if (M.hashShow(theirs) !== args.hash) {
			if (s) s.acked = ''
			return refuse(409, 'the edit did not arrive whole', { base_unknown: true })
		}
		remember(args.hash, theirs)
		const { merged, conflicts } = base === m.show ? { merged: theirs, conflicts: [] } : M.merge3(base, m.show, theirs)
		const hash = M.hashShow(merged)
		remember(hash, merged)
		if (s) s.acked = hash // the proposer holds the merged show once it reads this answer: no echo push
		else peerState.set(peer.id, { acked: hash, busy: false, at: now(), failing: '', full: false })
		if (conflicts.length) noteConflict(conflicts, peer.name, '')
		if (hash !== m.hash) await commit(merged, m.slug, true) // an own write: the hook pushes it to the others
		return { status: 200, body: { ok: true, hash, rev: mine()?.rev || m.rev, conflicts, ops: M.diff(theirs, merged) } }
	}

	// ── follower ──────────────────────────────────────────────────────────────────────────────────────────────

	async function propose() {
		if (proposing || !pending) return
		proposing = true
		const p = pending
		pending = null
		const claim = deps.claim()
		const r = await deps.callMaster('show.propose', { epoch: claim?.epoch || 0, base: p.base, hash: p.hash, ops: M.diff(p.baseShow, p.show) }, { quiet: true })
		proposing = false
		if (r.ok) await proposed(p, r.json || {})
		else if (r.status === 0 || r.status >= 500 || (r.status === 409 && r.json?.epoch !== undefined)) {
			// master unreachable, or the claim moved: the edit waits (newer edits join it) for the next tick
			pending = pending ? { ...pending, base: p.base, baseShow: p.baseShow } : p
			log('warn', `edit waits for the master: ${r.json?.error || r.error || 'HTTP ' + r.status}`)
		} else {
			// refused: this edit and any built on it are kept as one file; the server goes back to the master's show
			const lost = pending?.show || p.show
			pending = null
			const file = deps.backup(p.slug, M.intoProject(deps.current()?.project, lost), 'refused')
			noteConflict(['(whole edit)'], 'the master', file, r.json?.error || `HTTP ${r.status}`)
			const back = heldShow()
			if (back && !pending) {
				await commit(back, held.slug, false)
				local = { show: back, hash: held.hash }
			}
		}
		if (pending) void propose()
	}

	async function proposed(p, a) {
		const merged = M.apply(p.show, Array.isArray(a.ops) ? a.ops : []).doc
		const hash = M.hashShow(merged)
		if (hash !== a.hash) log('warn', `merged show did not match the master's hash (${hash} ≠ ${a.hash}): waiting for its push`)
		else {
			const mineNow = local
			take(merged, hash, deps.claim()?.epoch || 0, p.slug, Number(a.rev) || 0)
			if (pending) local = mineNow // newer edits wait on top of p: the master holds p, so they stay its base
			else if (hash !== mineNow?.hash) await commit(merged, p.slug, false)
		}
		if (a.conflicts?.length) {
			const file = deps.backup(p.slug, M.intoProject(deps.current()?.project, p.show), 'conflict')
			noteConflict(a.conflicts, 'the master', file)
		}
		changed()
	}

	/** Info `show.push` from the master. */
	async function onPush(args, peer) {
		if (!on()) return refuse(409, deps.pairEnabled() ? 'this server is in a hot-backup pair' : 'shared show is off on this server')
		const claim = deps.claim()
		if (deps.isMaster()) return refuse(409, 'this server is the master')
		if (!claim || claim.master !== deps.fpOf(peer)) return refuse(403, 'not the master this server follows')
		if (Number(args.epoch) !== claim.epoch) return refuse(409, `epoch ${args.epoch} is not this server's (${claim.epoch})`)
		const slug = String(args.slug || '')
		if (held && held.epoch === claim.epoch && held.slug === slug && Number(args.rev) < held.rev && args.hash !== held.hash)
			return refuse(409, `stale show (rev ${args.rev} < ${held.rev})`, { held: held.hash })
		if (proposing || pending) return { status: 202, body: { ok: true, deferred: 'proposing an edit' } }
		const m = mine()
		if (held && held.hash === args.hash && m?.hash === held.hash) return { status: 200, body: { ok: true, held: held.hash } }
		let show = args.show
		if (!show) {
			const base = held?.hash === args.base ? heldShow(m) : m?.hash === args.base ? m.show : null
			if (!base || !Array.isArray(args.ops)) return refuse(409, 'base not held here', { need_full: true })
			show = M.apply(base, args.ops).doc
		}
		if (M.hashShow(show) !== args.hash) return refuse(409, 'show did not arrive whole', { need_full: true })
		const s = saved()
		if (m && m.hash !== args.hash && (!held || m.hash !== held.hash)) {
			const tag = s.shared_at ? 'diverged' : 'before-share'
			const file = deps.backup(m.slug, m.project, tag)
			deps.store.set(STORE_KEY, { ...saved(), [tag === 'before-share' ? 'before_share' : 'diverged']: file })
			log('warn', `${tag === 'before-share' ? 'first shared show: this server\'s project' : 'local edits the master never had'} kept as ${file}`)
		}
		if (m?.hash !== args.hash) await commit(show, slug, false)
		take(show, args.hash, claim.epoch, slug, Number(args.rev) || 0)
		if (!saved().shared_at) deps.store.set(STORE_KEY, { ...saved(), shared_at: new Date(now()).toISOString() })
		changed()
		return { status: 200, body: { ok: true, held: args.hash } }
	}

	function refuse(status, error, extra = {}) {
		return { status, body: { error, ...extra } }
	}

	function noteConflict(paths, by, file, error = '') {
		lastConflict = { at: new Date(now()).toISOString(), paths: paths.slice(0, 20), count: paths.length, with: by, file, error }
		log('warn', `${error || `${paths.length} item(s) edited on both servers`} — the master's version stays${file ? `; this server's kept as ${file}` : ''}`)
		changed()
	}

	/** After each cluster poll: master — catch up every peer (a load, a peer back online); follower — retry an edit. */
	async function tick() {
		prune()
		if (!on()) return
		if (deps.isMaster()) return pushAll()
		prime()
		if (pending && !proposing) return propose()
	}

	/** WO-802: per-server state is kept only for servers still linked (an unlinked one is neither listed nor pushed to). */
	function prune() {
		const ids = new Set((deps.peers() || []).map((p) => p.id))
		for (const id of [...peerState.keys()]) if (!ids.has(id)) peerState.delete(id)
	}

	function view() {
		prune()
		const s = saved()
		const m = on() ? mine() : null
		const role = !on() ? 'off' : deps.isMaster() ? 'master' : follower() ? 'follower' : 'alone'
		const peers = Object.fromEntries([...peerState].map(([id, p]) => [id, { in_sync: !!m && p.acked === m.hash, error: p.failing }]))
		return { on: s.on === true, blocked: s.on === true && deps.pairEnabled() ? 'hot-backup pair' : '', role,
			hash: m?.hash || '', rev: m?.rev || 0, slug: m?.slug || '', held: held?.hash || '', in_sync: !!held && held.hash === m?.hash,
			pending: !!pending || proposing, peers, conflict: lastConflict, before_share: s.before_share || '',
			caspar_apply: role === 'follower' && !!deps.casparApply?.() }
	}

	const info = { 'show.push': onPush }
	const actions = { 'show.propose': onPropose }
	return { setOn, written, tick, view, info, actions, isApplying: () => applying, _peerState: peerState }
}

module.exports = { createSharedShow, HEARTBEAT_MS, STORE_KEY }
