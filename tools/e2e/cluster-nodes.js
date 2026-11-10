'use strict'

/**
 * WO-725 — the servers a cluster run drives. Two kinds behind one shape:
 *   sandbox  throwaway servers on this box (sandbox-server.js, `--no-caspar`), each with its own root, device key and
 *            replication.selfId (= its id once linked); they can be frozen (SIGSTOP), thawed and restarted
 *   live     real servers given as host[:port] — only the steps that change nothing outside the cluster run on them
 *
 *   const nodes = await startSandboxNodes(root, ['sb-a', 'sb-b', 'sb-c'])
 *   const live = liveNodes(['192.168.0.23:4200', '192.168.0.4:4200'])
 *
 * WO-1029 — nodes told apart by ADDRESS, and links that can be cut one way:
 *   startSandboxNodes(root, ids, { hosts: { 'sb-a': '127.0.1.11', 'sb-b': '127.0.1.12' } })
 *     each listed node binds only its own loopback alias (the whole 127.0.0.0/8 is local on Linux, no setup); unlisted
 *     nodes stay on 127.0.0.1. node.host / node.address follow the alias.
 *   node.move('127.0.1.21')   stop + restart the same node (same root, device key, id, port) at the new alias; the old
 *                             alias is dead (connection refused). node.address updates.
 *   const f = await other.linkVia()   a tcp-forwarder (tcp-forwarder.js) in front of `other`, on its own alias 127.0.9.x;
 *                             a node linked to `f.address` instead of other.address reaches `other` only while f is
 *                             not paused (one direction). It follows other.move().
 * Limit: the kernel picks 127.0.0.1 as the SOURCE of every loopback connection (`ip route get 127.0.1.12` → src
 * 127.0.0.1), so a node's own idea of "my address towards peer X" (cluster-peers.js localAddressTo, line 101,
 * net.connect without localAddress) is 127.0.0.1, not its alias. The link-back it posts therefore names 127.0.0.1:port,
 * which nobody listens on. Link both directions explicitly (POST /api/cluster/peers with link_back:false on both sides).
 */

const http = require('http')
const path = require('path')
const { startSandbox } = require('./sandbox-server')
const { createForwarder } = require('./tcp-forwarder')

/** One JSON request; never throws (status 0 = no answer). */
function request(method, url, body, timeoutMs = 8000, extraHeaders = {}) {
	return new Promise((resolve) => {
		const t0 = process.hrtime.bigint()
		const ms = () => Number(process.hrtime.bigint() - t0) / 1e6
		const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
		const headers = { ...extraHeaders, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) }
		const req = http.request(url, { method, timeout: timeoutMs, headers }, (res) => {
			const c = []
			res.on('data', (d) => c.push(d))
			res.on('end', () => {
				let json = null
				try {
					json = JSON.parse(Buffer.concat(c).toString('utf8') || 'null')
				} catch {
					/* not JSON */
				}
				resolve({ status: res.statusCode, data: json, ms: ms() })
			})
		})
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', (e) => resolve({ status: 0, data: null, ms: ms(), error: e.message }))
		if (data) req.write(data)
		req.end()
	})
}

/** Poll fn() until it returns a truthy value; → { value, ms } or throws with the last value seen. */
async function waitFor(what, fn, timeoutMs, stepMs = 100) {
	const t0 = Date.now()
	let last
	while (Date.now() - t0 <= timeoutMs) {
		last = await fn()
		if (last) return { value: last, ms: Date.now() - t0 }
		await new Promise((r) => setTimeout(r, stepMs))
	}
	throw new Error(`${what}: not within ${timeoutMs} ms (last: ${JSON.stringify(last)?.slice(0, 200)})`)
}

/** WO-1029: `node.token` (the shared password of a node with auth on) rides every harness call as a Bearer header. */
function api(node) {
	const auth = () => (node.token ? { Authorization: `Bearer ${node.token}` } : {})
	return {
		get: (p, t) => request('GET', node.url + p, undefined, t, auth()),
		post: (p, b, t) => request('POST', node.url + p, b, t, auth()),
		del: (p, t) => request('DELETE', node.url + p, undefined, t, auth()),
	}
}

/** The cluster as this node sees it (GET /api/cluster), or null when it does not answer. */
async function clusterView(node, timeoutMs = 3000) {
	const r = await node.get('/api/cluster', timeoutMs)
	return r.status === 200 ? r.data : null
}

/**
 * @param {{ log?: Function, token?: string, extra?: (id: string, root: string) => { config?: object, env?: object, tracking?: boolean, caspar?: object } }} [opts]
 *   extra: per-server startSandbox options (WO-979: a media and a tracking role), asked again on every restart
 *   token: the shared password of nodes started with auth on (WO-1029 virtual-boxes.js): the harness calls carry it
 */
let fwdSeq = 0

async function startSandboxNodes(root, ids, opts = {}) {
	const hosts = { ...opts.hosts }
	const start = (id, port) => {
		const r = path.join(root, id)
		const x = opts.extra ? opts.extra(id, r) || {} : {}
		return startSandbox({ ...x, root: r, host: hosts[id], port, media: false, config: { ...x.config, replication: { enabled: false, selfId: id } }, log: opts.log })
	}
	// WO-752: one sandbox failing must not leak the others — their processes kept the test process (and test:ci)
	// alive for hours; the caller never got `nodes` to stop.
	const settled = await Promise.allSettled(
		ids.map(async (id) => {
			const node = { id, kind: 'sandbox', token: opts.token || '' }
			const attach = (sb) => Object.assign(node, { sb, url: sb.url, host: sb.host, port: sb.port, address: `${sb.host}:${sb.port}`, pid: sb.pid }, api(node))
			const forwarders = []
			attach(await start(id))
			node.freeze = () => process.kill(node.pid, 'SIGSTOP')
			node.thaw = () => process.kill(node.pid, 'SIGCONT')
			node.restart = async () => {
				await node.sb.stop()
				attach(await start(id, node.sb.port))
			}
			node.move = async (newHost) => {
				await node.sb.stop()
				hosts[id] = newHost
				attach(await start(id, node.sb.port))
				for (const f of forwarders) f.retarget({ host: node.host, port: node.port }) // forwarders in front of this node follow it
			}
			// forwarders IN FRONT OF this node (peers reach it through them); closed with it
			node.linkVia = async (listenHost) => {
				const f = await createForwarder({ listenHost: listenHost || `127.0.9.${++fwdSeq}`, target: { host: node.host, port: node.port } })
				forwarders.push(f)
				return f
			}
			node.stop = async () => {
				await node.sb.stop()
				await Promise.all(forwarders.splice(0).map((f) => f.close()))
			}
			return node
		}),
	)
	const failed = settled.find((r) => r.status === 'rejected')
	if (failed) {
		await Promise.all(settled.filter((r) => r.status === 'fulfilled').map((r) => r.value.stop()))
		throw failed.reason
	}
	return settled.map((r) => r.value)
}

/** Real servers: their id is whatever they report (selfId or hostname), read before any step. */
async function liveNodes(addresses) {
	return Promise.all(
		addresses.map(async (a) => {
			const address = a.includes(':') ? a : `${a}:4200`
			const node = { kind: 'live', address, url: `http://${address}` }
			Object.assign(node, api(node))
			const ping = await node.get('/api/replication/ping')
			if (ping.status !== 200 || ping.data?.appId !== 'highascg') throw new Error(`no HighAsCG server at ${address}`)
			node.id = String(ping.data.selfId || ping.data.hostname).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64)
			node.stop = async () => {}
			return node
		}),
	)
}

module.exports = { request, waitFor, clusterView, startSandboxNodes, liveNodes }
