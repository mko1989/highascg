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
 */

const crypto = require('crypto')
const os = require('os')

const MAX_SKEW_MS = 60000
const KEY_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]{40,800}( [^\s]{0,100})?$/

/** Short id of a device public key (what a request names its receiver by). */
const fingerprint = (pem) => (pem ? crypto.createHash('sha256').update(String(pem).trim()).digest('hex').slice(0, 16) : '')

/** The signed text: field order fixed, nothing else signed. */
const canonical = (b) => JSON.stringify([String(b.from_key || ''), String(b.to || ''), String(b.ssh_public_key || ''), Number(b.ts) || 0])

/**
 * Receiver side: POST /api/cluster/ssh-key { from_key, to, ssh_public_key, ts, sig }.
 * @param {{ cluster: object, selfKey: string, verify: Function, install: Function, now?: () => number }} deps
 */
function acceptSshKey(body, remoteAddress, deps) {
	const now = deps.now || Date.now
	const b = body && typeof body === 'object' ? body : {}
	const peer = deps.cluster.byDeviceKey(String(b.from_key || ''))
	if (!peer) return { status: 403, body: { error: 'not linked here: link this server on the receiving server too' } }
	if (String(b.to || '') !== fingerprint(deps.selfKey)) return { status: 400, body: { error: 'request is for another server' } }
	if (!(Math.abs(now() - Number(b.ts)) <= MAX_SKEW_MS)) return { status: 400, body: { error: 'stale request (check both clocks)' } }
	const key = String(b.ssh_public_key || '').trim()
	if (!KEY_RE.test(key)) return { status: 400, body: { error: 'invalid ssh public key' } }
	if (!deps.verify(peer.device_key, canonical(b), String(b.sig || ''))) return { status: 403, body: { error: 'bad signature' } }
	const from = String(remoteAddress || '').replace(/^::ffff:/, '')
	const r = deps.install(key, { fromHost: from })
	if (!r?.ok) return { status: 500, body: { error: r?.error || 'could not install the key' } }
	return { status: 200, body: { ok: true, user: os.userInfo().username, peer: peer.id } }
}

/**
 * Sender side: POST /api/cluster/peers/:id/send-media → 202, then progress on the peer's `media_send` in the cluster
 * snapshot (WS `cluster:peers`).
 * @param {{ cluster: object, selfKey: string, sign: Function, sshKey: () => string, post: Function,
 *   project: () => Promise<object>, plan: Function, rsync: Function, log?: Function, now?: () => number }} deps
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
	const req = { from_key: deps.selfKey, to: fingerprint(peer.device_key), ssh_public_key: sshKey, ts: now() }
	const r = await deps.post(peer.host, peer.port, '/api/cluster/ssh-key', { ...req, sig: deps.sign(canonical(req)) })
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
		deps.cluster.poll().catch(() => {})
	})().catch((e) => deps.cluster.setMediaSend(id, { state: 'failed', error: e.message, at: now() }))
	return { status: 202, body: { ok: true, paths: plan.relPaths.length, slug: plan.slug || '' } }
}

module.exports = { acceptSshKey, sendMedia, fingerprint, canonical, MAX_SKEW_MS }
