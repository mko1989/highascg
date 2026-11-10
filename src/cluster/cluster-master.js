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
 * - WO-802: a claim is held only while its master is this server or a server linked here. Unlinking the master drops
 *   the claim (`dropped`, run on every removal); a claim naming an unlinked master is neither taken nor kept. The epoch
 *   seen stays as a floor, so the next claim made here still beats the rest of the cluster's.
 *
 * Stored device-local in the node's persistence file (`clusterMaster`), next to `clusterPeers`. P3a only decides and
 * shows who the master is; clients following it is P3b, per-destination fan-out from it P4.
 *
 * WO-1029 P1b (incident: B could not reach A, A could reach B; B failed over and A stepped down):
 * - "Heard from": a valid claim pushed here and signed by a server, or any answer to a pull, counts as that server
 *   seen now. The master re-pushes its claim (same epoch, re-signed by itself) to the online servers on every tick, so a
 *   follower that cannot poll the master still hears from it. Failover waits FAILOVER_MS from the latest of: the peer
 *   list's last_seen, heard-from, boot, and the adoption of the claim held (an operator's claim is never overruled by a
 *   follower whose last_seen of the new master is old).
 * - The epoch floor is stored (`clusterMasterFloor`, a separate key so an older build still reads `clusterMaster`).
 * - Boot: a stored claim may be stale. Until the first pull round got an answer (or BOOT_GRACE_MS passed, or nothing is
 *   linked) the server is not `settled`: is_master is false and claim() is null (the shared show and GET see no claim).
 *   A claim adopted at runtime (operator, push, pull, failover) is fresh and settles it.
 * - A claim with an absurd epoch is refused (F2.11). `ts` is NOT checked against our clock: show boxes run without
 *   NTP and can be years apart; the epoch orders claims, not the time.
 * - The returning old master does NOT take mastership back (owner 10.11: it stays where it is until Make master).
 */

const { fingerprint } = require('./cluster-media')

const STORE_KEY = 'clusterMaster'
const FAILOVER_MS = 12000
const FP_RE = /^[0-9a-f]{16}$/
const MAX_SUCCESSION = 17
const FLOOR_KEY = 'clusterMasterFloor' // WO-1029: the epoch floor survives a restart
const BOOT_GRACE_MS = 10000 // WO-1029: ~2 cluster polls (cluster-peers.js POLL_MS 5 s) with nobody answering → settle
/**
 * WO-1029: epochs grow by one per Make master / failover, so legitimate histories never differ by a million; a claim
 * jumping further (or past 1e9) is refused, so a buggy linked server cannot push the epoch to 2^53 where +1 stops
 * counting (F2.11). 1e9 / 1e6 means a thousand such jumps would be needed to exhaust the space.
 */
const MAX_EPOCH = 1e9
const MAX_EPOCH_JUMP = 1e6

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
	// WO-802: the highest epoch seen here, so a claim made after a drop still beats the cluster's (WO-1029: stored)
	let floor = Math.max(claim?.epoch || 0, Number.isInteger(store.get(FLOOR_KEY)) ? store.get(FLOOR_KEY) : 0)
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] ${msg}`)
	const heard = new Map() // WO-1029: fingerprint → when a valid claim signed by it, or a pull answer, came
	let adoptedAt = startedAt // WO-1029: the failover timer of a claim starts no earlier than its adoption
	let settled = false // WO-1029: a stored claim is not acted on before the first pull round (see header)

	function raiseFloor(epoch) {
		if (!(epoch > floor)) return
		floor = epoch
		store.set(FLOOR_KEY, floor)
	}
	const isSettled = () => settled || (settled = members().length === 0) // nothing linked → nothing to wait for

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
		if (c.epoch > MAX_EPOCH || c.epoch > Math.max(floor, claim?.epoch || 0) + MAX_EPOCH_JUMP) return 'epoch out of range' // WO-1029
		return ''
	}
	const REFUSED_400 = new Set(['malformed claim', 'epoch out of range'])

	/** WO-802: a master this server can follow — itself or a server linked here (an unlinked one is no master here). */
	const masterLinked = (c) => c.master === me || members().some((m) => m.key_id === c.master)

	function adopt(c, how) {
		const was = claim
		claim = { epoch: c.epoch, master: c.master, succession: c.succession.map(String), auto: !!c.auto, by: c.by, ts: Number(c.ts), sig: c.sig }
		store.set(STORE_KEY, claim)
		raiseFloor(claim.epoch)
		adoptedAt = now() // WO-1029: F2.2 — a stale last_seen of the new master cannot fail it over at once
		settled = true // fresh, not the stored one
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
		if (err) return { status: REFUSED_400.has(err) ? 400 : 403, body: { error: err } }
		heard.set(fingerprint(signerKey(body)), now()) // WO-1029: the signer is alive and reaches us
		raiseFloor(body.epoch)
		if (!masterLinked(body)) return { status: 409, body: { error: 'its master is not linked here' } }
		if (!beats(body, claim)) {
			const same = claim && claim.epoch === body.epoch && claim.master === body.master
			return { status: same ? 200 : 409, body: same ? { ok: true } : { error: 'older than the claim held here', claim: view() } }
		}
		adopt(body, 'pushed')
		return { status: 200, body: { ok: true } }
	}

	/**
	 * Sign a new claim (epoch + 1), keep it, push it to every linked server. WO-1029 F2.6: returns { claim, push } with
	 * push = [{ id, name, result: 'accepted' | 'refused' | 'unreachable', error? }] per linked server.
	 */
	async function make(masterFp, opts = {}) {
		const order = [masterFp, me, ...members().map((m) => m.key_id)]
		const succession = [...new Set(order)].slice(0, MAX_SUCCESSION)
		const c = { epoch: Math.max(claim?.epoch || 0, floor) + 1, master: masterFp, succession, auto: opts.auto ?? claim?.auto ?? true, by: deps.selfKey, ts: now() }
		c.sig = deps.sign(claimText(c))
		adopt(c, opts.reason || 'operator')
		const push = await pushTo(members(), c)
		for (const p of push) {
			if (p.result === 'refused' || (p.result === 'unreachable' && p.online)) log('warn', `${p.name}: claim not taken (${p.error})`)
			delete p.online
		}
		return { claim, push }
	}

	/** POST a claim to each member: [{ id, name, online, result, error? }]. No HTTP status = never reached it. */
	function pushTo(list, c) {
		return Promise.all(list.map((m) => deps.post(m.saved.host, m.saved.port, '/api/cluster/master', c).then((r) => {
			const base = { id: m.saved.id, name: m.saved.name, online: m.online }
			if (r.ok) return { ...base, result: 'accepted' }
			const error = r.json?.error || r.error || 'HTTP ' + r.status
			return { ...base, result: r.status > 0 ? 'refused' : 'unreachable', error }
		}, (e) => ({ id: m.saved.id, name: m.saved.name, online: m.online, result: 'unreachable', error: String(e?.message || e) }))))
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
		const r = await make(fp, { auto: typeof b.auto === 'boolean' ? b.auto : undefined })
		return { status: 200, body: { ...view(), push: r.push } } // WO-1029: who took it, refused it, or was not reached
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
		if (claim && !masterLinked(claim)) forget('its master is no longer linked here') // a claim kept from before WO-802
		const online = members().filter((m) => m.online)
		let answered = false
		for (const m of online) {
			const r = await deps.fetchJson(m.saved.host, m.saved.port, '/api/cluster/master')
			if (r.ok) heard.set(m.key_id, now()) // WO-1029: it answered us
			// WO-1029: an answer counts for settling unless that server is itself still settling (it shows no claim yet)
			if (r.ok && (r.json?.settled !== false || r.json?.claim)) answered = true
			const c = r.ok ? r.json?.claim : null
			if (!c || valid(c)) continue
			raiseFloor(c.epoch)
			if (beats(c, claim) && masterLinked(c)) adopt(c, `from ${m.saved.name}`)
		}
		if (!settled && (answered || now() - startedAt >= BOOT_GRACE_MS || !members().length)) {
			settled = true
			if (claim) log('info', `settled: master ${nameOf(claim.master)} epoch ${claim.epoch}`)
			deps.onChange?.()
		}
		if (!settled) return
		if (claim?.master === me) return void (await repush(online))
		if (!claim?.auto) return
		const all = members()
		// F2.8: a server listed twice is seen when either entry is
		const entries = all.filter((m) => m.key_id === claim.master)
		if (!entries.length || entries.some((m) => m.online)) return
		const lastSeen = Math.max(...entries.map((m) => m.last_seen || 0), heard.get(claim.master) || 0, startedAt, adoptedAt)
		if (now() - lastSeen < FAILOVER_MS) return
		const seen = new Set([me, ...all.filter((m) => m.online).map((m) => m.key_id)])
		const next = claim.succession.find((fp) => fp !== claim.master && seen.has(fp))
		if (next === me) await make(me, { reason: `failover: ${entries[0].saved.name} unseen ${Math.round((now() - lastSeen) / 1000)} s` })
	}

	/**
	 * WO-1029: the master tells the servers it reaches that it is alive: the held claim, same epoch / master, re-signed
	 * by this server with a fresh ts. A receiver holding it answers 200 (same claim, nothing adopted) and counts this
	 * server as heard from; an older build does the same minus the counting. The held claim is not changed here.
	 */
	async function repush(online) {
		if (!online.length) return
		const c = { ...claim, by: deps.selfKey, ts: now() }
		c.sig = deps.sign(claimText(c))
		await pushTo(online, c)
	}

	/** What clients see (no signature): { epoch, master, master_id, is_master, auto, succession: [{ key_id, id, name }] }. */
	function view() {
		const ms = members()
		const ok = isSettled()
		const who = (fp) => (fp === me ? { key_id: fp, id: 'self', name: 'this server' } : { key_id: fp, id: ms.find((m) => m.key_id === fp)?.saved.id || '', name: nameOf(fp) })
		if (!claim) return { epoch: 0, master: '', master_id: '', is_master: false, auto: true, succession: [], key_id: me, settled: ok }
		// WO-802: the signed succession keeps an unlinked server's fingerprint; it is never picked, and not shown
		// WO-1029: not master before settling (the stored claim may have been beaten while this server was off)
		return { epoch: claim.epoch, master: claim.master, master_id: who(claim.master).id, is_master: ok && claim.master === me, auto: claim.auto,
			succession: claim.succession.map(who).filter((s) => s.id !== ''), key_id: me, settled: ok }
	}

	/** The last linked server was unlinked (a server alone has no master), or the master itself was (WO-802). */
	function forget(why = 'no linked servers left') {
		if (!claim) return
		raiseFloor(claim.epoch)
		claim = null
		store.set(STORE_KEY, null)
		log('info', `${why}: master claim dropped`)
		deps.onChange?.()
	}

	/**
	 * WO-802: a linked server left (cluster-peers.js onRemove). Alone → no master. The master itself left while others
	 * stay → this server follows no one (its shared show stops proposing to a server it cannot reach, its PGM takes are
	 * its own again) until a claim whose master is linked here comes, or its operator makes one.
	 */
	function dropped(saved) {
		if (!claim) return
		if (!deps.cluster.list().length) return forget()
		const fp = saved?.device_key ? fingerprint(saved.device_key) : ''
		if (fp && claim.master === fp) forget(`the master (${saved.name || fp}) was unlinked`)
	}

	// WO-1029: no claim shown before settling — the shared show must not follow (or GET hand out) a stale stored claim
	return { accept, set, tick, view, forget, dropped, claim: () => (isSettled() ? claim : null), me }
}

module.exports = { createMaster, beats, claimText, wellFormed, FAILOVER_MS, STORE_KEY, FLOOR_KEY, BOOT_GRACE_MS, MAX_EPOCH, MAX_EPOCH_JUMP }
