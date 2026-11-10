'use strict'

/**
 * WO-712 R2 — one signed "call another linked server" primitive (owner D3: a remote action counts as the receiver's
 * own operator pressing it, the last press wins; the receiver's `accept_remote` duty locks it out).
 *
 * Wire: POST /api/cluster/call { action, args, from, to, ts, nonce, sig }
 *   from / to = device-key fingerprints (cluster-media.js `fingerprint`) of the sender / the receiver,
 *   ts = sender ms clock, nonce = 32 hex chars, sig = ed25519 (device-identity.js) over callText(body) (base64).
 * The receiver takes it only when: the sender's key is in ITS peer list (trust = links, as for the master claim);
 * `to` is its own fingerprint; |now - ts| ≤ 60 s; the nonce was not seen in the last 120 s; the signature verifies;
 * its `accept_remote` duty is on. Then the action runs through the allow-list (`actions`, cluster-call-actions.js).
 * WO-712 R3: `info` is a second list for information a linked server hands over (cluster-exchange.js): signed and
 * checked the same way, but not locked out by `accept_remote` (it presses nothing) and not logged per call (≤ 5 Hz).
 * The signature IS the auth: /api/cluster/call is the one cluster path open while `enforceAuth` is on (auth.js).
 *
 * WO-1029 plan 07 C4 — call v2 (`v: 2`, capability CAP = 'call-signed'): never compares the sender's ts with this
 * clock (show LANs have no NTP). Wire adds { v: 2, opId, seq? }; signed text callText2 (tag 'highascg-call-2').
 *   replay: call-replay-guard.js (ts above the sender's own highest − 10 s, nonces, a floor kept across restarts);
 *     refused → 409 { code: 'CALL_STALE' | 'CALL_REPLAY', last } after the signature: the sender resends once above it.
 *   opId: idempotency key — a resend with the same opId gets the first answer, the action runs once (OPS_PER_SENDER
 *     per sender, OP_TTL_MS on this server's monotonic clock). seq: per-destination press order for dest.* (C5).
 *   The action handler gets (args, peer, meta = { v, opId, seq, ts }).
 * Old builds: a sender uses v2 only when the peer advertises CAP (deps.peerCaps) or answered a v1 call "stale" with
 * `caps: [CAP]` (learned, then resent once as v2); otherwise v1 exactly as before. A v1 call here keeps the v1 rules.
 */

const crypto = require('crypto')
const { fingerprint } = require('./cluster-media')
const { createReplayGuard, createStamper, sharedFloorStore } = require('./call-replay-guard')

const MAX_SKEW_MS = 60000
const NONCE_MS = 120000
const MAX_NONCES = 4096
const NONCE_RE = /^[0-9a-f]{16,64}$/
const ACTION_RE = /^[a-z][a-z0-9_.]{0,63}$/
const OPID_RE = /^[0-9A-Za-z_-]{8,64}$/
const CAP = 'call-signed'
const OPS_PER_SENDER = 64
const OP_TTL_MS = 600000
const LEARN_MS = 60000 // a mode learned from a peer's answer outranks its advertised caps this long

/** JSON with object keys sorted: the same text on both ends whatever order the args were built in. */
function stableJson(v) {
	if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
	if (v && typeof v === 'object')
		return `{${Object.keys(v)
			.sort()
			.filter((k) => v[k] !== undefined)
			.map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
			.join(',')}}`
	return JSON.stringify(v === undefined ? null : v)
}

/** The signed text: a fixed tag, then the fields in a fixed order, args as stable JSON. */
const callText = (b) =>
	JSON.stringify([
		'highascg-call-1',
		String(b.action || ''),
		String(b.from || ''),
		String(b.to || ''),
		Number(b.ts) || 0,
		String(b.nonce || ''),
		stableJson(b.args ?? {}),
	])

/** v2 signed text: opId and seq are signed too (a resend cannot be re-pointed at another destination or press). */
const callText2 = (b) =>
	JSON.stringify([
		'highascg-call-2',
		String(b.action || ''),
		String(b.from || ''),
		String(b.to || ''),
		Number(b.ts) || 0,
		String(b.nonce || ''),
		String(b.opId || ''),
		b.seq == null ? null : Number(b.seq),
		stableJson(b.args ?? {}),
	])

const isSeq = (v) => v == null || (Number.isSafeInteger(v) && v >= 0)
const newNonce = () => crypto.randomBytes(16).toString('hex')

/**
 * @param {{ cluster: { saved: Function, list: Function }, selfKey: string, sign: Function, verify: Function,
 *   post: Function, actions: Record<string, (args: object, from: object) => Promise<{status:number, body:object}>>,
 *   info?: Record<string, Function>, acceptsRemote: () => boolean, masterId: () => string, now?: () => number,
 *   log?: Function, peerCaps?: (peerId: string) => string[], floorStore?: object, mono?: () => number }} deps
 *   peerCaps: the peer's advertised caps (cluster-caps.js; default [] = v1); floorStore: call-replay-guard.js store
 *   (default config/cluster-call-floor.json); mono: this server's monotonic ms (opId cache TTL)
 */
function createClusterCall(deps) {
	const now = deps.now || Date.now
	const me = fingerprint(deps.selfKey)
	const seen = new Map() // nonce → when it was taken
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] ${msg}`)
	const fail = (status, error) => ({ status, body: { error } })
	const mono = deps.mono || (() => performance.now())
	const guard = createReplayGuard({ store: deps.floorStore || sharedFloorStore(deps.log), ns: 'call' })
	const stamp = createStamper(now)
	const learned = new Map() // receiver fp → { v, at } (from its answers)
	const ops = new Map() // sender fp → Map<opId, { key, at, answer: Promise }>
	const seqs = new Map() // destId → last seq sent

	function forget(t) {
		for (const [n, at] of seen) {
			if (t - at <= NONCE_MS && seen.size <= MAX_NONCES) break
			seen.delete(n)
		}
	}

	/** Which wire a receiver gets: what it answered lately, else its advertised caps, else v1 (older build). */
	function modeFor(peerId, to) {
		const l = learned.get(to)
		if (l && mono() - l.at < LEARN_MS) return l.v
		let caps = []
		try {
			caps = deps.peerCaps?.(peerId) || []
		} catch {
			/* caps unknown: v1 */
		}
		return Array.isArray(caps) && caps.includes(CAP) ? 2 : 1
	}
	const learn = (to, v) => learned.set(to, { v, at: mono() })

	/** A strictly rising press order for one destination (dest.* `seq`, C5); sender clock only, never compared here. */
	function nextSeq(destId) {
		const v = Math.max(now(), (seqs.get(String(destId)) || 0) + 1)
		seqs.set(String(destId), v)
		return v
	}

	/** Sender: sign and POST to a linked server → { ok, status, json, error?, opId? } (never throws). `quiet`: the caller
	 * logs; `timeoutMs`: longer than the post default for a big body (WO-746: a whole show); `opId`: pass the first
	 * answer's opId to resend after a timeout without running twice (v2); `seq`: a destination's press order (v2). */
	async function call(peerId, action, args = {}, { quiet = false, timeoutMs, opId, seq } = {}) {
		const peer = deps.cluster.saved(String(peerId || ''))
		if (!peer) return { ok: false, status: 404, json: { error: 'no such server' } }
		if (!peer.device_key)
			return {
				ok: false,
				status: 400,
				json: { error: `${peer.name}: unlink and link it again (its identity was not recorded)` },
			}
		const to = fingerprint(peer.device_key)
		const base = { action: String(action), args: args && typeof args === 'object' ? args : {}, from: me, to }
		const op = OPID_RE.test(String(opId || '')) ? String(opId) : newNonce()
		const post = (b) => deps.post(peer.host, peer.port, '/api/cluster/call', b, timeoutMs)
		const v1 = () => {
			const req = { ...base, ts: now(), nonce: newNonce() }
			return post({ ...req, sig: deps.sign(callText(req)) })
		}
		const v2 = () => {
			const req = { ...base, ts: stamp.next(to), nonce: newNonce(), v: 2, opId: op, ...(isSeq(seq) && seq != null ? { seq } : {}) }
			return post({ ...req, sig: deps.sign(callText2(req)) })
		}
		let mode = modeFor(peerId, to)
		let r = await (mode === 2 ? v2() : v1())
		const err = String(r.json?.error || '')
		if (mode === 1 && r.status === 400 && /^stale call/.test(err) && Array.isArray(r.json?.caps) && r.json.caps.includes(CAP)) {
			learn(to, 2) // a newer receiver and our clocks differ: v2 never compares them
			mode = 2
			r = await v2()
		} else if (mode === 2 && r.json?.code === 'CALL_STALE' && Number.isSafeInteger(r.json?.last)) {
			stamp.adopt(to, r.json.last) // we restarted, our clock went back, or it restarted: count on above its floor
			r = await v2()
		} else if (mode === 2 && ((r.status === 403 && err === 'bad signature') || (r.status === 400 && /check both clocks/.test(err)))) {
			learn(to, 1) // an older build (rolled back): it verifies the v1 text and never ran the action
			mode = 1
			r = await v1()
		}
		if (!r.ok && !quiet)
			log('warn', `${peer.name}: ${action} refused (${r.json?.error || r.error || 'HTTP ' + r.status})`)
		return mode === 2 ? { ...r, opId: op } : r
	}

	/** Sender: the same, to the cluster's master (when another server is master). */
	async function callMaster(action, args, opts) {
		const id = deps.masterId()
		if (!id) return { ok: false, status: 409, json: { error: 'no other server is master' } }
		return call(id, action, args, opts)
	}

	/** Receiver: POST /api/cluster/call → { status, body }. */
	async function handle(body) {
		const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
		if (!ACTION_RE.test(String(b.action || '')) || !NONCE_RE.test(String(b.nonce || '')) || typeof b.sig !== 'string')
			return fail(400, 'malformed call')
		if (b.args != null && (typeof b.args !== 'object' || Array.isArray(b.args)))
			return fail(400, 'args must be an object')
		const v2 = b.v === 2
		if (v2 && (!Number.isSafeInteger(b.ts) || !OPID_RE.test(String(b.opId || '')) || !isSeq(b.seq)))
			return fail(400, 'malformed call')
		const from = String(b.from || '')
		const peer = from ? deps.cluster.list().find((p) => p.device_key && fingerprint(p.device_key) === from) : null
		if (!peer) return fail(403, 'not linked here: link this server on the receiving server too')
		if (String(b.to || '') !== me || !me) return fail(400, 'call is for another server')
		if (v2) {
			if (!deps.verify(peer.device_key, callText2(b), b.sig)) return fail(403, 'bad signature')
			// after the signature: only that server learns its floor
			const no = guard.check(from, b.ts, b.nonce)
			if (no) return { status: 409, body: no }
			guard.take(from, b.ts, b.nonce)
		} else {
			const t = now()
			if (!(Math.abs(t - Number(b.ts)) <= MAX_SKEW_MS))
				return { status: 400, body: { error: 'stale call (check both clocks)', caps: [CAP] } } // a newer sender resends as v2
			forget(t)
			if (seen.has(b.nonce)) return fail(409, 'replayed call')
			if (!deps.verify(peer.device_key, callText(b), b.sig)) return fail(403, 'bad signature')
			seen.set(b.nonce, t) // only signed calls take a slot: an outsider cannot flush the window
		}
		const meta = v2 ? { v: 2, opId: b.opId, seq: b.seq ?? null, ts: b.ts } : { v: 1 }
		const info = deps.info && Object.prototype.hasOwnProperty.call(deps.info, b.action) ? deps.info[b.action] : null
		if (info) return run(info, b, peer, meta)
		if (!deps.acceptsRemote()) return fail(403, 'this server refuses remote actions')
		const fn = Object.prototype.hasOwnProperty.call(deps.actions, b.action) ? deps.actions[b.action] : null
		if (!fn) return fail(400, `unknown action "${b.action}"`)
		if (!v2) {
			log('info', `remote ${b.action} from ${peer.name}`)
			return run(fn, b, peer, meta)
		}
		return once(from, b, () => {
			log('info', `remote ${b.action} from ${peer.name}`)
			return run(fn, b, peer, meta)
		})
	}

	/** opId → the first answer (also while it still runs); the same opId for another action / args is refused. */
	function once(from, b, go) {
		const t = mono()
		let m = ops.get(from)
		if (!m) ops.set(from, (m = new Map()))
		for (const [k, e] of m) if (t - e.at > OP_TTL_MS) m.delete(k)
		const key = `${b.action}\n${stableJson(b.args ?? {})}`
		const hit = m.get(b.opId)
		if (hit) {
			if (hit.key !== key) return fail(409, 'opId already used for another call')
			log('info', `remote ${b.action}: repeat of ${b.opId}, first answer returned`)
			return hit.answer
		}
		const answer = go()
		m.set(b.opId, { key, at: t, answer })
		while (m.size > OPS_PER_SENDER) m.delete(m.keys().next().value)
		return answer
	}

	async function run(fn, b, peer, meta) {
		try {
			return await fn(b.args || {}, peer, meta)
		} catch (e) {
			return fail(500, String(e?.message || e))
		}
	}

	return { call, callMaster, handle, nextSeq, me }
}

module.exports = { createClusterCall, callText, callText2, stableJson, MAX_SKEW_MS, NONCE_MS, CAP, OPS_PER_SENDER, OP_TTL_MS }
