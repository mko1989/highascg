'use strict'

/**
 * Live spike: can Caspar CEF receive mouse/keyboard via CDP (remote-debugging-port)?
 *
 * Requires:
 *   - Caspar running with <remote-debugging-port> set in casparcg.config (not 0)
 *   - puppeteer (production dep)
 *
 * Channel/layer: resolved from routing map unless overridden:
 *   HIGHASCG_CEF_TEST_CHANNEL  — explicit Caspar channel (optional)
 *   HIGHASCG_CEF_TEST_LAYER    — layer (default 999)
 *   HIGHASCG_CEF_DEBUG_PORT    — CDP port (default 9222)
 *   HIGHASCG_CEF_TEST_HOLD_MS  — pause before CLEAR so multiview can be watched (default 0)
 *
 * Run: node --test tools/smoke/smoke-cef-cdp-input.live.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { ConnectionManager } = require('../../src/caspar/connection-manager')
const { ConfigManager } = require('../../src/config/config-manager')
const { getChannelMap } = require('../../src/config/routing')
const { REPO_ROOT } = require('../../src/repo-paths')

const CASPAR_HOST = process.env.HIGHASCG_CASPAR_HOST || process.env.CASPAR_HOST || '127.0.0.1'
const CASPAR_PORT = Number.parseInt(process.env.HIGHASCG_CASPAR_PORT || process.env.CASPAR_PORT || '5250', 10)
const CEF_DEBUG_PORT = Number.parseInt(process.env.HIGHASCG_CEF_DEBUG_PORT || '9222', 10)
const TEST_TEMPLATE = 'interactive_click_test'
const TEST_HTML_PATH = path.join(REPO_ROOT, 'template', `${TEST_TEMPLATE}.html`)

function readCefDebugPortFromCasparXml() {
	const cfgPath = process.env.HIGHASCG_CASPAR_CONFIG || path.join(REPO_ROOT, 'config', 'casparcg.config')
	if (!fs.existsSync(cfgPath)) return 0
	const xml = fs.readFileSync(cfgPath, 'utf8')
	const m = xml.match(/<remote-debugging-port>\s*(\d+)\s*<\/remote-debugging-port>/i)
	return m ? parseInt(m[1], 10) || 0 : 0
}

async function loadAppConfig() {
	const configDir = process.env.HIGHASCG_CONFIG_PATH || path.join(REPO_ROOT, 'config')
	const cm = new ConfigManager(configDir, { info() {}, warn() {}, error() {} })
	cm.load()
	return cm.get()
}

/**
 * @param {object} config
 * @returns {number|null}
 */
function resolveTestChannel(config) {
	const forced = parseInt(String(process.env.HIGHASCG_CEF_TEST_CHANNEL || ''), 10)
	if (Number.isFinite(forced) && forced >= 1) return forced
	const map = getChannelMap(config)
	if (map.multiviewCh != null) return map.multiviewCh
	const mvList = Array.isArray(map.multiviewChannels) ? map.multiviewChannels : []
	if (mvList.length > 0 && mvList[0] != null) return mvList[0]
	return null
}

function resolveTestLayer() {
	const n = parseInt(String(process.env.HIGHASCG_CEF_TEST_LAYER || '999'), 10)
	return Number.isFinite(n) && n >= 0 ? n : 999
}

/**
 * @param {number} timeoutMs
 */
function connectCaspar(timeoutMs) {
	const cm = new ConnectionManager({
		host: CASPAR_HOST,
		port: CASPAR_PORT,
		config: {},
		log() {},
		healthIntervalMs: 0,
		healthConnectDelayMs: 0,
	})
	return new Promise((resolve, reject) => {
		const to = setTimeout(() => {
			cm.stop()
			reject(new Error(`AMCP timeout ${CASPAR_HOST}:${CASPAR_PORT}`))
		}, timeoutMs)
		const onErr = (e) => {
			clearTimeout(to)
			cm.off('status', onStatus)
			cm.off('error', onErr)
			cm.stop()
			reject(e)
		}
		const onStatus = (p) => {
			if (p.connected) {
				clearTimeout(to)
				cm.off('status', onStatus)
				cm.off('error', onErr)
				resolve(cm)
			}
		}
		cm.on('status', onStatus)
		cm.on('error', onErr)
		cm.start()
	})
}

async function fetchCdpTargets(port) {
	const url = `http://127.0.0.1:${port}/json/list`
	const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
	if (!res.ok) throw new Error(`CDP ${url} → HTTP ${res.status}`)
	return res.json()
}

/**
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} needle
 */
async function findPageByUrlFragment(browser, needle) {
	const pages = await browser.pages()
	for (const page of pages) {
		const u = page.url()
		if (u.includes(needle)) return page
	}
	for (const page of pages) {
		const u = page.url()
		if (u.includes(TEST_TEMPLATE) || u.includes('interactive_click')) return page
	}
	return null
}

test('CEF CDP: mouse + keyboard reach embedded HTML producer', async (t) => {
	if (!fs.existsSync(TEST_HTML_PATH)) {
		t.skip(`missing ${TEST_HTML_PATH}`)
		return
	}

	const xmlPort = readCefDebugPortFromCasparXml()
	const debugPort = xmlPort > 0 ? xmlPort : CEF_DEBUG_PORT
	if (xmlPort <= 0) {
		t.skip(
			`Caspar <remote-debugging-port> is 0 or missing in casparcg.config — set e.g. 9222 and restart casparcg-server before this test`,
		)
		return
	}

	let targets
	try {
		targets = await fetchCdpTargets(debugPort)
	} catch (e) {
		t.skip(`CDP not reachable on port ${debugPort} (${e?.message || e}) — is Caspar restarted after enabling remote-debugging-port?`)
		return
	}
	assert.ok(Array.isArray(targets), 'CDP /json/list should return an array')

	const config = await loadAppConfig()
	const channel = resolveTestChannel(config)
	const layer = resolveTestLayer()
	if (channel == null) {
		t.skip('no multiview channel in routing map — set HIGHASCG_CEF_TEST_CHANNEL or enable multiview in config')
		return
	}

	t.diagnostic(`using channel=${channel} layer=${layer} (from routing map / env, not hardcoded)`)

	const caspar = await connectCaspar(12_000)
	let browser = null
	try {
		await caspar.amcp.raw(`CLEAR ${channel}-${layer}`)
		const play = await caspar.amcp.raw(`PLAY ${channel}-${layer} [HTML] ${TEST_TEMPLATE}`)
		const playLine = String(play?.data ?? play?.raw ?? '')
		assert.match(playLine, /202|PLAY OK/i, `PLAY failed: ${playLine}`)
		await caspar.amcp.raw(`MIXER ${channel}-${layer} FILL 0 0 1 1`)
		await caspar.amcp.raw(`MIXER ${channel} COMMIT`)

		await new Promise((r) => setTimeout(r, 2500))

		const puppeteer = require('puppeteer-core')
		browser = await puppeteer.connect({
			browserURL: `http://127.0.0.1:${debugPort}`,
			defaultViewport: null,
		})

		let page = await findPageByUrlFragment(browser, TEST_TEMPLATE)
		if (!page) {
			// Retry after CEF target registration
			await new Promise((r) => setTimeout(r, 1500))
			page = await findPageByUrlFragment(browser, TEST_TEMPLATE)
		}
		assert.ok(page, `no CDP page matching ${TEST_TEMPLATE}; targets: ${targets.map((x) => x.url).join(', ')}`)

		const readCount = () => page.evaluate(() => window.__clickCount ?? -1)
		const before = await readCount()
		assert.equal(before, 0, 'initial click count')

		const vp = page.viewport()
		const w = vp?.width || 1920
		const h = vp?.height || 1080
		await page.mouse.click(Math.floor(w / 2), Math.floor(h / 2))
		await new Promise((r) => setTimeout(r, 300))
		const afterClick = await readCount()
		assert.equal(afterClick, 1, 'mouse click via CDP should increment counter')

		await page.keyboard.press('Enter')
		await new Promise((r) => setTimeout(r, 300))
		const afterKey = await readCount()
		assert.equal(afterKey, 2, 'keyboard Enter via CDP should increment counter')

		const holdMs = parseInt(String(process.env.HIGHASCG_CEF_TEST_HOLD_MS || '0'), 10)
		if (Number.isFinite(holdMs) && holdMs > 0) {
			t.diagnostic(`holding ${holdMs}ms before CLEAR (set HIGHASCG_CEF_TEST_HOLD_MS)`)
			await new Promise((r) => setTimeout(r, holdMs))
		}
	} finally {
		try {
			await caspar.amcp.raw(`CLEAR ${channel}-${layer}`)
		} catch (_) {}
		caspar.stop()
		if (browser) {
			await Promise.race([
				browser.disconnect().catch(() => {}),
				new Promise((r) => setTimeout(r, 2000)),
			])
		}
	}
})
