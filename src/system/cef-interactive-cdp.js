'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

/**
 * @param {string} [cfgPath]
 * @returns {number}
 */
function readCefDebugPortFromCasparXml(cfgPath) {
	const p = cfgPath || process.env.HIGHASCG_CASPAR_CONFIG || path.join(REPO_ROOT, 'config', 'casparcg.config')
	if (!fs.existsSync(p)) return 0
	const xml = fs.readFileSync(p, 'utf8')
	const m = xml.match(/<remote-debugging-port>\s*(\d+)\s*<\/remote-debugging-port>/i)
	return m ? parseInt(m[1], 10) || 0 : 0
}

/**
 * @param {number} port
 */
async function fetchCdpTargets(port) {
	const url = `http://127.0.0.1:${port}/json/list`
	const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
	if (!res.ok) throw new Error(`CDP ${url} → HTTP ${res.status}`)
	return res.json()
}

/**
 * @param {number} port
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
async function connectCefBrowser(port) {
	const puppeteer = require('puppeteer-core')
	return puppeteer.connect({
		browserURL: `http://127.0.0.1:${port}`,
		defaultViewport: null,
	})
}

/**
 * @param {string} infoXml
 * @param {number} layer
 * @returns {{ needle: string|null, hasHtml: boolean }}
 */
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

/**
 * @param {string|null} needle
 * @param {string} [playArg]
 * @returns {string[]}
 */
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

/**
 * @param {string} url
 * @param {string|null} needle
 * @param {string} [playArg]
 */
function urlMatchesNeedle(url, needle, playArg) {
	if (!needle && !playArg) return true
	return cefMatchTokens(needle, playArg).some((t) => String(url || '').includes(t))
}

function cefPageCacheKey(needle, playArg) {
	return `${needle || ''}\0${playArg || ''}`
}

/** @type {Map<string, import('puppeteer-core').Page>} */
const stablePageByNeedle = new Map()

function clearStableCefPages() {
	stablePageByNeedle.clear()
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {number} port
 * @returns {Promise<string[]>}
 */
async function listCefPageUrls(port) {
	const targets = await fetchCdpTargets(port)
	return targets.filter((t) => t.type === 'page').map((t) => String(t.url || ''))
}

/**
 * @param {import('puppeteer-core').Browser} browser
 * @param {string|null} needle
 * @param {string} [playArg]
 */
async function pageFromBrowserTargets(browser, needle, playArg) {
	for (const target of browser.targets()) {
		if (target.type() !== 'page') continue
		if (needle || playArg) {
			if (!urlMatchesNeedle(target.url(), needle, playArg)) continue
		}
		const page = await target.page()
		if (page) return page
	}
	return null
}

/**
 * Resolve a CEF page by URL needle; polls briefly when /json/list already lists the target.
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} needle
 * @param {number} [port]
 * @param {number} [timeoutMs]
 */
async function connectCefPageByNeedle(browser, needle, port = 0, timeoutMs = 2000, playArg = null) {
	const t0 = Date.now()
	do {
		const page = await pageFromBrowserTargets(browser, needle, playArg)
		if (page) return page
		if (port > 0) {
			const urls = await listCefPageUrls(port).catch(() => [])
			if (urls.some((u) => urlMatchesNeedle(u, needle, playArg))) {
				try {
					const target = await browser.waitForTarget(
						(t) => t.type() === 'page' && urlMatchesNeedle(t.url(), needle, playArg),
						{ timeout: Math.max(100, timeoutMs - (Date.now() - t0)) },
					)
					const waited = await target.page()
					if (waited) return waited
				} catch (_) {}
			}
		}
		if (timeoutMs <= 0) break
		await sleep(100)
	} while (Date.now() - t0 < timeoutMs)
	return null
}

/**
 * @param {import('puppeteer-core').Browser} browser
 * @param {string|null} needle
 * @param {number} [port]
 */
async function findCefPage(browser, needle, port = 0, playArg = null) {
	if (needle || playArg) {
		const page = await connectCefPageByNeedle(browser, needle, port, 0, playArg)
		if (page) return page
		return null
	}
	for (const page of await browser.pages()) {
		const u = page.url()
		if (/^https?:\/\//i.test(u)) return page
	}
	const pages = await browser.pages()
	return pages.length ? pages[pages.length - 1] : null
}

/**
 * Map root/window-local pointer position to CEF viewport pixels.
 */
function mapPointToCef(zone, localX, localY, cefWidth, cefHeight) {
	const zx = Math.max(0, Math.min(zone.width - 1, localX))
	const zy = Math.max(0, Math.min(zone.height - 1, localY))
	const x = Math.round((zx / Math.max(1, zone.width)) * Math.max(1, cefWidth - 1))
	const y = Math.round((zy / Math.max(1, zone.height)) * Math.max(1, cefHeight - 1))
	return { x, y }
}

/**
 * @param {import('puppeteer-core').Browser} browser
 * @param {string|null} needle
 * @param {number} [port]
 */
async function resolveStableCefPage(browser, needle, port = 0, playArg = null) {
	const key = cefPageCacheKey(needle, playArg)
	let page = stablePageByNeedle.get(key)
	if (page) {
		try {
			await page.evaluate(() => 1)
			const u = page.url()
			if (urlMatchesNeedle(u, needle, playArg)) return page
			stablePageByNeedle.delete(key)
		} catch {
			stablePageByNeedle.delete(key)
		}
	}
	page = await findCefPage(browser, needle, port, playArg)
	if (!page && needle && port > 0) {
		page = await connectCefPageByNeedle(browser, needle, port, 1500, playArg)
	}
	if (!page) return null
	const u = page.url()
	if ((needle || playArg) && !urlMatchesNeedle(u, needle, playArg)) return null
	stablePageByNeedle.set(key, page)
	return page
}

/**
 * Proactively connect CDP and cache the page for the configured needle.
 * @param {import('puppeteer-core').Browser|null} browser
 * @param {string|null} needle
 * @param {number} port
 * @param {number} [timeoutMs]
 */
async function warmCefPage(browser, needle, port, timeoutMs = 3000, playArg = null) {
	if (!browser || (!needle && !playArg) || port <= 0) return null
	let page = await pageFromBrowserTargets(browser, needle, playArg)
	if (!page) page = await connectCefPageByNeedle(browser, needle, port, timeoutMs, playArg)
	if (!page || !urlMatchesNeedle(page.url(), needle, playArg)) return null
	stablePageByNeedle.set(cefPageCacheKey(needle, playArg), page)
	return page
}

/**
 * @param {import('puppeteer-core').Page} page
 * @param {'mousedown'|'mouseup'|'mousemove'} type
 * @param {number} x
 * @param {number} y
 * @param {number} [button=1]
 */
async function forwardMouseEvent(page, type, x, y, button = 1) {
	if (type === 'mousemove') {
		await page.mouse.move(x, y)
		return
	}
	// Left click: one mouse.click on mouseup — puppeteer Page refs from browser.pages()
	// are not stable across events, so split down/up hits "'left' is not pressed".
	if (button === 1 && type === 'mouseup') {
		await page.mouse.click(x, y)
		return
	}
	if (button === 1 && type === 'mousedown') {
		return
	}
	if (type === 'mousedown') {
		await page.mouse.move(x, y)
		await page.mouse.down({ button: button === 3 ? 'right' : button === 2 ? 'middle' : 'left' })
		return
	}
	if (type === 'mouseup') {
		await page.mouse.move(x, y)
		await page.mouse.up({ button: button === 3 ? 'right' : button === 2 ? 'middle' : 'left' })
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

/**
 * @param {number} keysym
 */
function isModifierKeysym(keysym) {
	return MODIFIER_KEYSYMS.has(keysym)
}

/**
 * @param {number} keysym
 * @returns {string|null}
 */
function keysymToModifierName(keysym) {
	return KEYSYM_TO_MODIFIER[keysym] || null
}

/**
 * @param {string[]|undefined} mods
 * @returns {string[]}
 */
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

/**
 * @param {import('puppeteer-core').Page} page
 * @param {string[]} modifiers
 */
async function ensureModifiersDown(page, modifiers) {
	for (const m of normalizeModifierList(modifiers)) {
		if (heldModifiers.has(m)) continue
		await page.keyboard.down(m)
		heldModifiers.add(m)
	}
}

/**
 * @param {import('puppeteer-core').Page} page
 * @param {string} modName
 */
async function releaseModifier(page, modName) {
	if (!heldModifiers.has(modName)) return
	await page.keyboard.up(modName)
	heldModifiers.delete(modName)
}

/**
 * @param {number} keysym
 * @returns {string|null}
 */
function keysymToKey(keysym) {
	if (KEYSYM_TO_KEY[keysym]) return KEYSYM_TO_KEY[keysym]
	if (keysym >= 0x20 && keysym <= 0x7e) return String.fromCharCode(keysym)
	return null
}

/**
 * @param {number} keysym
 * @returns {string}
 */
function keysymToText(keysym) {
	if (keysym >= 0x20 && keysym <= 0x7e) return String.fromCharCode(keysym)
	return ''
}

/**
 * @param {import('puppeteer-core').Page} page
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
		if (modName) {
			await ensureModifiersDown(page, eventMods)
			if (!heldModifiers.has(modName)) {
				await page.keyboard.down(key)
				heldModifiers.add(modName)
			}
			return
		}
		await ensureModifiersDown(page, eventMods)
		const ch = text || keysymToText(keysym)
		const printable = ch.length === 1 && ch >= ' ' && ch <= '~'
		const hasMods = heldModifiers.size > 0 || eventMods.length > 0
		if (printable && key.length === 1 && !hasMods) {
			await page.keyboard.type(ch)
			return
		}
		await page.keyboard.down(key)
		return
	}

	if (modName) {
		await releaseModifier(page, modName)
		return
	}
	const ch = text || keysymToText(keysym)
	const printable = ch.length === 1 && ch >= ' ' && ch <= '~'
	if (printable && key.length === 1 && heldModifiers.size === 0) return
	await page.keyboard.up(key)
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
