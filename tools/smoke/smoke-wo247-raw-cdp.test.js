'use strict'

/**
 * WO-247 T247.5 — offline smoke for the raw-CDP client (`cef-cdp-client.js`)
 * that replaced puppeteer-core for CDP sessions/pages. `cef-cdp-client.js` is
 * generic (WO-248 migrates the headless-Chrome thumbnail renderers onto it
 * too) and stands alone — the CEF *interactive-input* forwarding coverage
 * that used to live in this file (needle matching, forwardMouseEvent/
 * forwardKeyEvent) was removed with the rest of the CEF interactive bridge in
 * WO-257.
 *
 * Everything binds to 127.0.0.1 on ephemeral (port 0) ports inside this
 * file: a mock CDP WebSocket target. No connection to the real Caspar
 * remote-debugging port, no AMCP, no live server.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const WebSocket = require('ws')

const { connectCdp, createCefPage } = require('../../src/system/cef-cdp-client')

/**
 * Minimal mock CDP target: a `ws` server that answers Runtime.evaluate with
 * a real `eval()` of the expression (test-only) and acks Input.dispatch*
 * commands, recording every parsed message it receives.
 * @param {{ neverReplyMethods?: string[] }} [opts]
 */
function startMockCdpWs(opts = {}) {
	const neverReply = new Set(opts.neverReplyMethods || [])
	return new Promise((resolve, reject) => {
		const wss = new WebSocket.Server({ host: '127.0.0.1', port: 0 })
		const sockets = new Set()
		const received = []
		wss.on('connection', (sock) => {
			sockets.add(sock)
			sock.on('close', () => sockets.delete(sock))
			sock.on('message', (data) => {
				let msg
				try {
					msg = JSON.parse(String(data))
				} catch (_) {
					return
				}
				received.push(msg)
				const { id, method, params } = msg
				if (neverReply.has(method)) return
				if (method === 'Runtime.evaluate') {
					try {
						// eslint-disable-next-line no-eval
						const value = (0, eval)(params.expression)
						sock.send(JSON.stringify({ id, result: { result: { value } } }))
					} catch (e) {
						sock.send(JSON.stringify({ id, result: { exceptionDetails: { text: String(e?.message || e) } } }))
					}
					return
				}
				sock.send(JSON.stringify({ id, result: {} }))
			})
		})
		wss.on('error', reject)
		wss.on('listening', () => {
			const port = wss.address().port
			resolve({
				port,
				sockets,
				received,
				close: () =>
					new Promise((r) => {
						// Force-close any client sockets still open (e.g. a test that
						// never called page.close()) — otherwise wss.close() hangs
						// waiting for a graceful client disconnect that never comes.
						for (const sock of sockets) {
							try {
								sock.terminate()
							} catch (_) {}
						}
						wss.close(() => r(undefined))
					}),
			})
		})
	})
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

describe('cef-cdp-client: connectCdp session', () => {
	it('connects, correlates command ids, and resolves Runtime.evaluate results', async () => {
		const srv = await startMockCdpWs()
		try {
			const session = await connectCdp(`ws://127.0.0.1:${srv.port}/devtools/page/a`)
			assert.equal(session.connected, true)
			const [a, b, c] = await Promise.all([
				session.send('Runtime.evaluate', { expression: '1+1' }),
				session.send('Runtime.evaluate', { expression: '2+2' }),
				session.send('Runtime.evaluate', { expression: '3+3' }),
			])
			assert.equal(a.result.value, 2)
			assert.equal(b.result.value, 4)
			assert.equal(c.result.value, 6)
			session.close()
		} finally {
			await srv.close()
		}
	})

	it('times out a never-answered command', async () => {
		const srv = await startMockCdpWs({ neverReplyMethods: ['Runtime.evaluate'] })
		try {
			const session = await connectCdp(`ws://127.0.0.1:${srv.port}/devtools/page/b`)
			const t0 = Date.now()
			await assert.rejects(() => session.send('Runtime.evaluate', { expression: '1' }), /timeout/i)
			assert.ok(Date.now() - t0 >= 4500, 'expected the ~5s command timeout to elapse')
			session.close()
		} finally {
			await srv.close()
		}
	})

	it('rejects pending commands when the socket closes', async () => {
		const srv = await startMockCdpWs({ neverReplyMethods: ['Runtime.evaluate'] })
		try {
			const session = await connectCdp(`ws://127.0.0.1:${srv.port}/devtools/page/c`)
			const pending = session.send('Runtime.evaluate', { expression: '1' })
			await sleep(50) // let the server receive the command before we sever the socket
			for (const sock of srv.sockets) sock.terminate()
			await assert.rejects(() => pending, /closed/i)
		} finally {
			await srv.close()
		}
	})
})

describe('cef-cdp-client: createCefPage', () => {
	it('evaluate() accepts both an expression string and a thunk function (bridge compat)', async () => {
		const srv = await startMockCdpWs()
		try {
			const page = await createCefPage({
				targetInfo: { url: 'https://example.test/mario' },
				wsUrl: `ws://127.0.0.1:${srv.port}/devtools/page/d`,
			})
			assert.equal(page.url(), 'https://example.test/mario')
			assert.equal(await page.evaluate('21*2'), 42)
			assert.equal(
				await page.evaluate(() => 6 * 7),
				42,
			)
			page.close()
		} finally {
			await srv.close()
		}
	})

	it('throws on Runtime.evaluate exceptionDetails', async () => {
		const srv = await startMockCdpWs()
		try {
			const page = await createCefPage({
				targetInfo: { url: 'https://example.test/x' },
				wsUrl: `ws://127.0.0.1:${srv.port}/devtools/page/e`,
			})
			await assert.rejects(() => page.evaluate('({}).nope()'), /not a function/)
			page.close()
		} finally {
			await srv.close()
		}
	})

	it('dispatchMouseEvent/dispatchKeyEvent forward to Input.dispatch* and isClosed() reflects socket state', async () => {
		const srv = await startMockCdpWs()
		try {
			const page = await createCefPage({
				targetInfo: { url: 'https://example.test/y' },
				wsUrl: `ws://127.0.0.1:${srv.port}/devtools/page/f`,
			})
			assert.equal(page.isClosed(), false)
			await page.dispatchMouseEvent({ type: 'mousePressed', x: 1, y: 2, button: 'left', buttons: 1, clickCount: 1 })
			await page.dispatchKeyEvent({ type: 'rawKeyDown', key: 'a' })
			const methods = srv.received.map((m) => m.method)
			assert.ok(methods.includes('Input.dispatchMouseEvent'))
			assert.ok(methods.includes('Input.dispatchKeyEvent'))
			page.close()
			await sleep(50)
			assert.equal(page.isClosed(), true)
		} finally {
			await srv.close()
		}
	})
})
