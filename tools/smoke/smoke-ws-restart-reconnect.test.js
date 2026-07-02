'use strict'

/**
 * WO-104 T104.7 — server kill/restart WS reconnect + AMCP timeout + multiview tick filter.
 * Spawns a local HighAsCG process (no Caspar); excluded from default CI if too slow — wired in run-offline-tests.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const REPO_ROOT = path.resolve(__dirname, '../..')

/**
 * @param {number} port
 */
function startHighascg(port) {
	const child = spawn(process.execPath, ['index.js', '--port', String(port), '--no-caspar'], {
		cwd: REPO_ROOT,
		env: { ...process.env, HIGHASCG_CSP: '0' },
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	child.stdout?.on('data', () => {})
	child.stderr?.on('data', () => {})
	return child
}

/**
 * @param {number} port
 * @param {number} timeoutMs
 */
function waitForHttp(port, timeoutMs = 60000) {
	const deadline = Date.now() + timeoutMs
	return new Promise((resolve, reject) => {
		const tick = () => {
			const req = http.get(`http://127.0.0.1:${port}/api/settings`, (res) => {
				res.resume()
				if (res.statusCode === 200) resolve()
				else if (Date.now() >= deadline) reject(new Error(`HTTP ${res.statusCode}`))
				else setTimeout(tick, 200)
			})
			req.on('error', () => {
				if (Date.now() >= deadline) reject(new Error('server not ready'))
				else setTimeout(tick, 200)
			})
			req.setTimeout(1500, () => {
				req.destroy()
				if (Date.now() >= deadline) reject(new Error('server not ready'))
				else setTimeout(tick, 200)
			})
		}
		tick()
	})
}

/**
 * @param {import('child_process').ChildProcess} child
 */
function stopProcess(child) {
	return new Promise((resolve) => {
		if (!child || child.killed) return resolve()
		child.once('exit', () => resolve())
		child.kill('SIGTERM')
		setTimeout(() => {
			try {
				child.kill('SIGKILL')
			} catch {
				/* ignore */
			}
		}, 3000)
	})
}

test('WsClient reconnects after server kill + restart without new client instance', async () => {
	const port = 18000 + Math.floor(Math.random() * 1000)
	let child = startHighascg(port)
	try {
		await waitForHttp(port)

		globalThis.WebSocket = WebSocket
		const { WsClient } = await import('../../client/lib/ws-client.js')
		const url = `ws://127.0.0.1:${port}/api/ws`

		let connectCount = 0
		let gotState = false
		const client = new WsClient({
			url,
			reconnectInterval: 150,
			maxReconnectInterval: 400,
			amcpTimeoutMs: 2000,
		})

		await new Promise((resolve, reject) => {
			const t = setTimeout(() => reject(new Error('initial connect timeout')), 15000)
			client.on('connect', () => {
				connectCount++
			})
			client.on('message', (msg) => {
				if (msg?.type === 'state') {
					gotState = true
					clearTimeout(t)
					resolve()
				}
			})
			client.on('error', () => {})
		})

		assert.equal(connectCount, 1)
		assert.equal(gotState, true)

		await stopProcess(child)
		child = null

		await new Promise((r) => setTimeout(r, 400))

		child = startHighascg(port)
		await waitForHttp(port)

		await new Promise((resolve, reject) => {
			const t = setTimeout(() => reject(new Error('reconnect timeout')), 25000)
			const onConnect = () => {
				if (connectCount >= 2) {
					clearTimeout(t)
					resolve()
				}
			}
			client.on('connect', onConnect)
		})

		assert.ok(connectCount >= 2, `expected reconnect, connectCount=${connectCount}`)
		assert.equal(client.connected, true)
		client.close()
	} finally {
		await stopProcess(child)
	}
})

test('sendAmcp rejects on timeout when server does not reply', async () => {
	const server = http.createServer()
	const wss = new WebSocket.Server({ noServer: true })
	server.on('upgrade', (req, socket, head) => {
		if (!String(req.url || '').startsWith('/api/ws')) {
			socket.destroy()
			return
		}
		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit('connection', ws, req)
		})
	})
	wss.on('connection', (ws) => {
		ws.on('message', () => {
			/* swallow amcp — no amcp_result */
		})
	})

	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = /** @type {import('net').AddressInfo} */ (server.address()).port

	globalThis.WebSocket = WebSocket
	const { WsClient } = await import('../../client/lib/ws-client.js')
	const client = new WsClient({
		url: `ws://127.0.0.1:${port}/api/ws`,
		reconnectInterval: 5000,
		amcpTimeoutMs: 400,
	})

	await new Promise((resolve) => {
		client.on('connect', resolve)
	})

	let listenerCountBefore = 0
	const msgListeners = client.listeners.get('message')
	if (msgListeners) listenerCountBefore = msgListeners.length

	await assert.rejects(() => client.sendAmcp('VERSION'), /AMCP timeout/)
	const msgListenersAfter = client.listeners.get('message') || []
	assert.equal(
		msgListenersAfter.length,
		listenerCountBefore,
		'amcp timeout must remove the message listener',
	)

	client.close()
	await new Promise((resolve) => {
		server.close(() => resolve())
		wss.close()
	})
})

test('multiview editor ignores timeline.tick and coalesces redraw via rAF', async () => {
	const src = await fs.promises.readFile(
		path.join(REPO_ROOT, 'client/components/multiview-editor.js'),
		'utf8',
	)
	assert.match(src, /IGNORE_STATE_PATHS[\s\S]*'timeline\.tick'/)
	assert.match(src, /requestAnimationFrame\(\(\) => \{/)
	assert.match(src, /if \(path && IGNORE_STATE_PATHS\.has\(path\)\) return/)
})
