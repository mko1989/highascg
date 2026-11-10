'use strict'

/**
 * WO-670 P2b — "Send media": push this server's project media to a linked server with the existing hot-backup rsync
 * (sync-project-media-rsync.js: rsync over SSH as casparcg, the replication key, and on the receiver the forced command
 * tools/runtime/highascg-replication-ssh.sh = `rsync --server` into media/ and template/ only). Owner, WO-670 answer 3:
 * media moves only on this button.
 *
 * Trust = BOTH servers linked each other. Before the push, the sender POSTs its SSH public key to the receiver's
 * /api/cluster/ssh-key, signed with its device key (config/device-identity.json, ed25519). The receiver installs the
 * key (forced command, `from=` the caller's address) only when the signature verifies against the device key it
 * recorded when ITS operator linked the sender, the request names the receiver's own key, and the timestamp is fresh.
 * An unlinked or unknown caller gets 403. The hot-backup pairing is not used.
 * WO-1029 plan 07 C4 — "fresh" no longer compares the sender's ts with this clock (show LANs have no NTP): v2 requests
 * ({ …, v: 2, nonce }, signed text canonical2) pass call-replay-guard.js (the sender's own highest ts − 10 s, nonces, a
 * floor kept across restarts; refused → 409 { code, last } and the sender resends once above it). A sender uses v2
 * when the receiver advertises 'call-signed' (deps.peerCaps) or answered a v1 request "stale" with that cap; a v1
 * request here keeps the 60 s rule (an older sender).
 */

const crypto = require('crypto')
const os = require('os')
const { createReplayGuard, createStamper, sharedFloorStore } = require('./call-replay-guard')

const MAX_SKEW_MS = 60000
const KEY_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]{40,800}( [^\s]{0,100})?$/

/** Short id of a device public key (what a request names its receiver by). */
const fingerprint = (pem) => (pem ? crypto.createHash('sha256').update(String(pem).trim()).digest('hex').slice(0, 16) : '')

/** The signed text: field order fixed, nothing else signed. */
const canonical = (b) => JSON.stringify([String(b.from_key || ''), String(b.to || ''), String(b.ssh_public_key || ''), Number(b.ts) || 0])
/** v2: tagged, with the nonce. */
const canonical2 = (b) =>
	JSON.stringify(['highascg-ssh-key-2', String(b.from_key || ''), String(b.to || ''), String(b.ssh_public_key || ''), Number(b.ts) || 0, String(b.nonce || '')])
const CAP = 'call-signed' // the same capability as the call transport (cluster-call.js)
const NONCE_RE = /^[0-9a-f]{16,64}$/

let _guard = null
let _stamp = null
const sharedGuard = (log) => _guard || (_guard = createReplayGuard({ store: sharedFloorStore(log), ns: 'ssh' }))
const sharedStamp = () => _stamp || (_stamp = createStamper())

/**
 * Receiver side: POST /api/cluster/ssh-key { from_key, to, ssh_public_key, ts, sig }.
 * @param {{ cluster: object, selfKey: string, verify: Function, install: Function, now?: () => number,
 *   guard?: object, log?: Function }} deps  guard: call-replay-guard.js (default: the shared one, namespace 'ssh')
 */
function acceptSshKey(body, remoteAddress, deps) {
	const now = deps.now || Date.now
	const b = body && typeof body === 'object' ? body : {}
	const v2 = b.v === 2
	if (v2 && (!Number.isSafeInteger(b.ts) || !NONCE_RE.test(String(b.nonce || '')))) return { status: 400, body: { error: 'malformed request' } }
	const peer = deps.cluster.byDeviceKey(String(b.from_key || ''))
	if (!peer) return { status: 403, body: { error: 'not linked here: link this server on the receiving server too' } }
	if (String(b.to || '') !== fingerprint(deps.selfKey)) return { status: 400, body: { error: 'request is for another server' } }
	if (!v2 && !(Math.abs(now() - Number(b.ts)) <= MAX_SKEW_MS))
		return { status: 400, body: { error: 'stale request (check both clocks)', caps: [CAP] } } // a newer sender resends as v2
	const key = String(b.ssh_public_key || '').trim()
	if (!KEY_RE.test(key)) return { status: 400, body: { error: 'invalid ssh public key' } }
	if (!deps.verify(peer.device_key, (v2 ? canonical2 : canonical)(b), String(b.sig || ''))) return { status: 403, body: { error: 'bad signature' } }
	if (v2) {
		const guard = deps.guard || sharedGuard(deps.log)
		const fp = fingerprint(peer.device_key)
		const no = guard.check(fp, b.ts, b.nonce)
		if (no) return { status: 409, body: no } // after the signature: only that server learns its floor
		guard.take(fp, b.ts, b.nonce)
	}
	const from = String(remoteAddress || '').replace(/^::ffff:/, '')
	const r = deps.install(key, { fromHost: from })
	if (!r?.ok) return { status: 500, body: { error: r?.error || 'could not install the key' } }
	return { status: 200, body: { ok: true, user: os.userInfo().username, peer: peer.id } }
}

/**
 * Sender side: POST /api/cluster/peers/:id/send-media → 202, then progress on the peer's `media_send` in the cluster
 * snapshot (WS `cluster:peers`).
 * @param {{ cluster: object, selfKey: string, sign: Function, sshKey: () => string, post: Function,
 *   project: () => Promise<object>, plan: Function, rsync: Function, onSent?: (id: string) => void, log?: Function,
 *   now?: () => number, peerCaps?: (id: string) => string[], stamp?: object }} deps  onSent: the files are there
 *   (WO-772: the fan-out replays the show to it); peerCaps: cluster-caps.js (default [] = v1)
 */
async function sendMedia(id, deps) {
	const now = deps.now || Date.now
	const peer = deps.cluster.saved(id)
	if (!peer) return { status: 404, body: { error: 'no such server' } }
	if (deps.cluster.mediaSend(id)?.state === 'sending') return { status: 409, body: { error: 'already sending' } }
	if (!peer.device_key) return { status: 400, body: { error: `${peer.name}: unlink and link it again (its identity was not recorded; update it if it is older)` } }
	let sshKey
	try {
		sshKey = deps.sshKey()
	} catch (e) {
		return { status: 500, body: { error: `no SSH key: ${e.message}` } }
	}
	const r = await postSshKey(id, peer, sshKey, deps)
	if (r.status === 403) return { status: 409, body: { error: `${peer.name} has not linked this server: on ${peer.name}, Devices → Servers → + → this server, then Send again.`, detail: r.json?.error || '' } }
	if (!r.ok) return { status: 502, body: { error: `${peer.name}: ${r.json?.error || r.error || 'HTTP ' + r.status}` } }
	const project = await deps.project()
	const plan = deps.plan(project)
	if (!plan.relPaths.length) return { status: 400, body: { error: 'this project has no media to send' } }
	deps.cluster.setMediaSend(id, { state: 'sending', percent: 0, files: plan.relPaths.length, at: now() })
	;(async () => {
		const out = await deps.rsync('push', peer.host, plan.relPaths, {
			log: deps.log,
			onProgress: (p) => deps.cluster.setMediaSend(id, { state: 'sending', percent: p.percent, files: plan.relPaths.length, at: now() }),
		})
		deps.cluster.setMediaSend(id, out.ok
			? { state: 'done', percent: 100, files: out.files, at: now() }
			: { state: 'failed', error: String(out.hint || out.error || 'rsync failed').slice(0, 400), at: now() })
		if (out.ok) deps.onSent?.(id) // WO-772: the master plays its show there again, now with the files
		deps.cluster.poll().catch(() => {})
	})().catch((e) => deps.cluster.setMediaSend(id, { state: 'failed', error: e.message, at: now() }))
	return { status: 202, body: { ok: true, paths: plan.relPaths.length, slug: plan.slug || '' } }
}

/** WO-1029 C4: the signed key, v2 when the receiver can take it (advertised, or said so in a v1 "stale" answer). */
async function postSshKey(id, peer, sshKey, deps) {
	const now = deps.now || Date.now
	const to = fingerprint(peer.device_key)
	const stamp = deps.stamp || sharedStamp()
	const send = (req, text) => deps.post(peer.host, peer.port, '/api/cluster/ssh-key', { ...req, sig: deps.sign(text(req)) })
	const base = { from_key: deps.selfKey, to, ssh_public_key: sshKey }
	const v2 = () => send({ ...base, ts: stamp.next(to), nonce: crypto.randomBytes(16).toString('hex'), v: 2 }, canonical2)
	let caps = []
	try {
		caps = deps.peerCaps?.(id) || []
	} catch {
		/* unknown: v1 */
	}
	if (!caps.includes(CAP)) {
		const r = await send({ ...base, ts: now() }, canonical)
		if (!(r.status === 400 && Array.isArray(r.json?.caps) && r.json.caps.includes(CAP))) return r
	}
	const r = await v2()
	if (r.status === 409 && r.json?.code === 'CALL_STALE' && Number.isSafeInteger(r.json?.last)) {
		stamp.adopt(to, r.json.last)
		return v2()
	}
	if ((r.status === 403 && r.json?.error === 'bad signature') || (r.status === 400 && /check both clocks/.test(String(r.json?.error || ''))))
		return send({ ...base, ts: now() }, canonical) // an older build after all (rolled back): v1 as before
	return r
}

module.exports = { acceptSshKey, sendMedia, postSshKey, fingerprint, canonical, canonical2, MAX_SKEW_MS } // WO-1029 C10: postSshKey for the Spread
