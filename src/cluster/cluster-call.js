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
 */

const crypto = require('crypto')
const { fingerprint } = require('./cluster-media')

const MAX_SKEW_MS = 60000
const NONCE_MS = 120000
const MAX_NONCES = 4096
const NONCE_RE = /^[0-9a-f]{16,64}$/
const ACTION_RE = /^[a-z][a-z0-9_.]{0,63}$/

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

/**
 * @param {{ cluster: { saved: Function, list: Function }, selfKey: string, sign: Function, verify: Function,
 *   post: Function, actions: Record<string, (args: object, from: object) => Promise<{status:number, body:object}>>,
 *   info?: Record<string, Function>, acceptsRemote: () => boolean, masterId: () => string, now?: () => number,
 *   log?: Function }} deps
 */
function createClusterCall(deps) {
	const now = deps.now || Date.now
	const me = fingerprint(deps.selfKey)
	const seen = new Map() // nonce → when it was taken
	const log = (lvl, msg) => deps.log?.(lvl, `[cluster] ${msg}`)
	const fail = (status, error) => ({ status, body: { error } })

	function forget(t) {
		for (const [n, at] of seen) {
			if (t - at <= NONCE_MS && seen.size <= MAX_NONCES) break
			seen.delete(n)
		}
	}

	/** Sender: sign and POST to a linked server → { ok, status, json, error? } (never throws). `quiet`: the caller logs. */
	async function call(peerId, action, args = {}, { quiet = false } = {}) {
		const peer = deps.cluster.saved(String(peerId || ''))
		if (!peer) return { ok: false, status: 404, json: { error: 'no such server' } }
		if (!peer.device_key)
			return {
				ok: false,
				status: 400,
				json: { error: `${peer.name}: unlink and link it again (its identity was not recorded)` },
			}
		const req = {
			action: String(action),
			args: args && typeof args === 'object' ? args : {},
			from: me,
			to: fingerprint(peer.device_key),
			ts: now(),
			nonce: crypto.randomBytes(16).toString('hex'),
		}
		const r = await deps.post(peer.host, peer.port, '/api/cluster/call', { ...req, sig: deps.sign(callText(req)) })
		if (!r.ok && !quiet)
			log('warn', `${peer.name}: ${action} refused (${r.json?.error || r.error || 'HTTP ' + r.status})`)
		return r
	}

	/** Sender: the same, to the cluster's master (when another server is master). */
	async function callMaster(action, args) {
		const id = deps.masterId()
		if (!id) return { ok: false, status: 409, json: { error: 'no other server is master' } }
		return call(id, action, args)
	}

	/** Receiver: POST /api/cluster/call → { status, body }. */
	async function handle(body) {
		const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
		if (!ACTION_RE.test(String(b.action || '')) || !NONCE_RE.test(String(b.nonce || '')) || typeof b.sig !== 'string')
			return fail(400, 'malformed call')
		if (b.args != null && (typeof b.args !== 'object' || Array.isArray(b.args)))
			return fail(400, 'args must be an object')
		const from = String(b.from || '')
		const peer = from ? deps.cluster.list().find((p) => p.device_key && fingerprint(p.device_key) === from) : null
		if (!peer) return fail(403, 'not linked here: link this server on the receiving server too')
		if (String(b.to || '') !== me || !me) return fail(400, 'call is for another server')
		const t = now()
		if (!(Math.abs(t - Number(b.ts)) <= MAX_SKEW_MS)) return fail(400, 'stale call (check both clocks)')
		forget(t)
		if (seen.has(b.nonce)) return fail(409, 'replayed call')
		if (!deps.verify(peer.device_key, callText(b), b.sig)) return fail(403, 'bad signature')
		seen.set(b.nonce, t) // only signed calls take a slot: an outsider cannot flush the window
		const info = deps.info && Object.prototype.hasOwnProperty.call(deps.info, b.action) ? deps.info[b.action] : null
		if (info) return run(info, b, peer)
		if (!deps.acceptsRemote()) return fail(403, 'this server refuses remote actions')
		const fn = Object.prototype.hasOwnProperty.call(deps.actions, b.action) ? deps.actions[b.action] : null
		if (!fn) return fail(400, `unknown action "${b.action}"`)
		log('info', `remote ${b.action} from ${peer.name}`)
		return run(fn, b, peer)
	}

	async function run(fn, b, peer) {
		try {
			return await fn(b.args || {}, peer)
		} catch (e) {
			return fail(500, String(e?.message || e))
		}
	}

	return { call, callMaster, handle, me }
}

module.exports = { createClusterCall, callText, stableJson, MAX_SKEW_MS, NONCE_MS }
