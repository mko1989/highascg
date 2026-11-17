'use strict'

/**
 * WO-1106 B3 — the PixelHue reader always settles (local HTTP servers on 127.0.0.1, never a switcher):
 *   a reply cut off mid-body rejects; a reply that trickles in (never idle) is ended by the hard deadline; a read()
 *   whose round trip never answers rejects at the read deadline and the next read() starts a fresh one.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const { httpJson, createPixelhueReader } = require('../../src/pixelhue/pixelhue-read')

async function withServer(handler, fn) {
	const sockets = new Set()
	const srv = http.createServer(handler)
	srv.on('connection', (s) => (sockets.add(s), s.on('close', () => sockets.delete(s))))
	await new Promise((r) => srv.listen(0, '127.0.0.1', r))
	try {
		return await fn(`http://127.0.0.1:${srv.address().port}/x`)
	} finally {
		for (const s of sockets) s.destroy()
		await new Promise((r) => srv.close(r))
	}
}

const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`still pending after ${ms} ms`)), ms))])

test('B3: a reply cut off mid-body rejects (it never settled before)', async () => {
	await withServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '500' })
		res.write('{"code":0,"data":[')
		setTimeout(() => res.socket.destroy(), 30)
	}, async (url) => {
		await assert.rejects(within(2000, httpJson(url)), /cut off|aborted|socket hang up/)
	})
})

test('B3: a reply that trickles in (never idle) ends at the hard deadline', async () => {
	await withServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100000' })
		const t = setInterval(() => res.write(' '), 20)
		res.on('close', () => clearInterval(t))
	}, async (url) => {
		await assert.rejects(within(2000, httpJson(url, {}, undefined, { deadlineMs: 300 })), /no full reply/)
	})
})

test('B3: a complete reply still resolves', async () => {
	await withServer((req, res) => res.end('{"code":0}'), async (url) => {
		assert.deepEqual(await httpJson(url), { code: 0 })
	})
})

test('B3: a read() that never answers rejects at the read deadline; the next read() is a fresh round trip', async () => {
	let calls = 0
	const get = () => (calls++, new Promise(() => {})) // the switcher never answers
	const reader = createPixelhueReader('10.0.0.15', { get, readDeadlineMs: 150 })
	await assert.rejects(within(2000, reader.read()), /no answer/)
	const before = calls
	await assert.rejects(within(2000, reader.read()), /no answer/)
	assert.ok(calls > before, 'pending was cleared: a new request went out')
})
