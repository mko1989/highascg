'use strict'

/**
 * WO-1106 C29 — an HTTP request from one linked server's node to another, signed with the sender's device key. The
 * cluster routes that change membership, mastership or push media answer only an operator who passed API auth, one on
 * the box itself, or such a signed request (cluster-route-gate.js). Two senders:
 *   - the Devices "Edit" relay (cluster-relay.js): an operator allowed HERE edits a linked server through this node; the
 *     relay signs the request so that server treats it as that operator's (WO-802: clients never talk to another box);
 *   - the unlink / decline "there too" (cluster-peers.js `?link_back=0`): signed by the server that leaves.
 * A request without these headers is an unsigned request, exactly as before (an older sender, any other client).
 *
 * Headers: x-highascg-from / -to (device-key fingerprints), -ts, -nonce, -sig (ed25519, base64) over
 *   ['highascg-request-1', METHOD, path as sent (with its query), from, to, ts, nonce, sha256(body)].
 * Replay: call-replay-guard.js, namespace 'request' — the sender's own rising stamp and nonces, a floor kept across
 * restarts, never this server's clock (project rule: no clock windows in signed messages). A stamp at or below the
 * floor → 409 { code: 'REQUEST_STALE', last } after the signature verified; the sender resends once above it.
 */

const crypto = require('crypto')
const { fingerprint } = require('./cluster-media')
const { createReplayGuard, createStamper, sharedFloorStore } = require('./call-replay-guard')

const H = { from: 'x-highascg-from', to: 'x-highascg-to', ts: 'x-highascg-ts', nonce: 'x-highascg-nonce', sig: 'x-highascg-sig' }
const NONCE_RE = /^[0-9a-f]{16,64}$/
const FP_RE = /^[0-9a-f]{16}$/
const STALE = 'REQUEST_STALE'

const bodyHash = (body) => crypto.createHash('sha256').update(body == null ? '' : Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')).digest('hex')

/** The signed text. */
const requestText = (r) =>
	JSON.stringify(['highascg-request-1', String(r.method || '').toUpperCase(), String(r.path || ''), String(r.from || ''), String(r.to || ''), Number(r.ts) || 0, String(r.nonce || ''), bodyHash(r.body)])

let _stamper = null
const sharedStamper = () => _stamper || (_stamper = createStamper())

/**
 * Sender: the headers for one request.
 * @param {{ method: string, path: string, body?: string|Buffer|null, toKey: string, selfKey: string, sign: Function,
 *   stamper?: { next: Function } }} o
 */
function signHeaders({ method, path, body, toKey, selfKey, sign, stamper = sharedStamper() }) {
	const to = fingerprint(toKey)
	const r = { method, path, body, from: fingerprint(selfKey), to, ts: stamper.next(`request:${to}`), nonce: crypto.randomBytes(16).toString('hex') }
	return { [H.from]: r.from, [H.to]: r.to, [H.ts]: String(r.ts), [H.nonce]: r.nonce, [H.sig]: sign(requestText(r)) }
}

/**
 * Sender: send(headers) → its answer; a REQUEST_STALE refusal (the receiver restarted with a floor above our stamp, or our
 * clock went back) is resent once above the floor it named.
 * @param {(headers: object) => Promise<{ status: number, json?: object, body?: Buffer|string }>} send
 */
async function sendSigned(send, o) {
	const stamper = o.stamper || sharedStamper()
	let r = await send(signHeaders({ ...o, stamper }))
	const j = r?.json || parseMaybe(r?.body)
	if (r?.status === 409 && j?.code === STALE && Number.isSafeInteger(j.last)) {
		stamper.adopt(`request:${fingerprint(o.toKey)}`, j.last)
		r = await send(signHeaders({ ...o, stamper }))
	}
	return r
}

function parseMaybe(b) {
	if (b == null) return null
	try {
		return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b))
	} catch {
		return null
	}
}

/** Does this request carry the signed-request headers at all? */
const isSigned = (req) => !!req?.headers?.[H.sig]

/**
 * Receiver.
 * @param {{ selfKey: () => string, verify: Function, floorStore?: object }} deps
 * → verify(req, body, keyOf) → { ok: true, fp } | { ok: false, status, body }   keyOf(fp) → the PEM trusted for it, or null
 */
function createRequestVerifier(deps) {
	const guard = createReplayGuard({ store: deps.floorStore || sharedFloorStore(), ns: 'request' })
	const no = (status, error, extra = {}) => ({ ok: false, status, body: { ok: false, error, ...extra } })
	return function verifyRequest(req, body, keyOf) {
		const h = req?.headers || {}
		const r = { method: req?.method, path: req?.url, body, from: String(h[H.from] || ''), to: String(h[H.to] || ''), ts: Number(h[H.ts]), nonce: String(h[H.nonce] || '') }
		const sig = String(h[H.sig] || '')
		if (!sig || !FP_RE.test(r.from) || !NONCE_RE.test(r.nonce) || !Number.isSafeInteger(r.ts)) return no(400, 'malformed signed request')
		if (r.to !== fingerprint(deps.selfKey())) return no(400, 'signed request is for another server')
		const key = keyOf(r.from)
		if (!key || fingerprint(key) !== r.from) return no(403, 'not linked here: link this server on the receiving server too')
		if (!deps.verify(key, requestText(r), sig)) return no(403, 'bad signature')
		const stale = guard.check(r.from, r.ts, r.nonce) // after the signature: only that server learns its floor
		if (stale) return no(409, stale.error, { code: stale.code === 'CALL_STALE' ? STALE : 'REQUEST_REPLAY', last: stale.last })
		guard.take(r.from, r.ts, r.nonce)
		return { ok: true, fp: r.from }
	}
}

module.exports = { H, STALE, signHeaders, sendSigned, isSigned, createRequestVerifier }
