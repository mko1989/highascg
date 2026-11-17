'use strict'

/**
 * WO-1106 C29 — who may change the linked servers. With API auth off (the factory default) every device on the venue
 * network reached POST /api/cluster/master/set, peers add / delete, invites, Apply, send-media …: a phone could link a
 * rogue server or make itself master. Those routes now answer only when (routes-cluster.js `gated`):
 *   (a) API auth is enforced and the request carries the password, or (b) the request comes from the box itself —
 *       both exactly as module installs (module-host/code-change-gate.js mayChangeInstalledCode, box-local-request.js);
 *   (c) the request is signed by a linked server's device key (cluster-signed-request.js): the Devices "Edit" relay of
 *       an operator allowed on THAT server (cluster-relay.js), or a server unlinking itself (`?link_back=0`).
 * Otherwise 403 NOT_ALLOWED with one plain sentence. Reading (GET) stays open; the signed node-to-node routes (call,
 * hello, master claim, ssh-key, media-call) keep their own signature checks.
 */

const { mayChangeInstalledCode } = require('../module-host/code-change-gate')
const { isSigned, createRequestVerifier } = require('./cluster-signed-request')
const { fingerprint } = require('./cluster-media')
const { isSandbox } = require('../bootstrap/sandbox')
const { checkBoxLocalRequest, isLoopbackAddress } = require('../api/box-local-request')

const REFUSAL = 'Changing linked servers is only allowed with a password or on the box itself. Turn on API auth in Settings ▸ System, or do this on the box itself.'

/**
 * @param {{ peers: () => Array<{ id: string, device_key?: string }>, selfKey: () => string, verify: Function,
 *   floorStore?: object }} deps
 */
function createClusterGate(deps) {
	const verifyRequest = createRequestVerifier({ selfKey: deps.selfKey, verify: deps.verify, floorStore: deps.floorStore })
	const linkedKey = (fp) => (deps.peers() || []).find((p) => p?.device_key && fingerprint(p.device_key) === fp)?.device_key || null

	/** (a) or (b): an operator allowed on this server (the relay signs only for such an operator). */
	const operator = (req, ctx) => mayChangeInstalledCode(req, ctx).ok || sandboxLocal(req)

	/**
	 * → { ok: true, via: 'auth' | 'box' | 'peer', fp? } | { ok: false, status, body }
	 * @param {{ onlyPeer?: string }} [o]  onlyPeer: only that linked server's signature counts (it unlinks itself)
	 */
	function check(req, ctx, body, { onlyPeer } = {}) {
		const own = mayChangeInstalledCode(req, ctx)
		if (own.ok) return own
		if (sandboxLocal(req)) return { ok: true, via: 'box' }
		if (isSigned(req)) {
			const only = onlyPeer ? (deps.peers() || []).find((p) => p?.id === onlyPeer)?.device_key || null : null
			const keyOf = onlyPeer ? (fp) => (only && fingerprint(only) === fp ? only : null) : linkedKey
			const v = verifyRequest(req, body, keyOf)
			if (v.ok) return { ok: true, via: 'peer', fp: v.fp }
			return v.status === 409 ? v : { ok: false, status: v.status, body: { ...v.body, code: v.body.code || 'NOT_ALLOWED' } }
		}
		return { ok: false, status: 403, body: { ok: false, code: 'NOT_ALLOWED', error: REFUSAL } }
	}

	return { check, operator }
}

/**
 * A sandbox node (tools/e2e: cluster-nodes.js, virtual-boxes.js) listens on a loopback alias such as 127.0.1.12 and is
 * driven from this machine, so its Host is that alias, not 127.0.0.1 (box-local-request.js). Only there, and only with a
 * loopback socket and a 127.x.x.x Host (an address literal, no rebinding name), does that count as the box itself; a
 * sandbox never listens off loopback (WO-719). Outside a sandbox this is never true.
 */
function sandboxLocal(req) {
	if (!req || !isSandbox() || !isLoopbackAddress(req.socket?.remoteAddress)) return false
	const host = String(req.headers?.host || '').replace(/:\d+$/, '')
	if (!/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return false
	const local = checkBoxLocalRequest({ socket: { remoteAddress: req.socket.remoteAddress }, headers: { ...req.headers, host: '127.0.0.1' } })
	return local.ok // the same proxy-header and Origin rules
}

module.exports = { createClusterGate, REFUSAL }
