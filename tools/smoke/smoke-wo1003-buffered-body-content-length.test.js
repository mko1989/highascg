'use strict'

/**
 * WO-1003 — a buffered API body is sent with Content-Length, not chunked.
 *
 * The route path wrote headers first and then `res.end(buffer)`, so Node framed the whole body as ONE chunk. Godot's
 * HTTPClient refuses any chunk over 16 MB (`ERROR: HTTP Chunk too big!! >16mb`, core/io/http_client_tcp.cpp:642 →
 * RESULT_CONNECTION_ERROR), so the client's Previs Models list and the MVR venue model could never download the
 * owner's 61 MB Capture .glb (GET /api/project-files/<name> = fs.readFileSync). curl did not mind.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { startHttpServer, stopHttpServer } = require('../../src/server/http-server')

const BIG = Buffer.alloc(20 * 1024 * 1024, 7) // over Godot's 16 MB chunk cap

function get(port, p) {
	return new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port, path: p }, (res) => {
			let n = 0
			res.on('data', (c) => (n += c.length))
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: n }))
		}).on('error', reject)
	})
}

test('WO-1003: buffered bodies carry Content-Length (no chunked framing); 204 stays bodiless', async () => {
	const routeApi = async (_m, p) => {
		if (p === '/api/big') return { status: 200, headers: { 'Content-Type': 'model/gltf-binary' }, body: BIG }
		if (p === '/api/txt') return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'żółw' }
		if (p === '/api/none') return { status: 204, headers: {}, body: '' }
		return { status: 404, headers: {}, body: '' }
	}
	const server = startHttpServer({ port: 0, bindAddress: '127.0.0.1', routeApi, log: () => {} })
	await new Promise((r) => (server.listening ? r() : server.once('listening', r)))
	const { port } = server.address()
	try {
		const big = await get(port, '/api/big')
		assert.equal(big.status, 200)
		assert.equal(big.headers['content-length'], String(BIG.length))
		assert.equal(big.headers['transfer-encoding'], undefined, 'no chunked framing for a buffered body')
		assert.equal(big.bytes, BIG.length)
		const txt = await get(port, '/api/txt')
		assert.equal(txt.headers['content-length'], String(Buffer.byteLength('żółw')), 'byte length, not characters')
		const none = await get(port, '/api/none')
		assert.equal(none.status, 204)
		assert.equal(none.headers['content-length'], undefined)
	} finally {
		await new Promise((r) => stopHttpServer(server, r))
	}
})
