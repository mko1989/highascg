'use strict'

/**
 * WO-1106 C17 / C22 — cluster-peers.js peer HTTP calls and the poll.
 * C17: an answer is read with a byte cap (1 MB ping / status, 8 MB else) and a whole-answer deadline on top of the
 * idle timeout. In-process loopback server only (like smoke-wo670-cluster.test.js); nothing on the LAN.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { getJson, requestJson, fetchBody, capFor, deadlineFor, SMALL_BODY, MAX_BODY } = require('../../src/cluster/cluster-http')
const peers = require('../../src/cluster/cluster-peers')

describe('WO-1106 C17 peer answers are capped and have a deadline', () => {
	let srv
	let port
	const chunk = Buffer.alloc(64 * 1024, 0x20)
	before(async () => {
		srv = http.createServer((req, res) => {
			if (req.url.startsWith('/trickle')) {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				const t = setInterval(() => res.write(' '), 30)
				res.on('close', () => clearInterval(t))
				return
			}
			if (req.url.startsWith('/ok')) return res.end('{"a":1}')
			// endless body: keeps writing until the client hangs up
			res.writeHead(200, { 'Content-Type': 'application/json' })
			let sent = 0
			const pump = () => {
				while (!res.destroyed && sent < 64 * 1024 * 1024) {
					sent += chunk.length
					if (!res.write(chunk)) return res.once('drain', pump)
				}
			}
			res.on('close', () => { req.socket.destroy() })
			pump()
		})
		await new Promise((r) => srv.listen(0, '127.0.0.1', r))
		port = srv.address().port
	})
	after(() => new Promise((r) => {
		srv.closeAllConnections?.()
		srv.close(r)
	}))

	it('cap by path: 1 MB for ping / status, 8 MB else (the relay cap)', () => {
		assert.equal(SMALL_BODY, 1024 * 1024)
		assert.equal(MAX_BODY, 8 * 1024 * 1024)
		for (const p of ['/api/replication/ping', '/api/cluster/identity', '/api/cluster/master', '/api/cluster/hello', '/api/cluster/peers', '/api/cluster/peers/x?link_back=0'])
			assert.equal(capFor(p), SMALL_BODY, p)
		for (const p of ['/api/device-view', '/api/cluster/call', '/api/cluster/media-call']) assert.equal(capFor(p), MAX_BODY, p)
		assert.match(require('fs').readFileSync(require('path').join(__dirname, '../../src/cluster/cluster-relay.js'), 'utf8'), /const MAX_BODY = 8 \* 1024 \* 1024/)
		assert.ok(deadlineFor(1500) > 1500 && deadlineFor(350) > 350, 'the deadline is past the idle timeout')
	})

	it('an endless ping answer stops at 1 MB (no answer, node keeps its memory)', async () => {
		const r = await getJson('127.0.0.1', port, '/api/replication/ping')
		assert.equal(r.ok, false)
		assert.equal(r.status, 0)
		assert.equal(r.error, 'answer too large')
	})

	it('an endless POST answer stops at 8 MB', async () => {
		const r = await requestJson('POST', '127.0.0.1', port, '/api/cluster/call', { a: 1 })
		assert.deepEqual([r.ok, r.status, r.error], [false, 0, 'answer too large'])
	})

	it('a normal answer still parses (device view path, small and large caps)', async () => {
		assert.deepEqual((await getJson('127.0.0.1', port, '/ok')).json, { a: 1 })
		assert.equal((await requestJson('POST', '127.0.0.1', port, '/ok', {})).ok, true)
	})

	it('a trickling body that never goes idle ends at the deadline', async () => {
		const t0 = Date.now()
		const r = await fetchBody({ host: '127.0.0.1', port, path: '/trickle', method: 'GET', timeout: 1000 }, null, { deadline: 300 })
		assert.deepEqual(r, { status: 0, error: 'deadline' })
		assert.ok(Date.now() - t0 < 1500, 'well before any idle timeout would fire')
	})

	it('cluster-peers.js still exports the same helpers', () => {
		assert.equal(peers.getJson, getJson)
		assert.equal(peers.requestJson, requestJson)
		assert.equal(typeof peers.postJson, 'function')
	})
})

describe('WO-1106 C22 one poll in flight', () => {
	it('overlapping poll() calls share one run (one ping per peer, hooks once); the next call runs again', async () => {
		let pings = 0
		let release
		const gate = new Promise((r) => (release = r))
		const fetchJson = async () => {
			pings++
			await gate
			return { ok: true, status: 200, json: { appId: 'highascg', selfId: 'boxB', hostname: 'boxB', instanceId: 'iB', role: 'standalone' } }
		}
		const store = new Map([['clusterPeers', [{ id: 'boxB', host: '10.0.0.6', port: 4200, name: 'B', added_at: 1 }]]])
		const c = peers.createCluster({ persistence: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) }, selfPing: async () => ({ selfId: 'boxA' }),
			fetchJson, localAddress: async () => '', request: async () => ({ ok: false, status: 0, error: 'offline test' }) })
		let hooks = 0
		c.afterPoll(() => hooks++)
		const a = c.poll()
		const b = c.poll()
		assert.equal(a, b, 'the second caller awaits the same promise')
		release()
		await Promise.all([a, b])
		await new Promise((r) => setImmediate(r))
		assert.equal(pings, 1)
		assert.equal(hooks, 1)
		await c.poll()
		assert.equal(pings, 2, 'a poll after the first settled runs again')
		c.stop()
	})
})
