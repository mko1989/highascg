'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { createCefPage, vkCodeForKey } = require('./cef-cdp-client')

/**
 * @typedef {{ port: number, connected: boolean, disconnect: () => Promise<void> }} CefBrowserHandle
 */
/** @typedef {import('./cef-cdp-client').CefPage} CefPage */

/** @param {string} [cfgPath] @returns {number} */
function readCefDebugPortFromCasparXml(cfgPath) {
	const p = cfgPath || process.env.HIGHASCG_CASPAR_CONFIG || path.join(REPO_ROOT, 'config', 'casparcg.config')
	if (!fs.existsSync(p)) return 0
	const xml = fs.readFileSync(p, 'utf8')
	const m = xml.match(/<remote-debugging-port>\s*(\d+)\s*<\/remote-debugging-port>/i)
	return m ? parseInt(m[1], 10) || 0 : 0
}

/** @param {number} port */
async function fetchCdpTargets(port) {
	const url = `http://127.0.0.1:${port}/json/list`
	const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
	if (!res.ok) throw new Error(`CDP ${url} → HTTP ${res.status}`)
	return res.json()
}

/**
 * WO-247: raw-CDP replacement for `puppeteer.connect({ browserURL })`. No
 * persistent browser-level socket — each resolved page owns its own WS
 * (cef-cdp-client.js). Verifies the port is reachable, matching
 * puppeteer.connect()'s failure mode when the browser endpoint is down.
 * @param {number} port
 * @returns {Promise<CefBrowserHandle>}
 */
async function connectCefBrowser(port) {
	await fetchCdpTargets(port)
	const handle = {
		port,
		connected: true,
		disconnect() {
			handle.connected = false
			return Promise.resolve()
		},
	}
	return handle
}

/** @param {string} infoXml @param {number} layer @returns {{ needle: string|null, hasHtml: boolean }} */
function htmlNeedleFromInfoXml(infoXml, layer) {
	if (!infoXml || typeof infoXml !== 'string') return { needle: null, hasHtml: false }
	const blockRe = new RegExp(`<layer_${layer}>[\\s\\S]*?</layer_${layer}>`, 'i')
	const block = infoXml.match(blockRe)?.[0] || ''
	const fg = block.match(/<foreground>[\s\S]*?<\/foreground>/i)?.[0] || block
	if (!/<producer>\s*html\s*<\/producer>/i.test(fg)) return { needle: null, hasHtml: false }
	const pathM = fg.match(/<path>([^<]+)<\/path>/i)
	if (!pathM) return { needle: null, hasHtml: true }
	const raw = String(pathM[1] || '').trim()
	const base = raw.split(/[/\\]/).pop() || raw
	const needle = base.replace(/\.html$/i, '') || raw
	return { needle: needle || null, hasHtml: true }
}

/** @param {string|null} needle @param {string} [playArg] @returns {string[]} */
function cefMatchTokens(needle, playArg) {
	const tokens = new Set()
	const n = String(needle || '').trim()
	if (n) tokens.add(n)
	const raw = String(playArg || '').trim()
	if (raw) {
		tokens.add(raw)
		if (/^https?:\/\//i.test(raw)) {
			try {
				const u = new URL(raw)
				if (u.hostname) tokens.add(u.hostname)
				if (u.host) tokens.add(u.host)
			} catch (_) {}
		}
	}
	// Legacy slug needles (https_highascg_dpdns_org) → dotted host guess
	if (n.includes('_')) {
		const parts = n.split('_').filter((p) => p && p !== 'http' && p !== 'https' && p !== 'www')
		if (parts.length >= 2) tokens.add(parts.join('.'))
	}
	return [...tokens]
}

/** @param {string} url @param {string|null} needle @param {string} [playArg] */
function urlMatchesNeedle(url, needle, playArg) {
	if (!needle && !playArg) return true
	return cefMatchTokens(needle, playArg).some((t) => String(url || '').includes(t))
}

function cefPageCacheKey(needle, playArg) {
	return `${needle || ''}\0${playArg || ''}`
}

/** @type {Map<string, CefPage>} */
const stablePageByNeedle = new Map()

function clearStableCefPages() {
	stablePageByNeedle.clear()
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

/** @param {number} port @returns {Promise<string[]>} */
async function listCefPageUrls(port) {
	const targets = await fetchCdpTargets(port)
	return targets.filter((t) => t.type === 'page').map((t) => String(t.url || ''))
}

/**
 * Resolve one CDP page target from a fresh `/json/list` fetch, optionally
 * filtered by needle/playArg. Replaces puppeteer's `browser.targets()`.
 * @param {CefBrowserHandle} browser @param {string|null} needle @param {string} [playArg] @returns {Promise<CefPage|null>}
 */
async function pageFromBrowserTargets(browser, needle, playArg) {
	const targets = await fetchCdpTargets(browser.port).catch(() => [])
	for (const t of targets) {
		if (t.type !== 'page') continue
		if ((needle || playArg) && !urlMatchesNeedle(t.url, needle, playArg)) continue
		if (!t.webSocketDebuggerUrl) continue
		try {
			return await createCefPage({ targetInfo: t, wsUrl: t.webSocketDebuggerUrl })
		} catch (_) {
			continue
		}
	}
	return null
}

/**
 * Resolve a CEF page by URL needle; polls briefly against a live `/json/list`
 * each iteration (no puppeteer target-cache-freshness workaround needed —
 * every poll is a fresh HTTP fetch).
 * @param {CefBrowserHandle} browser @param {string} needle @param {number} [port] @param {number} [timeoutMs]
 */
async function connectCefPageByNeedle(browser, needle, port = 0, timeoutMs = 2000, playArg = null) {
	const t0 = Date.now()
	do {
		const page = await pageFromBrowserTargets(browser, needle, playArg)
		if (page) return page
		if (timeoutMs <= 0) break
		await sleep(100)
	} while (Date.now() - t0 < timeoutMs)
	return null
}

/** @param {CefBrowserHandle} browser @param {string|null} needle @param {number} [port] */
async function findCefPage(browser, needle, port = 0, playArg = null) {
	if (needle || playArg) return connectCefPageByNeedle(browser, needle, port, 0, playArg)
	const targets = (await fetchCdpTargets(browser.port).catch(() => [])).filter(
		(t) => t.type === 'page' && t.webSocketDebuggerUrl,
	)
	const httpTarget = targets.find((t) => /^https?:\/\//i.test(String(t.url || '')))
	const pick = httpTarget || targets[targets.length - 1]
	if (!pick) return null
	try {
		return await createCefPage({ targetInfo: pick, wsUrl: pick.webSocketDebuggerUrl })
	} catch (_) {
		return null
	}
}

/** Map root/window-local pointer position to CEF viewport pixels. */
function mapPointToCef(zone, localX, localY, cefWidth, cefHeight) {
	const zx = Math.max(0, Math.min(zone.width - 1, localX))
	const zy = Math.max(0, Math.min(zone.height - 1, localY))
	const x = Math.round((zx / Math.max(1, zone.width)) * Math.max(1, cefWidth - 1))
	const y = Math.round((zy / Math.max(1, zone.height)) * Math.max(1, cefHeight - 1))
	return { x, y }
}

/** @param {CefBrowserHandle} browser @param {string|null} needle @param {number} [port] */
async function resolveStableCefPage(browser, needle, port = 0, playArg = null) {
	const key = cefPageCacheKey(needle, playArg)
	let page = stablePageByNeedle.get(key)
	if (page) {
		if (typeof page.isClosed === 'function' && page.isClosed()) {
			stablePageByNeedle.delete(key)
		} else {
			try {
				await page.evaluate('1')
				if (urlMatchesNeedle(page.url(), needle, playArg)) return page
				stablePageByNeedle.delete(key)
			} catch {
				stablePageByNeedle.delete(key)
			}
		}
	}
	page = await findCefPage(browser, needle, port, playArg)
	if (!page && needle && port > 0) {
		page = await connectCefPageByNeedle(browser, needle, port, 1500, playArg)
	}
	if (!page) return null
	if ((needle || playArg) && !urlMatchesNeedle(page.url(), needle, playArg)) return null
	stablePageByNeedle.set(key, page)
	return page
}

/**
 * Proactively connect CDP and cache the page for the configured needle.
 * @param {CefBrowserHandle|null} browser @param {string|null} needle @param {number} port @param {number} [timeoutMs]
 */
async function warmCefPage(browser, needle, port, timeoutMs = 3000, playArg = null) {
	if (!browser || (!needle && !playArg) || port <= 0) return null
	let page = await pageFromBrowserTargets(browser, needle, playArg)
	if (!page) page = await connectCefPageByNeedle(browser, needle, port, timeoutMs, playArg)
	if (!page || !urlMatchesNeedle(page.url(), needle, playArg)) return null
	stablePageByNeedle.set(cefPageCacheKey(needle, playArg), page)
	return page
}

/** @type {Record<'left'|'right'|'middle', number>} */
const MOUSE_BUTTON_BIT = { left: 1, right: 2, middle: 4 }

/** Currently-pressed mouse buttons bitmask (module-level: mirrors the single
 * active CEF pointer target, same convention as `heldModifiers` below). */
let mouseButtonsBitmask = 0

/** @param {number} button @returns {'left'|'middle'|'right'} */
function mouseButtonName(button) {
	return button === 3 ? 'right' : button === 2 ? 'middle' : 'left'
}

/** @param {number} mask @returns {'left'|'right'|'middle'|'none'} */
function activeButtonName(mask) {
	if (mask & MOUSE_BUTTON_BIT.left) return 'left'
	if (mask & MOUSE_BUTTON_BIT.right) return 'right'
	if (mask & MOUSE_BUTTON_BIT.middle) return 'middle'
	return 'none'
}

/** @param {CefPage} page @param {string} type CDP Input.dispatchMouseEvent type @param {number} x @param {number} y @param {object} extra */
function dispatchMouse(page, type, x, y, extra) {
	return page.dispatchMouseEvent({ type, x, y, ...extra })
}

/**
 * @param {CefPage} page
 * @param {'mousedown'|'mouseup'|'mousemove'} type
 * @param {number} x
 * @param {number} y
 * @param {number} [button=1]
 */
async function forwardMouseEvent(page, type, x, y, button = 1) {
	const buttonName = mouseButtonName(button)
	const bit = MOUSE_BUTTON_BIT[buttonName]
	if (type === 'mousedown') {
		mouseButtonsBitmask |= bit
		await dispatchMouse(page, 'mousePressed', x, y, { button: buttonName, buttons: mouseButtonsBitmask, clickCount: 1 })
		return
	}
	if (type === 'mouseup') {
		await dispatchMouse(page, 'mouseReleased', x, y, { button: buttonName, buttons: mouseButtonsBitmask, clickCount: 1 })
		mouseButtonsBitmask &= ~bit
		return
	}
	if (type === 'mousemove') {
		// Drag: report whatever buttons are currently held (set by prior
		// mousedown/mouseup calls) — not the button param passed for this move.
		await dispatchMouse(page, 'mouseMoved', x, y, { button: activeButtonName(mouseButtonsBitmask), buttons: mouseButtonsBitmask })
	}
}

/** @type {Record<number, string>} */
const KEYSYM_TO_KEY = {
	65293: 'Enter',
	65307: 'Escape',
	65288: 'Backspace',
	65505: 'Shift',
	65506: 'Shift',
	65507: 'Control',
	65508: 'Alt',
	65513: 'Meta',
	65514: 'Meta',
	65361: 'ArrowLeft',
	65362: 'ArrowUp',
	65363: 'ArrowRight',
	65364: 'ArrowDown',
	65360: 'Home',
	65367: 'End',
	65365: 'PageUp',
	65366: 'PageDown',
	65535: 'Delete',
	65289: 'Tab',
	32: ' ',
}

/** @type {Set<string>} */
const heldModifiers = new Set()

const MODIFIER_KEYSYMS = new Set([65505, 65506, 65507, 65508, 65513, 65514])

/** @type {Record<number, string>} */
const KEYSYM_TO_MODIFIER = {
	65505: 'Shift',
	65506: 'Shift',
	65507: 'Control',
	65508: 'Alt',
	65513: 'Meta',
	65514: 'Meta',
}

/** @type {Record<'Alt'|'Control'|'Meta'|'Shift', number>} CDP modifiers bitmask */
const MODIFIER_BIT = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }

/** @param {number} keysym */
function isModifierKeysym(keysym) {
	return MODIFIER_KEYSYMS.has(keysym)
}

/** @param {number} keysym @returns {string|null} */
function keysymToModifierName(keysym) {
	return KEYSYM_TO_MODIFIER[keysym] || null
}

/** @param {string[]|undefined} mods @returns {string[]} */
function normalizeModifierList(mods) {
	if (!Array.isArray(mods)) return []
	const order = ['Control', 'Alt', 'Shift', 'Meta']
	const set = new Set()
	for (const raw of mods) {
		const m = String(raw || '').trim()
		if (m === 'Ctrl') set.add('Control')
		else if (m === 'Cmd' || m === 'Command') set.add('Meta')
		else if (order.includes(m)) set.add(m)
	}
	return order.filter((m) => set.has(m))
}

function resetKeyboardModifierState() {
	heldModifiers.clear()
}

/** @returns {number} CDP modifiers bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8) for the currently-held modifiers. */
function currentModifiersBitmask() {
	let mask = 0
	for (const name of heldModifiers) mask |= MODIFIER_BIT[name] || 0
	return mask
}

/** @param {CefPage} page @param {string} type CDP Input.dispatchKeyEvent type @param {string} key @param {object} [extra] */
function dispatchKey(page, type, key, extra = {}) {
	const vk = vkCodeForKey(key)
	return page.dispatchKeyEvent({
		type,
		key,
		windowsVirtualKeyCode: vk,
		nativeVirtualKeyCode: vk,
		modifiers: currentModifiersBitmask(),
		...extra,
	})
}

/** @param {CefPage} page @param {string[]} modifiers */
async function ensureModifiersDown(page, modifiers) {
	for (const m of normalizeModifierList(modifiers)) {
		if (heldModifiers.has(m)) continue
		heldModifiers.add(m)
		await dispatchKey(page, 'rawKeyDown', m)
	}
}

/** @param {CefPage} page @param {string} modName */
async function releaseModifier(page, modName) {
	if (!heldModifiers.has(modName)) return
	heldModifiers.delete(modName)
	await dispatchKey(page, 'keyUp', modName)
}

/** @param {number} keysym @returns {string|null} */
function keysymToKey(keysym) {
	if (KEYSYM_TO_KEY[keysym]) return KEYSYM_TO_KEY[keysym]
	if (keysym >= 0x20 && keysym <= 0x7e) return String.fromCharCode(keysym)
	return null
}

/** @param {number} keysym @returns {string} */
function keysymToText(keysym) {
	if (keysym >= 0x20 && keysym <= 0x7e) return String.fromCharCode(keysym)
	return ''
}

/**
 * @param {CefPage} page
 * @param {'keydown'|'keyup'} type
 * @param {number} keysym
 * @param {string} [text]
 * @param {{ modifiers?: string[] }} [opts]
 */
async function forwardKeyEvent(page, type, keysym, text, opts = {}) {
	const key = keysymToKey(keysym)
	if (!key) return
	const modName = keysymToModifierName(keysym)
	const eventMods = normalizeModifierList(opts.modifiers)

	if (type === 'keydown') {
		await ensureModifiersDown(page, eventMods)
		if (modName) {
			if (!heldModifiers.has(modName)) {
				heldModifiers.add(modName)
				await dispatchKey(page, 'rawKeyDown', key)
			}
			return
		}
		const base = keysymToText(keysym)
		const ch = text || base
		const printable = ch.length === 1 && ch >= ' ' && ch <= '~'
		await dispatchKey(page, 'rawKeyDown', key)
		if (printable) {
			await dispatchKey(page, 'char', key, { text: ch, unmodifiedText: base || ch })
		}
		return
	}

	// keyup
	if (modName) {
		await releaseModifier(page, modName)
		return
	}
	await dispatchKey(page, 'keyUp', key)
}

module.exports = {
	readCefDebugPortFromCasparXml,
	fetchCdpTargets,
	connectCefBrowser,
	htmlNeedleFromInfoXml,
	findCefPage,
	urlMatchesNeedle,
	cefMatchTokens,
	cefPageCacheKey,
	listCefPageUrls,
	connectCefPageByNeedle,
	resolveStableCefPage,
	warmCefPage,
	clearStableCefPages,
	mapPointToCef,
	forwardMouseEvent,
	forwardKeyEvent,
	keysymToKey,
	keysymToText,
	isModifierKeysym,
	keysymToModifierName,
	normalizeModifierList,
	resetKeyboardModifierState,
}
