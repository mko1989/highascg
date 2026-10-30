'use strict'

/**
 * WO-830a items 1–2 — a single request must not restart node. process-guards turns any uncaught exception into
 * process.exit(1), so the WebSocket paths are exercised in a CHILD node process with an 'uncaughtException' recorder:
 *   1. `GET //` with Upgrade: video-feed's `new URL('//', base)` threw before auth → now a 400.
 *   2. an oversize (> 8 MiB) frame on /api/ws, and an invalid-UTF-8 frame on /api/video-feed: ws emits 'error' on the
 *      socket and, with no listener, that is an uncaught exception.
 * HIGHASCG_WO830A_ROOT points the child at another checkout (used once to prove the crash on the pre-fix tree).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = process.env.HIGHASCG_WO830A_ROOT || path.join(__dirname, '..', '..')

const CHILD = `
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')
const root = process.env.ROOT
process.env.HIGHASCG_API_TOKEN_FILE = path.join(os.tmpdir(), 'wo830a-no-such-token-' + process.pid)
const crashes = []
process.on('uncaughtException', (e) => crashes.push(String(e && e.message)))
const WebSocket = require(path.join(root, 'node_modules/ws'))
const { attachWebSocketServer } = require(path.join(root, 'src/server/ws-server'))
const { attachVideoFeed } = require(path.join(root, 'src/system/video-feed'))
const server = http.createServer((q, s) => s.end('x'))
const ctx = { config: {}, log: () => {} }
attachWebSocketServer(server, ctx, { log: () => {} })
const feed = attachVideoFeed(server, ctx, {})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function rawUpgrade(port, reqPath) {
	return new Promise((resolve) => {
		const s = net.connect(port, '127.0.0.1', () =>
			s.write('GET ' + reqPath + ' HTTP/1.1\\r\\nHost: x\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n' +
				'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n'))
		let buf = ''
		s.on('data', (d) => (buf += d))
		s.on('error', () => {})
		s.on('close', () => resolve(buf.split('\\r\\n')[0]))
		setTimeout(() => { s.destroy(); resolve(buf.split('\\r\\n')[0]) }, 800)
	})
}
function openWs(port, p) {
	return new Promise((resolve) => {
		const ws = new WebSocket('ws://127.0.0.1:' + port + p, { maxPayload: 64 * 1024 * 1024 })
		ws.on('error', () => {})
		ws.on('open', () => resolve(ws))
		setTimeout(() => resolve(null), 1500)
	})
}
server.listen(0, '127.0.0.1', async () => {
	const port = server.address().port
	const out = {}
	out.slashStatus = await rawUpgrade(port, '//')
	await sleep(100)
	const big = await openWs(port, '/api/ws')
	if (big) big.send(Buffer.alloc(9 * 1024 * 1024, 65), { binary: true })
	await sleep(600)
	out.bigClosed = big ? big.readyState === 3 : null
	const bad = await openWs(port, '/api/video-feed')
	if (bad) bad.send(Buffer.from([0xff, 0xfe, 0xfd, 0xc3, 0x28]), { binary: false })
	await sleep(600)
	out.badClosed = bad ? bad.readyState === 3 : null
	out.crashes = crashes
	console.log('RESULT ' + JSON.stringify(out))
	feed.close()
	process.exit(0)
})
`

function runChild() {
	const r = spawnSync(process.execPath, ['-e', CHILD], {
		env: { ...process.env, ROOT },
		encoding: 'utf8',
		timeout: 20000,
	})
	const line = String(r.stdout).split('\n').find((l) => l.startsWith('RESULT '))
	return { r, res: line ? JSON.parse(line.slice(7)) : null }
}

describe('WO-830a ws / video-feed: one request must not raise an uncaught exception', () => {
	const { r, res } = runChild()

	it('the child ran to completion', () => {
		assert.ok(res, `no RESULT line; status=${r.status} stderr=${String(r.stderr).slice(0, 400)}`)
	})
	it('GET // + Upgrade → 400 instead of a throw', () => {
		assert.match(res.slashStatus, /^HTTP\/1\.1 400/)
	})
	it('oversize frame on /api/ws closes the socket and does not crash', () => {
		assert.equal(res.bigClosed, true)
	})
	it('invalid UTF-8 frame on /api/video-feed closes the socket and does not crash', () => {
		assert.equal(res.badClosed, true)
	})
	it('no uncaught exception was recorded in the child', () => {
		assert.deepEqual(res.crashes, [])
	})
})
