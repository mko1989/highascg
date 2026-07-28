'use strict'

/**
 * WO-247 — minimal raw Chrome DevTools Protocol (CDP) client over `ws`.
 * Replaces puppeteer-core for CEF interactive input. No event-subscription
 * machinery beyond what's needed: we only send commands and read their
 * replies (Runtime.evaluate / Input.dispatchMouseEvent / Input.dispatchKeyEvent).
 */

const WebSocket = require('ws')

const CDP_COMMAND_TIMEOUT_MS = 5000

/**
 * @typedef {object} CdpSession
 * @property {(method: string, params?: object) => Promise<any>} send
 * @property {(fn: () => void) => void} on
 * @property {() => void} close
 * @property {boolean} connected
 */

/**
 * Open a CDP WebSocket session against a target's `webSocketDebuggerUrl`.
 * @param {string} wsUrl
 * @param {number} [connectTimeoutMs]
 * @returns {Promise<CdpSession>}
 */
function connectCdp(wsUrl, connectTimeoutMs = 5000) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl, { handshakeTimeout: connectTimeoutMs })
		/** @type {Map<number, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
		const pending = new Map()
		/** @type {Set<Function>} */
		const closeListeners = new Set()
		let nextId = 1
		let closed = false
		let settled = false

		const connectTimer = setTimeout(() => {
			if (settled) return
			settled = true
			try {
				ws.terminate()
			} catch (_) {}
			reject(new Error(`CDP connect timeout: ${wsUrl}`))
		}, connectTimeoutMs)

		function failAllPending(err) {
			for (const { reject: rej, timer } of pending.values()) {
				clearTimeout(timer)
				rej(err)
			}
			pending.clear()
		}

		function teardown() {
			if (closed) return
			closed = true
			failAllPending(new Error('CDP session closed'))
			for (const fn of closeListeners) {
				try {
					fn()
				} catch (_) {}
			}
		}

		ws.on('open', () => {
			if (settled) return
			settled = true
			clearTimeout(connectTimer)
			resolve(session)
		})

		ws.on('message', (data) => {
			let msg
			try {
				msg = JSON.parse(String(data))
			} catch (_) {
				return
			}
			if (msg && typeof msg.id === 'number' && pending.has(msg.id)) {
				const { resolve: res, reject: rej, timer } = pending.get(msg.id)
				pending.delete(msg.id)
				clearTimeout(timer)
				if (msg.error) {
					rej(new Error(msg.error.message || 'CDP error'))
				} else {
					res(msg.result)
				}
			}
			// Events (messages without id) are intentionally ignored — this client
			// only correlates command replies.
		})

		ws.on('close', () => {
			teardown()
		})

		ws.on('error', (err) => {
			if (settled) {
				teardown()
				return
			}
			settled = true
			clearTimeout(connectTimer)
			reject(err instanceof Error ? err : new Error(String(err)))
		})

		const session = {
			/**
			 * @param {string} method
			 * @param {object} [params]
			 * @param {{ timeoutMs?: number }} [sendOpts] WO-344: per-command timeout override
			 * @returns {Promise<any>}
			 */
			send(method, params = {}, sendOpts = {}) {
				if (closed || ws.readyState !== WebSocket.OPEN) {
					return Promise.reject(new Error(`CDP session not open (${method})`))
				}
				const id = nextId++
				/* WO-344: 5 s is right for input/DOM commands but not for rendering ones — a
				 * fullscreen raymarching shader screenshots through SwiftShader (no GPU in headless)
				 * in far more than that, and the whole thumbnail failed with
				 * "CDP command timeout: Page.captureScreenshot". Callers that know they are asking
				 * for work can raise it; everything else keeps the 5 s default. */
				const timeoutMs = Number(sendOpts?.timeoutMs) > 0 ? Number(sendOpts.timeoutMs) : CDP_COMMAND_TIMEOUT_MS
				return new Promise((res, rej) => {
					const timer = setTimeout(() => {
						pending.delete(id)
						rej(new Error(`CDP command timeout: ${method} (${timeoutMs}ms)`))
					}, timeoutMs)
					pending.set(id, { resolve: res, reject: rej, timer })
					try {
						ws.send(JSON.stringify({ id, method, params }))
					} catch (err) {
						pending.delete(id)
						clearTimeout(timer)
						rej(err)
					}
				})
			},
			/**
			 * @param {'close'} event
			 * @param {Function} fn
			 */
			on(event, fn) {
				if (event === 'close' && typeof fn === 'function') closeListeners.add(fn)
			},
			close() {
				teardown()
				try {
					ws.close()
				} catch (_) {}
			},
			get connected() {
				return !closed && ws.readyState === WebSocket.OPEN
			},
		}
	})
}

/**
 * Windows virtual-key codes for the keys the bridge forwards (WO-247 T247.3).
 * Unknown keys resolve to 0 — CEF tolerates a zero VK code on char events.
 * @type {Record<string, number>}
 */
const VK_CODE = {
	Enter: 13,
	Escape: 27,
	Backspace: 8,
	Tab: 9,
	' ': 32,
	Space: 32,
	ArrowLeft: 37,
	ArrowUp: 38,
	ArrowRight: 39,
	ArrowDown: 40,
	Home: 36,
	End: 35,
	PageUp: 33,
	PageDown: 34,
	Delete: 46,
	Insert: 45,
	Shift: 16,
	Control: 17,
	Alt: 18,
	Meta: 91,
	',': 188,
	'.': 190,
	'-': 189,
	'=': 187,
	';': 186,
	"'": 222,
	'/': 191,
	'\\': 220,
	'[': 219,
	']': 221,
	'`': 192,
}
for (let i = 0; i < 12; i++) VK_CODE[`F${i + 1}`] = 112 + i

/**
 * @param {string|null} key
 * @returns {number}
 */
function vkCodeForKey(key) {
	if (!key) return 0
	if (Object.prototype.hasOwnProperty.call(VK_CODE, key)) return VK_CODE[key]
	if (key.length === 1) {
		const upper = key.toUpperCase()
		if (upper >= 'A' && upper <= 'Z') return 65 + (upper.charCodeAt(0) - 65)
		if (key >= '0' && key <= '9') return 48 + (key.charCodeAt(0) - 48)
	}
	return 0
}

/**
 * Minimal page-session wrapper over a CDP target's WebSocket, exposing only
 * what the CEF interactive forwarding code needs.
 * @param {{ targetInfo: object, wsUrl: string }} opts
 * @returns {Promise<object>}
 */
async function createCefPage({ targetInfo, wsUrl }) {
	const session = await connectCdp(wsUrl)
	let closed = false
	session.on('close', () => {
		closed = true
	})
	return {
		/** @returns {string} */
		url() {
			return String(targetInfo?.url || '')
		},
		/**
		 * Evaluates a raw expression string (Runtime.evaluate). Also accepts a
		 * function for backward compatibility with call sites that pass a thunk
		 * (e.g. `() => document.body?.focus?.()`); the function is stringified
		 * and invoked in-page as an IIFE.
		 * @param {string|Function} expressionOrFn
		 * @returns {Promise<any>}
		 */
		async evaluate(expressionOrFn) {
			const expression = typeof expressionOrFn === 'function' ? `(${expressionOrFn.toString()})()` : String(expressionOrFn)
			const result = await session.send('Runtime.evaluate', {
				expression,
				returnByValue: true,
				awaitPromise: true,
			})
			if (result?.exceptionDetails) {
				const desc =
					result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate exception'
				throw new Error(desc)
			}
			return result?.result?.value
		},
		/**
		 * @param {object} params
		 */
		dispatchMouseEvent(params) {
			return session.send('Input.dispatchMouseEvent', params)
		},
		/**
		 * @param {object} params
		 */
		dispatchKeyEvent(params) {
			return session.send('Input.dispatchKeyEvent', params)
		},
		close() {
			session.close()
		},
		isClosed() {
			return closed || !session.connected
		},
	}
}

module.exports = {
	connectCdp,
	createCefPage,
	vkCodeForKey,
	VK_CODE,
	CDP_COMMAND_TIMEOUT_MS,
}
