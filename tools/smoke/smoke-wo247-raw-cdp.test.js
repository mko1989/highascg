'use strict'

/**
 * WO-247 T247.5 — offline smoke for the raw-CDP client that replaced
 * puppeteer-core for CEF interactive input.
 *
 * Everything binds to 127.0.0.1 on ephemeral (port 0) ports inside this
 * file: a mock CDP WebSocket target + a tiny HTTP `/json/list` responder.
 * No connection to the real Caspar remote-debugging port, no AMCP, no
 * live server.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const WebSocket = require('ws')

const { connectCdp, createCefPage } = require('../../src/system/cef-cdp-client')
const {
	connectCefBrowser,
	resolveStableCefPage,
	clearStableCefPages,
	forwardMouseEvent,
	forwardKeyEvent,
	keysymToText,
	resetKeyboardModifierState,
} = require('../../src/system/cef-interactive-cdp')

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

/**
 * Tiny HTTP `/json/list` responder standing in for CEF's DevTools target list.
 * @param {() => object[]} listTargets
 */
function startMockJsonListHttp(listTargets) {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			if (req.url === '/json/list') {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify(listTargets()))
				return
			}
			res.writeHead(404)
			res.end()
		})
		server.on('error', reject)
		server.listen(0, '127.0.0.1', () => {
			resolve({
				port: server.address().port,
				close: () =>
					new Promise((r) => {
						// fetch() keeps HTTP/1.1 connections alive by default; force them
						// shut so server.close()'s callback isn't stuck waiting forever.
						if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
						server.close(() => r(undefined))
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

describe('cef-interactive-cdp: forwardKeyEvent CDP payloads', () => {
	/** @returns {{ calls: object[], dispatchKeyEvent: Function, dispatchMouseEvent: Function, url: Function, evaluate: Function, isClosed: Function }} */
	function makeFakePage() {
		const calls = []
		return {
			calls,
			async dispatchKeyEvent(params) {
				calls.push(params)
			},
			async dispatchMouseEvent(params) {
				calls.push(params)
			},
			url: () => 'https://example.test/fake',
			evaluate: async () => 1,
			isClosed: () => false,
		}
	}

	it("keydown of 'a' (keysym 97) with Shift held: rawKeyDown(vk=65, modifiers=8) then char (text matches caller-supplied text, unmodifiedText from keysymToText)", async () => {
		resetKeyboardModifierState()
		const page = makeFakePage()
		const base = keysymToText(97) // verify against the real function rather than assuming 'a'
		assert.equal(base, 'a')
		await forwardKeyEvent(page, 'keydown', 97, 'A', { modifiers: ['Shift'] })

		// [0] Shift itself goes down first (ensureModifiersDown)
		assert.equal(page.calls[0].type, 'rawKeyDown')
		assert.equal(page.calls[0].key, 'Shift')
		assert.equal(page.calls[0].modifiers, 8)

		// [1] rawKeyDown for the 'a' key, VK code 65 regardless of case, Shift bit set
		const rawKeyDown = page.calls[1]
		assert.equal(rawKeyDown.type, 'rawKeyDown')
		assert.equal(rawKeyDown.key, 'a')
		assert.equal(rawKeyDown.windowsVirtualKeyCode, 65)
		assert.equal(rawKeyDown.nativeVirtualKeyCode, 65)
		assert.equal(rawKeyDown.modifiers, 8)

		// [2] char event carries the actual (shifted) text plus the unshifted base
		const charEv = page.calls[2]
		assert.equal(charEv.type, 'char')
		assert.equal(charEv.text, 'A')
		assert.equal(charEv.unmodifiedText, base)
		assert.equal(charEv.windowsVirtualKeyCode, 65)
		assert.equal(charEv.modifiers, 8)

		// keyup of Shift releases the modifier and reports modifiers=0 afterward
		await forwardKeyEvent(page, 'keyup', 65505, undefined, {})
		const shiftUp = page.calls[3]
		assert.equal(shiftUp.type, 'keyUp')
		assert.equal(shiftUp.key, 'Shift')
		assert.equal(shiftUp.modifiers, 0)
	})

	it('plain keydown/keyup of an unmodified key sends rawKeyDown+char then keyUp', async () => {
		resetKeyboardModifierState()
		const page = makeFakePage()
		await forwardKeyEvent(page, 'keydown', 98 /* 'b' */, undefined, {})
		assert.deepEqual(
			page.calls.map((c) => c.type),
			['rawKeyDown', 'char'],
		)
		assert.equal(page.calls[0].windowsVirtualKeyCode, 66)
		assert.equal(page.calls[1].text, 'b')
		await forwardKeyEvent(page, 'keyup', 98, undefined, {})
		assert.equal(page.calls[2].type, 'keyUp')
		assert.equal(page.calls[2].windowsVirtualKeyCode, 66)
	})

	it('non-printable key (Enter) sends rawKeyDown with no char event', async () => {
		resetKeyboardModifierState()
		const page = makeFakePage()
		await forwardKeyEvent(page, 'keydown', 65293 /* Enter */, undefined, {})
		assert.deepEqual(
			page.calls.map((c) => c.type),
			['rawKeyDown'],
		)
		assert.equal(page.calls[0].windowsVirtualKeyCode, 13)
	})
})

describe('cef-interactive-cdp: forwardMouseEvent CDP payloads (drag/buttons bitmask)', () => {
	it('button 1 press/move/release: left button, buttons bitmask tracks the held button across mousemove', async () => {
		const calls = []
		const page = { async dispatchMouseEvent(params) { calls.push(params) } }

		await forwardMouseEvent(page, 'mousedown', 10, 20, 1)
		assert.deepEqual(calls[0], { type: 'mousePressed', x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1 })

		await forwardMouseEvent(page, 'mousemove', 15, 25, 1)
		assert.deepEqual(calls[1], { type: 'mouseMoved', x: 15, y: 25, button: 'left', buttons: 1 })

		await forwardMouseEvent(page, 'mouseup', 15, 25, 1)
		assert.deepEqual(calls[2], { type: 'mouseReleased', x: 15, y: 25, button: 'left', buttons: 1, clickCount: 1 })

		// button released — a follow-up move reports no buttons held
		await forwardMouseEvent(page, 'mousemove', 16, 26, 1)
		assert.deepEqual(calls[3], { type: 'mouseMoved', x: 16, y: 26, button: 'none', buttons: 0 })
	})

	it('button 3 (right) maps to CDP "right" with its own bitmask bit', async () => {
		const calls = []
		const page = { async dispatchMouseEvent(params) { calls.push(params) } }
		await forwardMouseEvent(page, 'mousedown', 1, 1, 3)
		assert.equal(calls[0].button, 'right')
		assert.equal(calls[0].buttons, 2)
		await forwardMouseEvent(page, 'mouseup', 1, 1, 3)
		assert.equal(calls[1].button, 'right')
	})
})

describe('cef-interactive-cdp: stable page cache eviction on a dead WS', () => {
	after(() => clearStableCefPages())

	it('caches a resolved page, then evicts + re-resolves after the underlying socket dies', async () => {
		const needleUrl = 'https://example.test/mario-cache'
		const cdpWs = await startMockCdpWs()
		let targets = [
			{
				id: 't1',
				type: 'page',
				url: needleUrl,
				webSocketDebuggerUrl: `ws://127.0.0.1:${cdpWs.port}/devtools/page/t1`,
			},
		]
		const jsonList = await startMockJsonListHttp(() => targets)
		try {
			clearStableCefPages()
			const browser = await connectCefBrowser(jsonList.port)
			assert.equal(browser.connected, true)

			const page1 = await resolveStableCefPage(browser, 'mario-cache', jsonList.port)
			assert.ok(page1)
			assert.equal(await page1.evaluate('1+1'), 2)

			const page1Again = await resolveStableCefPage(browser, 'mario-cache', jsonList.port)
			assert.equal(page1Again, page1, 'expected the stable-page cache to return the same session')

			// Kill the target's socket server-side to simulate a dead WS.
			for (const sock of cdpWs.sockets) sock.terminate()
			await sleep(100)

			const page2 = await resolveStableCefPage(browser, 'mario-cache', jsonList.port)
			assert.ok(page2)
			assert.notEqual(page2, page1, 'expected cache eviction + re-resolve, not a throw')
			assert.equal(await page2.evaluate('2+2'), 4)
		} finally {
			await jsonList.close()
			await cdpWs.close()
		}
	})
})
