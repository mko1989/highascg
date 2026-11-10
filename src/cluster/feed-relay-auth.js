'use strict'

/**
 * WO-1029 plan 07 C9 — who may subscribe to this server's picture feed as a RELAY (feed-relay.js on a linked server).
 *
 * The relay opens `GET /api/video-feed?…&relay=<token>` (a WS upgrade). The token is base64url JSON
 *   { v: 1, from, to, ts, nonce, sig }
 * from / to = device-key fingerprints (cluster-media.js `fingerprint`) of the relay / of this server, ts = the RELAY's
 * own ms clock made strictly rising per receiver (call-replay-guard.js createStamper), nonce = 32 hex, sig = ed25519
 * (device-identity.js) over feedTokenText(). This server takes it only when: the sender's key is in ITS peer list
 * (trust = links, as for /api/cluster/call), `to` is its own fingerprint, the signature verifies, and the replay guard
 * (namespace 'feed', its own floor keys) has not seen the ts / nonce — never a comparison with this clock (show LANs
 * have no NTP). A refused stale / replayed token answers 409 with header `x-feed-last` (only after the signature
 * verified): the relay counts on above it and retries once. The token is the auth: the feed's usual Bearer / cookie
 * check (auth.js checkWebSocketAuth) is skipped for an upgrade that carries one, valid or not (a bad one is refused).
 */

const crypto = require('crypto')
const { fingerprint } = require('./cluster-media')
const { createReplayGuard, sharedFloorStore } = require('./call-replay-guard')

const NONCE_RE = /^[0-9a-f]{16,64}$/
const FP_RE = /^[0-9a-f]{16}$/
const MAX_TOKEN = 2048

/** The signed text: a fixed tag, then the fields in a fixed order. */
const feedTokenText = (t) => JSON.stringify(['highascg-feed-1', String(t.from || ''), String(t.to || ''), Number(t.ts) || 0, String(t.nonce || '')])

/** Sender: a token for receiver fingerprint `to`. */
function makeFeedToken({ from, to, ts, sign, nonce = crypto.randomBytes(16).toString('hex') }) {
	const t = { v: 1, from, to, ts, nonce }
	return Buffer.from(JSON.stringify({ ...t, sig: sign(feedTokenText(t)) })).toString('base64url')
}

function parseFeedToken(s) {
	const str = String(s || '')
	if (!str || str.length > MAX_TOKEN) return null
	try {
		const t = JSON.parse(Buffer.from(str, 'base64url').toString('utf8'))
		if (!t || t.v !== 1 || !FP_RE.test(String(t.from)) || !FP_RE.test(String(t.to))) return null
		if (!Number.isSafeInteger(t.ts) || !NONCE_RE.test(String(t.nonce)) || typeof t.sig !== 'string') return null
		return t
	} catch {
		return null
	}
}

/**
 * Receiver gate.
 * @param {{ peers: () => Array<{ id: string, name?: string, device_key?: string }>, selfKey: () => string,
 *   verify: (pem: string, text: string, sig: string) => boolean, floorStore?: { get: Function, set: Function } }} deps
 */
function createFeedGate(deps) {
	const floors = deps.floorStore || sharedFloorStore()
	const guard = createReplayGuard({ store: { get: (k) => floors.get(`feed-${k}`), set: (k, v) => floors.set(`feed-${k}`, v) }, ns: 'feed' })
	/** → { ok: true, peer } | { ok: false, status, error, last? } */
	function check(tokenStr) {
		const t = parseFeedToken(tokenStr)
		if (!t) return { ok: false, status: 400, error: 'malformed relay token' }
		const me = fingerprint(deps.selfKey())
		if (!me || t.to !== me) return { ok: false, status: 400, error: 'token is for another server' }
		const peer = (deps.peers() || []).find((p) => p?.device_key && fingerprint(p.device_key) === t.from)
		if (!peer) return { ok: false, status: 403, error: 'not linked here' }
		if (!deps.verify(peer.device_key, feedTokenText(t), t.sig)) return { ok: false, status: 403, error: 'bad signature' }
		const no = guard.check(t.from, t.ts, t.nonce)
		if (no) return { ok: false, status: 409, error: no.error, last: no.last }
		guard.take(t.from, t.ts, t.nonce)
		return { ok: true, peer, fp: t.from }
	}
	return { check }
}

module.exports = { makeFeedToken, parseFeedToken, createFeedGate }
