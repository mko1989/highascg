'use strict'

/**
 * Live: X11 pointer on interactive multiview zone → CDP → CEF page updates.
 *
 * Requires Caspar with remote-debugging-port, interactive multiview, and DISPLAY=:0.
 * Simulates operator click via XTest at zone centre (same path as physical click once bridge runs).
 *
 * Run: node --test tools/smoke/smoke-cef-interactive-bridge.live.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { ConnectionManager } = require('../../src/caspar/connection-manager')
const { ConfigManager } = require('../../src/config/config-manager')
const {
	readCefDebugPortFromCasparXml,
	connectCefBrowser,
	findCefPage,
} = require('../../src/system/cef-interactive-cdp')
const {
	listInteractiveZones,
	startCefInteractiveBridge,
	stopCefInteractiveBridge,
	drainCefInteractiveEvents,
} = require('../../src/system/cef-interactive-bridge')
const { REPO_ROOT } = require('../../src/repo-paths')
const { displaySessionEnv } = require('../../src/utils/x-display-session')

const TEST_TEMPLATE = 'interactive_click_test'

function loadConfig() {
	const configDir = process.env.HIGHASCG_CONFIG_PATH || path.join(REPO_ROOT, 'config')
	const cm = new ConfigManager(configDir, { info() {}, warn() {}, error() {} })
	cm.load()
	return cm.get()
}

function connectCaspar(timeoutMs) {
	const cm = new ConnectionManager({
		host: process.env.HIGHASCG_CASPAR_HOST || '127.0.0.1',
		port: parseInt(process.env.HIGHASCG_CASPAR_PORT || '5250', 10),
		config: {},
		log() {},
		healthIntervalMs: 0,
		healthConnectDelayMs: 0,
	})
	return new Promise((resolve, reject) => {
		const to = setTimeout(() => {
			cm.stop()
			reject(new Error('AMCP connect timeout'))
		}, timeoutMs)
		cm.on('status', (p) => {
			if (p.connected) {
				clearTimeout(to)
				resolve(cm)
			}
		})
		cm.on('error', (e) => {
			clearTimeout(to)
			reject(e)
		})
		cm.start()
	})
}

async function waitForClickCount(page, minCount, timeoutMs = 4000) {
	const t0 = Date.now()
	while (Date.now() - t0 < timeoutMs) {
		const count = await page.evaluate(() => window.__clickCount ?? -1)
		if (count >= minCount) return count
		await new Promise((r) => setTimeout(r, 100))
	}
	return page.evaluate(() => window.__clickCount ?? -1)
}

async function xtestClick(rx, ry) {
	const env = displaySessionEnv()
	await new Promise((resolve, reject) => {
		const { execFile } = require('child_process')
		const script = `
from Xlib import display
from Xlib.ext import xtest
from Xlib import X
import time
d = display.Display()
xtest.fake_input(d, X.MotionNotify, x=${rx}, y=${ry})
xtest.fake_input(d, X.ButtonPress, detail=1, x=${rx}, y=${ry})
d.sync()
time.sleep(0.08)
xtest.fake_input(d, X.ButtonRelease, detail=1, x=${rx}, y=${ry})
d.sync()
print('ok')
`
		execFile('python3', ['-c', script], { env, timeout: 5000 }, (err, stdout) => {
			if (err) reject(err)
			else resolve(stdout)
		})
	})
}

test('CEF bridge: X11 click on interactive zone reaches CEF', async (t) => {
	if (readCefDebugPortFromCasparXml() <= 0) {
		t.skip('remote-debugging-port not enabled in casparcg.config')
		return
	}
	const config = loadConfig()
	const zones = listInteractiveZones(config)
	if (!zones.length) {
		t.skip('no interactive zones in config')
		return
	}
	const mv = zones.find((z) => z.id === 'multiview') || zones[0]
	t.diagnostic(`zone=${mv.id} ch=${mv.channel} layer=${mv.layer} @ ${mv.x},${mv.y} ${mv.width}x${mv.height}`)

	const caspar = await connectCaspar(12_000)
	let browser = null
	try {
		await caspar.amcp.raw(`CLEAR ${mv.channel}-${mv.layer}`)
		await caspar.amcp.raw(`PLAY ${mv.channel}-${mv.layer} [HTML] ${TEST_TEMPLATE}`)
		await caspar.amcp.raw(`MIXER ${mv.channel}-${mv.layer} FILL 0 0 1 1`)
		await caspar.amcp.raw(`MIXER ${mv.channel} COMMIT`)
		await new Promise((r) => setTimeout(r, 2500))

		const bridge = await startCefInteractiveBridge(config, {
			log: () => {},
			amcp: caspar.amcp,
		})
		assert.equal(bridge.ok, true, JSON.stringify(bridge))
		await new Promise((r) => setTimeout(r, 800))

		const cx = mv.x + Math.floor(mv.width / 2)
		const cy = mv.y + Math.floor(mv.height / 2)
		await xtestClick(cx, cy)
		await drainCefInteractiveEvents()

		const port = readCefDebugPortFromCasparXml()
		browser = await connectCefBrowser(port)
		const page = await findCefPage(browser, TEST_TEMPLATE)
		assert.ok(page, 'CEF page for test template')
		const count = await waitForClickCount(page, 1)
		assert.ok(count >= 1, `expected click count >= 1 after X11 bridge, got ${count}`)
	} finally {
		stopCefInteractiveBridge()
		try {
			await caspar.amcp.raw(`CLEAR ${mv.channel}-${mv.layer}`)
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
