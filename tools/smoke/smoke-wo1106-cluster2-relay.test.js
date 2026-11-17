'use strict'

/**
 * WO-1106 D3 — the Devices "Edit" relay (src/cluster/cluster-relay.js rawRequest) has an overall deadline: an answer
 * trickling a byte at a time never goes idle, and before the fix it held the client past its own 15 s.
 * In-process loopback server only (like smoke-wo1106-cluster-http.test.js); nothing on the LAN.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { rawRequest } = require('../../src/cluster/cluster-relay')

describe('WO-1106 D3 relay overall deadline', () => {
	let srv
	let port
	before(async () => {
		srv = http.createServer((req, res) => {
			if (req.url.startsWith('/trickle')) {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				const t = setInterval(() => res.write(' '), 30)
				res.on('close', () => clearInterval(t))
				return
			}
			res.writeHead(201, { 'Content-Type': 'application/x-test' })
			res.end('{"a":1}')
		})
		await new Promise((r) => srv.listen(0, '127.0.0.1', r))
		port = srv.address().port
	})
	after(() => new Promise((r) => {
		srv.closeAllConnections?.()
		srv.close(r)
	}))

	it('an answer that trickles forever ends at the deadline (no answer), not when the peer stops', { timeout: 5000 }, async () => {
		const t0 = Date.now()
		const r = await rawRequest('GET', '127.0.0.1', port, '/trickle', undefined, 400)
		const took = Date.now() - t0
		assert.equal(r.status, 0)
		assert.match(r.error, /no complete answer/)
		assert.ok(took < 2000, `ended after ${took} ms`)
	})

	it('a normal answer keeps its status, content type and body', async () => {
		const r = await rawRequest('POST', '127.0.0.1', port, '/ok', '{"x":1}', 2000)
		assert.equal(r.status, 201)
		assert.equal(r.contentType, 'application/x-test')
		assert.equal(r.body.toString(), '{"a":1}')
	})
})
