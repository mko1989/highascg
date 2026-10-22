'use strict'

/**
 * WO-670 P3a — which linked server is the cluster's master (owner, answer 1: "we need a way to change masters if the
 * one fails seemlessly"). One master at a time, fenced by an epoch:
 *
 * - The master is named by a CLAIM { epoch, master, succession, auto, by, ts, sig }: `master` and `succession` are
 *   device-key fingerprints (cluster-media.js `fingerprint`), `by` is the signer's device public key (PEM). Any server
 *   of the cluster may sign one (the operator's "Make master" on any of them); a server accepts a claim only when the
 *   signer is itself or a server ITS operator linked (trust = links, as in P2b), and only when it beats the one it
 *   holds: higher epoch, or the same epoch with the lower master fingerprint (two halves of a split network that
 *   each promoted converge on one master when they meet again; the loser steps down).
 * - Claims travel both ways: pushed to every linked server when made (POST /api/cluster/master), and pulled from every
 *   online linked server on each cluster poll (GET /api/cluster/master). So a server that was off comes back, sees the
 *   higher epoch and steps down: no split brain.
 * - Auto failover (`auto`, part of the claim = one setting for the cluster): when the master has been unseen for
 *   FAILOVER_MS, the first server of `succession` that is still seen online (itself included) claims epoch + 1. Every
 *   other survivor waits for that claim. Outputs never depend on the master's process: every Caspar keeps playing.
 *
 * Stored device-local in the node's persistence file (`clusterMaster`), next to `clusterPeers`. P3a only decides and
 * shows who the master is; clients following it is P3b, per-destination fan-out from it P4.
 */

const { fingerprint } = require('./cluster-media')

const STORE_KEY = 'clusterMaster'
const FAILOVER_MS = 12000
const FP_RE = /^[0-9a-f]{16}$/
const MAX_SUCCESSION = 17

/** The signed text: field order fixed. */
const claimText = (c) => JSON.stringify([Number(c.epoch) || 0, String(c.master || ''), (c.succession || []).map(String), !!c.auto, String(c.by || ''), Number(c.ts) || 0])

/** Does claim a replace claim b? */
function beats(a, b) {
	if (!a) return false
	if (!b || !(b.epoch > 0)) return a.epoch > 0
	if (a.epoch !== b.epoch) return a.epoch > b.epoch
	return a.master !== b.master && a.master < b.master
}

/** Shape check (signature aside). */
function wellFormed(c) {
	return !!c && typeof c === 'object' && Number.isInteger(c.epoch) && c.epoch > 0 && FP_RE.test(String(c.master)) &&
		Array.isArray(c.succession) && c.succession.length <= MAX_SUCCESSION && c.succession.every((f) => FP_RE.test(String(f))) &&
		typeof c.by === 'string' && typeof c.sig === 'string' && Number.isFinite(Number(c.ts))
}

/**
 * @param {{ cluster: object, persistence: { get: Function, set: Function }, selfKey: string, sign: Function,
 *   verify: Function, fetchJson: Function, post: Function, now?: () => number, log?: Function, onChange?: Function }} deps
 */
function createMaster(deps) {
	const now = deps.now || Date.now
	const store = deps.persistence
	const me = fingerprint(deps.selfKey)
	const startedAt = now()
	let claim = wellFormed(store.get(STORE_KEY)) ? store.get(STORE_KEY) : null
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] ${msg}`)

	/** Linked peers with a recorded identity: [{ saved, key_id, online, last_seen }]. */
	function members() {
		const live = new Map(deps.cluster.snapshot().peers.map((p) => [p.id, p]))
		return deps.cluster.list().filter((s) => s.device_key).map((s) => ({ saved: s, key_id: fingerprint(s.device_key), online: live.get(s.id)?.online === true, last_seen: live.get(s.id)?.last_seen || 0 }))
	}

	/** Who signed it, if this server trusts them. */
	function signerKey(c) {
		const by = String(c.by || '').trim()
		if (by && by === String(deps.selfKey || '').trim()) return by
		return deps.cluster.byDeviceKey(by)?.device_key || null
	}

	function valid(c) {
		if (!wellFormed(c)) return 'malformed claim'
		const key = signerKey(c)
		if (!key) return 'signed by a server not linked here'
		if (!deps.verify(key, claimText(c), c.sig)) return 'bad signature'
		return ''
	}

	function adopt(c, how) {
		const was = claim
		claim = { epoch: c.epoch, master: c.master, succession: c.succession.map(String), auto: !!c.auto, by: c.by, ts: Number(c.ts), sig: c.sig }
		store.set(STORE_KEY, claim)
		const who = c.master === me ? 'this server' : nameOf(c.master)
		if (was?.master === me && c.master !== me) log('warn', `stepped down: ${who} is master (epoch ${c.epoch}, ${how})`)
		else log('info', `master ${who} epoch ${c.epoch} (${how})`)
		deps.onChange?.()
	}

	function nameOf(fp) {
		if (fp === me) return 'this server'
		return members().find((m) => m.key_id === fp)?.saved.name || fp
	}

	/** Receiver: POST /api/cluster/master. */
	function accept(body) {
		const err = valid(body)
		if (err) return { status: err === 'malformed claim' ? 400 : 403, body: { error: err } }
		if (!beats(body, claim)) {
			const same = claim && claim.epoch === body.epoch && claim.master === body.master
			return { status: same ? 200 : 409, body: same ? { ok: true } : { error: 'older than the claim held here', claim: view() } }
		}
		adopt(body, 'pushed')
		return { status: 200, body: { ok: true } }
	}

	/** Sign a new claim (epoch + 1), keep it, push it to every linked server. */
	async function make(masterFp, opts = {}) {
		const order = [masterFp, me, ...members().map((m) => m.key_id)]
		const succession = [...new Set(order)].slice(0, MAX_SUCCESSION)
		const c = { epoch: (claim?.epoch || 0) + 1, master: masterFp, succession, auto: opts.auto ?? claim?.auto ?? true, by: deps.selfKey, ts: now() }
		c.sig = deps.sign(claimText(c))
		adopt(c, opts.reason || 'operator')
		await Promise.all(members().map((m) => deps.post(m.saved.host, m.saved.port, '/api/cluster/master', c).then((r) => {
			if (!r.ok) log('warn', `${m.saved.name}: claim not taken (${r.json?.error || r.error || 'HTTP ' + r.status})`)
		})))
		return claim
	}

	/** Operator: { master: 'self' | peer id, auto? } → 200 { cluster }. */
	async function set(body) {
		const b = body && typeof body === 'object' ? body : {}
		let fp = me
		if (b.master && b.master !== 'self') {
			const s = deps.cluster.saved(String(b.master))
			if (!s) return { status: 404, body: { error: 'no such server' } }
			if (!s.device_key) return { status: 400, body: { error: `${s.name}: unlink and link it again (its identity was not recorded)` } }
			fp = fingerprint(s.device_key)
		} else if (!b.master && claim) fp = claim.master
		if (!me) return { status: 500, body: { error: 'this server has no device identity' } }
		await make(fp, { auto: typeof b.auto === 'boolean' ? b.auto : undefined })
		return { status: 200, body: view() }
	}

	/** After each cluster poll: pull peers' claims, then fail over if the master is gone. */
	let busy = false
	async function tick() {
		if (busy) return
		busy = true
		try {
			await pullAndFailover()
		} finally {
			busy = false
		}
	}

	async function pullAndFailover() {
		const online = members().filter((m) => m.online)
		for (const m of online) {
			const r = await deps.fetchJson(m.saved.host, m.saved.port, '/api/cluster/master')
			const c = r.ok ? r.json?.claim : null
			if (c && beats(c, claim) && !valid(c)) adopt(c, `from ${m.saved.name}`)
		}
		if (!claim?.auto || claim.master === me) return
		const all = members()
		const master = all.find((m) => m.key_id === claim.master)
		if (!master || master.online) return
		if (now() - Math.max(master.last_seen || 0, startedAt) < FAILOVER_MS) return
		const seen = new Set([me, ...all.filter((m) => m.online).map((m) => m.key_id)])
		const next = claim.succession.find((fp) => fp !== claim.master && seen.has(fp))
		if (next === me) await make(me, { reason: `failover: ${master.saved.name} unseen ${Math.round((now() - Math.max(master.last_seen || 0, startedAt)) / 1000)} s` })
	}

	/** What clients see (no signature): { epoch, master, master_id, is_master, auto, succession: [{ key_id, id, name }] }. */
	function view() {
		const ms = members()
		const who = (fp) => (fp === me ? { key_id: fp, id: 'self', name: 'this server' } : { key_id: fp, id: ms.find((m) => m.key_id === fp)?.saved.id || '', name: nameOf(fp) })
		if (!claim) return { epoch: 0, master: '', master_id: '', is_master: false, auto: true, succession: [], key_id: me }
		return { epoch: claim.epoch, master: claim.master, master_id: who(claim.master).id, is_master: claim.master === me, auto: claim.auto,
			succession: claim.succession.map(who), key_id: me }
	}

	/** The last linked server was unlinked: a server alone has no master. */
	function forget() {
		if (!claim) return
		claim = null
		store.set(STORE_KEY, null)
		log('info', 'no linked servers left: master claim dropped')
		deps.onChange?.()
	}

	return { accept, set, tick, view, forget, claim: () => claim, me }
}

module.exports = { createMaster, beats, claimText, wellFormed, FAILOVER_MS, STORE_KEY }
