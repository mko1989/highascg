'use strict'

/**
 * WO-725 — read-only API timing for one server (WO-724's single-box benchmark, automated): each route sequential and
 * at 10 concurrent, keep-alive. Nothing here changes a server.
 */

const http = require('http')

const ROUTES = ['/api/replication/ping', '/api/cluster/identity', '/api/device-view', '/api/video-surfaces', '/api/state']
const pct = (a, p) => +a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))].toFixed(1)

function get(agent, url) {
	return new Promise((resolve) => {
		const t0 = process.hrtime.bigint()
		const req = http.get(url, { agent, timeout: 15000 }, (res) => {
			res.resume()
			res.on('end', () => resolve({ ok: res.statusCode === 200, ms: Number(process.hrtime.bigint() - t0) / 1e6 }))
		})
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', () => resolve({ ok: false, ms: Number(process.hrtime.bigint() - t0) / 1e6 }))
	})
}

/** → { [route]: { seqP50, seqP95, concP50, rps, errors } } */
async function benchNode(node, { n = 100, conc = 10 } = {}) {
	const agent = new http.Agent({ keepAlive: true, maxSockets: conc })
	const out = {}
	try {
		for (const route of ROUTES) {
			const url = node.url + route
			for (let i = 0; i < 3; i++) await get(agent, url) // warm
			const seq = []
			for (let i = 0; i < n; i++) seq.push(await get(agent, url))
			const par = []
			let next = 0
			const t0 = Date.now()
			await Promise.all(Array.from({ length: conc }, async () => {
				while (next++ < n) par.push(await get(agent, url))
			}))
			const secs = Math.max(0.001, (Date.now() - t0) / 1000)
			const s = seq.map((r) => r.ms).sort((a, b) => a - b)
			const p = par.map((r) => r.ms).sort((a, b) => a - b)
			out[route] = { seqP50: pct(s, 50), seqP95: pct(s, 95), concP50: pct(p, 50), rps: Math.round(n / secs), errors: [...seq, ...par].filter((r) => !r.ok).length }
		}
	} finally {
		agent.destroy()
	}
	return out
}

module.exports = { benchNode, ROUTES }
