'use strict'

/**
 * WO-723 (replaces WO-712 R1's stored ticks) — what THIS server does, resolved from its config and the linked servers,
 * never ticked. Owner 24.10: "It doesn't need to be a tick box. It gets resolved in config. But when devices are
 * connected there should be a choice … which server should send, receive".
 *
 *   tracking                    this server's project has detection on and ≥ 1 camera (the detect service provides it)
 *   detection                   = tracking (older peers' cards read it; detect-service's wanted() is the config check)
 *   zones · auto · presenters   tracking here, or no online linked server is doing tracking
 *   lighting · ptz · artnet_in  the sender choice (server-senders.js): this server, a linked one, or Auto
 *   accept_remote               WO-712 D3, the one stored setting: remote actions count as this server's own press
 * Media / playout is not a duty: which server shows a destination is the WO-670 cables in Devices.
 *
 * Without linked servers (or before the cluster service starts) everything resolves on: a single box does it all.
 * Consumers keep calling has(name) / onChange(fn). has() reads the last resolution (it sits in the DMX send path), at
 * most REFRESH_MS old; refresh() re-resolves now and notifies on a real change — after each cluster poll, a project
 * change and a sender change. provide({ tracking, cluster }) plugs in the two sources once they exist.
 *
 * The shared instance uses utils/persistence, which redirects to a scratch file under `node --test`
 * (NODE_TEST_CONTEXT), so a smoke can never touch the real state file.
 */

const { createSenders, resolve, KINDS, EVERY } = require('./server-senders')

const STORE_KEY = 'serverDuties' // only accept_remote is still read from it (R1 kept every tick here)
const NAMES = ['tracking', 'detection', 'zones', 'auto', 'presenters', 'lighting', 'ptz', 'artnet_in', 'accept_remote']
const SETTABLE = ['accept_remote']
const REFRESH_MS = 1000

/** @returns {string|null} why `patch` is not acceptable, or null. */
function validatePatch(patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'patch must be an object, e.g. {"accept_remote": false}'
	const keys = Object.keys(patch)
	if (!keys.length) return 'patch is empty'
	for (const k of keys) {
		if (NAMES.includes(k) && !SETTABLE.includes(k))
			return `"${k}" is resolved from this server's config and the linked servers, not set (WO-723)`
		if (!SETTABLE.includes(k)) return `unknown setting "${k}" (settable: ${SETTABLE.join(', ')})`
		if (typeof patch[k] !== 'boolean') return `"${k}" must be true or false`
	}
	return null
}

/**
 * @param {{ persistence: { get: Function, set: Function }, senders?: ReturnType<typeof createSenders>, now?: () => number }} opts
 */
function createServerDuties({ persistence, senders = createSenders({ persistence }), now = Date.now }) {
	let acceptRemote = persistence.get(STORE_KEY)?.accept_remote !== false
	const src = { tracking: () => false, cluster: null }
	let last = null
	let lastAt = 0
	const subs = new Set()

	/** { self: {fp, name}, peers: [{id, fp, name, online, duties, tracking}], master: fp, tracking } — never throws. */
	function view() {
		const safe = (fn, fallback) => {
			try {
				return fn()
			} catch {
				return fallback
			}
		}
		const c = safe(() => (src.cluster ? src.cluster() : null), null)
		const t = safe(() => !!src.tracking(), false)
		const peers = (Array.isArray(c?.peers) ? c.peers : []).map((p) => ({ ...p, tracking: p?.duties?.tracking === true }))
		return { self: c?.self || { fp: '', name: '' }, peers, master: c?.master || '', tracking: t }
	}

	function resolveAll(v = view()) {
		const tr = v.tracking || !v.peers.some((p) => p.online && p.tracking)
		const s = senders.get()
		const out = { tracking: v.tracking, detection: v.tracking, zones: tr, auto: tr, presenters: tr }
		for (const k of KINDS) out[k] = resolve(k, s[k], v).here
		out.accept_remote = acceptRemote
		return out
	}

	function refresh() {
		const prev = last
		last = resolveAll()
		lastAt = now()
		if (prev && NAMES.every((n) => prev[n] === last[n])) return { ...last }
		if (prev)
			for (const fn of [...subs]) {
				try {
					fn({ ...last }, { ...prev })
				} catch {
					/* one bad subscriber must not stop the others */
				}
			}
		return { ...last }
	}

	const current = () => (!last || now() - lastAt > REFRESH_MS ? refresh() : last)

	/** GET /api/server/senders: each kind's choice and who that resolves to, and the servers a picker lists. */
	function sendersView() {
		const v = view()
		const name = (fp) => (fp === v.self.fp ? v.self.name : v.peers.find((p) => p.fp === fp)?.name || fp)
		const s = senders.get()
		const out = {}
		const nameOf = (who) => (who === EVERY ? EVERY : name(who))
		for (const k of KINDS) {
			const r = resolve(k, s[k], v)
			// auto_name: who Auto would pick right now, so the picker's Auto item tells the truth while a server is chosen
			out[k] = { by: s[k].by, at: s[k].at, auto: r.auto, here: r.here, who: r.who, who_name: nameOf(r.who), auto_name: nameOf(resolve(k, { by: '' }, v).who) }
		}
		const servers = [{ fp: v.self.fp, name: v.self.name, self: true, online: true },
			...v.peers.filter((p) => p.fp).map((p) => ({ fp: p.fp, name: p.name, self: false, online: p.online === true, refused: String(p.refused || '') }))]
		return { senders: out, servers: v.self.fp ? servers : [] }
	}

	senders.onChange(() => refresh())
	refresh() // the standalone answer, so the first provide() that changes it notifies

	return {
		has: (name) => current()[name] === true,
		get: () => ({ ...current() }),
		refresh,
		/** @throws {Error} .status 400 for a resolved duty, an unknown name or a non-boolean. → the resolved object */
		set(patch) {
			const bad = validatePatch(patch)
			if (bad) throw Object.assign(new Error(bad), { status: 400 })
			if (patch.accept_remote !== acceptRemote) {
				acceptRemote = patch.accept_remote
				persistence.set(STORE_KEY, { accept_remote: acceptRemote })
			}
			return refresh()
		},
		/** fn(next, prev) after every change. → unsubscribe */
		onChange(fn) {
			subs.add(fn)
			return () => subs.delete(fn)
		},
		/** { tracking?: () => boolean, cluster?: () => view } — the detect service and the cluster service plug in. */
		provide(p) {
			if (typeof p?.tracking === 'function') src.tracking = p.tracking
			if (typeof p?.cluster === 'function') src.cluster = p.cluster
			return refresh()
		},
		senders,
		sendersView,
	}
}

let shared = null
const sharedOf = () => shared || (shared = createServerDuties({ persistence: require('../utils/persistence') }))

module.exports = {
	STORE_KEY,
	NAMES,
	createServerDuties,
	has: (name) => sharedOf().has(name),
	get: () => sharedOf().get(),
	set: (patch) => sharedOf().set(patch),
	refresh: () => sharedOf().refresh(),
	onChange: (fn) => sharedOf().onChange(fn),
	provide: (p) => sharedOf().provide(p),
	senders: () => sharedOf().senders,
	sendersView: () => sharedOf().sendersView(),
}
