'use strict'

/**
 * WO-732 / WO-739 — servers on a fake LAN for the cluster smokes: each runs the real cluster-peers.js code, and requests
 * go through the same routing as routes-cluster.js. `server(name, host, { auth, old, invites })`: `invites` gives that
 * server WO-739's invites (cluster-invites.js) on its own store, so a link-back waits there unless it auto-accepts.
 * WO-1029: servers sign hellos with a fake device key (`sign`/`verify` below: a hash, enough to tell keys apart).
 * `move(name, host)` re-addresses a server; `block(from, to)` / `unblock(from, to)` cut one direction only.
 * WO-1029 C0: `caps` = the capability list that server advertises (default: this build's; null = a build before caps).
 * `noHello` = a server before WO-1029 (no hello route, no ping fingerprint). Hellos are counted in `hellos`, not `calls`.
 */

const { createCluster, linkedFingerprints } = require('../../../src/cluster/cluster-peers')
const { createInvites } = require('../../../src/cluster/cluster-invites')
const { fingerprint } = require('../../../src/cluster/cluster-media')
const crypto = require('crypto')

/** WO-1029: a fake signature only the holder of `key` makes (keys are names here, never exchanged in a hello). */
const fakeSign = (key, msg) => crypto.createHash('sha256').update(`${key}|${msg}`).digest('base64')
const fakeVerify = (key, msg, sig) => fakeSign(key, msg) === sig

const refused = { ok: false, status: 0, json: null, error: 'ECONNREFUSED' }
const ok = (json, status = 200) => ({ ok: status < 300, status, json })

/** Servers on a fake LAN: each runs the real cluster code; requests go through the same routing as routes-cluster.js. */
function lan() {
	const nodes = new Map()
	let t = 1_800_000_000_000
	const clock = { now: () => t, advance: (ms) => (t += ms) }
	const blocked = new Set() // WO-1029: `from>to` names: that direction does not connect
	const reachFrom = (from) => (h, p) => {
		const n = nodes.get(`${h}:${p}`)
		return n && n.up && from.up && !blocked.has(`${from.name}>${n.name}`) ? n : null
	}
	function server(name, host, o = {}) {
		const m = new Map()
		const store = { get: (k) => m.get(k), set: (k, v) => m.set(k, v), m }
		const key = o.key || `-----KEY ${name}-----`
		const n = { name, host, port: 4200, key, store, up: true, auth: !!o.auth, old: !!o.old, noHello: !!(o.old || o.noHello), calls: [], hellos: [], caps: o.caps === undefined ? require('../../../src/cluster/cluster-caps').supported() : o.caps }
		const reach = reachFrom(n)
		n.ping = () => ({ appId: 'highascg', selfId: name, hostname: name, instanceId: `i-${name}`, appVersion: 'x',
			...(n.old ? {} : { clusterLinked: linkedFingerprints(store) }), ...(n.noHello ? {} : { fingerprint: fingerprint(n.key) }), ...(n.old || n.caps === null ? {} : { caps: n.caps }) })
		n.c = createCluster({
			persistence: store,
			invites: o.invites ? createInvites({ persistence: store, now: clock.now }) : null,
			selfKey: key,
			sign: (msg) => fakeSign(n.key, msg),
			verify: fakeVerify,
			selfPing: async () => n.ping(),
			selfPort: () => 4200,
			now: clock.now,
			hosts: () => [],
			fetchJson: async (h, p, url) => {
				const peer = reach(h, p)
				if (!peer) return refused
				if (url === '/api/replication/ping') return ok(peer.ping())
				if (url === '/api/cluster/identity') return ok({ device_key: peer.key })
				return ok({ error: 'not found' }, 404)
			},
			request: async (method, h, p, url, body) => {
				const peer = reach(h, p)
				if (!peer) return refused
				if (method === 'POST' && url === '/api/cluster/hello') {
					peer.hellos.push(body)
					if (peer.noHello) return ok({ error: 'not found' }, 404)
					const r = peer.c.hello(body)
					return ok(r.body, r.status)
				}
				peer.calls.push(`${method} ${url}`)
				if (peer.auth) return ok({ error: 'Unauthorized' }, 401)
				if (method === 'POST' && url === '/api/cluster/peers') {
					const b = peer.old ? { address: body.address } : body // an older server ignores link_back
					const r = await peer.c.add(b)
					return ok(r.body, r.status)
				}
				const inv = /^\/api\/cluster\/invites\/([^/]+)\/(accept|decline)$/.exec(url)
				if (method === 'POST' && inv) {
					const r = await peer.c[inv[2]](decodeURIComponent(inv[1]))
					return ok(r.body, r.status)
				}
				const del = /^\/api\/cluster\/peers\/([^?]+)(\?link_back=0)?$/.exec(url)
				if (method === 'DELETE' && del) {
					const r = await peer.c.unlink(decodeURIComponent(del[1]), { linkBack: !del[2] })
					return r.ok ? ok(r) : ok({ error: 'no such server' }, 404)
				}
				return ok({ error: 'not found' }, 404)
			},
			localAddress: async (h, p) => (reach(h, p) ? n.host : ''),
			onRemove: o.onRemove, // WO-802
		})
		nodes.set(`${host}:4200`, n)
		return n
	}
	const ids = (n) => n.c.snapshot().peers.map((p) => p.id).sort()
	const peerOf = (n, id) => n.c.snapshot().peers.find((p) => p.id === id)
	const stopAll = () => nodes.forEach((n) => n.c.stop())
	const byName = (name) => [...nodes.values()].find((n) => n.name === name)
	/** WO-1029: that server now answers at newHost (its old address answers nobody, or whoever is added there next). */
	function move(name, newHost) {
		const n = byName(name)
		nodes.delete(`${n.host}:${n.port}`)
		n.host = newHost
		nodes.set(`${newHost}:${n.port}`, n)
		return n
	}
	const block = (from, to) => blocked.add(`${from}>${to}`)
	const unblock = (from, to) => blocked.delete(`${from}>${to}`)
	return { server, clock, ids, peerOf, stopAll, move, block, unblock }
}

module.exports = { lan, refused, ok }
