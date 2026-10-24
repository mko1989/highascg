'use strict'

/**
 * WO-725 — the servers a cluster run drives. Two kinds behind one shape:
 *   sandbox  throwaway servers on this box (sandbox-server.js, `--no-caspar`), each with its own root, device key and
 *            replication.selfId (= its id once linked); they can be frozen (SIGSTOP), thawed and restarted
 *   live     real servers given as host[:port] — only the steps that change nothing outside the cluster run on them
 *
 *   const nodes = await startSandboxNodes(root, ['sb-a', 'sb-b', 'sb-c'])
 *   const live = liveNodes(['192.168.0.23:4200', '192.168.0.4:4200'])
 */

const http = require('http')
const path = require('path')
const { startSandbox } = require('./sandbox-server')

/** One JSON request; never throws (status 0 = no answer). */
function request(method, url, body, timeoutMs = 8000) {
	return new Promise((resolve) => {
		const t0 = process.hrtime.bigint()
		const ms = () => Number(process.hrtime.bigint() - t0) / 1e6
		const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
		const req = http.request(url, { method, timeout: timeoutMs, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (res) => {
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

function api(node) {
	return {
		get: (p, t) => request('GET', node.url + p, undefined, t),
		post: (p, b, t) => request('POST', node.url + p, b, t),
		del: (p, t) => request('DELETE', node.url + p, undefined, t),
	}
}

/** The cluster as this node sees it (GET /api/cluster), or null when it does not answer. */
async function clusterView(node, timeoutMs = 3000) {
	const r = await node.get('/api/cluster', timeoutMs)
	return r.status === 200 ? r.data : null
}

async function startSandboxNodes(root, ids, opts = {}) {
	const start = (id, port) =>
		startSandbox({ root: path.join(root, id), port, media: false, config: { replication: { enabled: false, selfId: id } }, log: opts.log })
	return Promise.all(
		ids.map(async (id) => {
			const node = { id, kind: 'sandbox' }
			const attach = (sb) => Object.assign(node, { sb, url: sb.url, address: `127.0.0.1:${sb.port}`, pid: sb.pid }, api(node))
			attach(await start(id))
			node.freeze = () => process.kill(node.pid, 'SIGSTOP')
			node.thaw = () => process.kill(node.pid, 'SIGCONT')
			node.restart = async () => {
				await node.sb.stop()
				attach(await start(id, node.sb.port))
			}
			node.stop = () => node.sb.stop()
			return node
		}),
	)
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
