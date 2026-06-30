'use strict'

/**
 * Live: WO-88 host channel + WO-89 focus/API — click/key survives operator route clear.
 *
 * T89.A5 — host PLAY → operator route → focus → click → CLEAR operator → host CEF alive
 * T89.B3 — forwardToCefTarget mouse + keyboard (same path as HTTP API)
 *
 * Requires Caspar with remote-debugging-port, AMCP on :5250.
 *
 * Env:
 *   HIGHASCG_CEF_HOST_CHANNEL  — host channel (default: suggest from routing)
 *   HIGHASCG_CEF_HOST_LAYER    — host layer (default 1)
 *
 * Run: npm run test:highascg:live:cef
 *   or: node --test tools/smoke/smoke-cef-host-focus-api.live.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { ConnectionManager } = require('../../src/caspar/connection-manager')
const { ConfigManager } = require('../../src/config/config-manager')
const { isWebpageHostCandidate } = require('../../src/config/host-live-sources')
const { listFocusableWebpageHosts } = require('../../src/system/cef-interactive-forward')
const { listInteractiveZones } = require('../../src/system/cef-interactive-bridge')
const {
	readCefDebugPortFromCasparXml,
	connectCefBrowser,
	resolveStableCefPage,
} = require('../../src/system/cef-interactive-cdp')
const { setCefFocusTarget, clearCefFocusTarget } = require('../../src/system/cef-focus-registry')
const { forwardToCefTarget } = require('../../src/system/cef-interactive-forward')
const { REPO_ROOT } = require('../../src/repo-paths')

const TEST_TEMPLATE = 'interactive_click_test'
const TEST_SOURCE_ID = 'webpage_smoke_live'
const TEST_HTML_PATH = path.join(REPO_ROOT, 'template', `${TEST_TEMPLATE}.html`)

const CASPAR_HOST = process.env.HIGHASCG_CASPAR_HOST || process.env.CASPAR_HOST || '127.0.0.1'
const CASPAR_PORT = Number.parseInt(process.env.HIGHASCG_CASPAR_PORT || process.env.CASPAR_PORT || '5250', 10)

function loadConfig() {
	const configDir = process.env.HIGHASCG_CONFIG_PATH || path.join(REPO_ROOT, 'config')
	const cm = new ConfigManager(configDir, { info() {}, warn() {}, error() {} })
	cm.load()
	return cm.get()
}

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

/**
 * @param {object} baseConfig
 */
function resolveLiveHostSource(baseConfig) {
	const forced = parseInt(String(process.env.HIGHASCG_CEF_HOST_CHANNEL || ''), 10)
	const forcedLayer = parseInt(String(process.env.HIGHASCG_CEF_HOST_LAYER || '1'), 10) || 1
	if (Number.isFinite(forced) && forced >= 1) {
		return {
			sourceId: TEST_SOURCE_ID,
			hostChannel: forced,
			hostLayer: forcedLayer,
			needle: TEST_TEMPLATE,
		}
	}
	const list = Array.isArray(baseConfig?.extraLiveSources) ? baseConfig.extraLiveSources : []
	const existing = list.find(
		(item) =>
			isWebpageHostCandidate(item) &&
			String(item.cefNeedle || item.playArg || '').includes(TEST_TEMPLATE),
	)
	if (existing) {
		return {
			sourceId: String(existing.sourceId || TEST_SOURCE_ID),
			hostChannel: parseInt(String(existing.hostChannel), 10),
			hostLayer: parseInt(String(existing.hostLayer ?? 1), 10) || 1,
			needle: String(existing.cefNeedle || existing.playArg || TEST_TEMPLATE),
		}
	}
	const any = listFocusableWebpageHosts(baseConfig)[0]
	if (any) {
		return {
			sourceId: any.sourceId,
			hostChannel: any.hostChannel,
			hostLayer: any.hostLayer,
			needle: any.needle,
		}
	}
	return null
}

async function apiClick(config, sourceId) {
	const base = { config, sourceId, x: 0.5, y: 0.5, coordsNormalized: true }
	const down = await forwardToCefTarget({ ...base, type: 'mousedown' })
	assert.equal(down.ok, true, `mousedown failed: ${down.error || JSON.stringify(down)}`)
	const up = await forwardToCefTarget({ ...base, type: 'mouseup' })
	assert.equal(up.ok, true, `mouseup failed: ${up.error || JSON.stringify(up)}`)
}

async function apiKeyEnter(config, sourceId) {
	const res = await forwardToCefTarget({
		config,
		sourceId,
		type: 'keydown',
		keysym: 65293,
		text: '',
	})
	assert.equal(res.ok, true, `keydown Enter failed: ${res.error || JSON.stringify(res)}`)
	const up = await forwardToCefTarget({
		config,
		sourceId,
		type: 'keyup',
		keysym: 65293,
	})
	assert.equal(up.ok, true, `keyup Enter failed: ${up.error || JSON.stringify(up)}`)
}

async function readClickCount(browser, needle, port) {
	const page = await resolveStableCefPage(browser, needle, port)
	assert.ok(page, `no CEF page for ${needle}`)
	return page.evaluate(() => window.__clickCount ?? -1)
}

test('host focus API: click/key survives operator route clear (T89.A5 + T89.B3)', async (t) => {
	if (!fs.existsSync(TEST_HTML_PATH)) {
		t.skip(`missing ${TEST_HTML_PATH}`)
		return
	}
	if (readCefDebugPortFromCasparXml() <= 0) {
		t.skip('remote-debugging-port not enabled in casparcg.config')
		return
	}

	const baseConfig = loadConfig()
	const zones = listInteractiveZones(baseConfig)
	if (!zones.length) {
		t.skip('no interactive zones — enable multiview/screen interactive in config')
		return
	}
	const mv = zones.find((z) => z.id === 'multiview') || zones[0]

	const host = resolveLiveHostSource(baseConfig)
	if (!host || !Number.isFinite(host.hostChannel)) {
		t.skip(
			'no webpage_host in extraLiveSources — add interactive_click_test host, apply caspar config, or set HIGHASCG_CEF_HOST_CHANNEL',
		)
		return
	}
	const { sourceId, hostChannel, hostLayer, needle } = host
	const config = {
		...baseConfig,
		extraLiveSources: Array.isArray(baseConfig.extraLiveSources) ? baseConfig.extraLiveSources : [],
	}
	if (!config.extraLiveSources.some((s) => String(s.sourceId) === sourceId)) {
		config.extraLiveSources = [
			...config.extraLiveSources,
			{
				sourceId,
				type: 'browser',
				routeType: 'webpage_host',
				hostChannel,
				hostLayer,
				cefNeedle: needle,
				playArg: needle,
				value: `route://${hostChannel}-${hostLayer}`,
				interactiveCapable: true,
			},
		]
	}

	t.diagnostic(`host=ch${hostChannel}-L${hostLayer} operator=ch${mv.channel}-L${mv.layer} zone=${mv.id} source=${sourceId}`)

	let caspar = null
	try {
		caspar = await connectCaspar(5000)
	} catch (e) {
		t.skip(`Caspar not reachable (${e?.message || e})`)
		return
	}

	const port = readCefDebugPortFromCasparXml()
	let browser = null

	try {
		const playLine = await caspar.amcp.raw(`PLAY ${hostChannel}-${hostLayer} [HTML] ${needle}`)
		const playOk = String(playLine?.data ?? playLine?.raw ?? '').match(/202|PLAY OK/i)
		if (!playOk) {
			t.skip(`PLAY host channel failed (is ch${hostChannel} in casparcg.config?): ${playLine?.data || playLine?.raw || playLine}`)
			return
		}
		await caspar.amcp.raw(`MIXER ${hostChannel}-${hostLayer} FILL 0 0 1 1`)
		await caspar.amcp.raw(`MIXER ${hostChannel} COMMIT`)
		await new Promise((r) => setTimeout(r, 2500))

		setCefFocusTarget({
			sourceId,
			hostChannel,
			hostLayer,
			needle,
			zoneId: mv.id,
		})

		await caspar.amcp.raw(`PLAY ${mv.channel}-${mv.layer} route://${hostChannel}-${hostLayer}`)
		await caspar.amcp.raw(`MIXER ${mv.channel}-${mv.layer} FILL 0 0 1 1`)
		await caspar.amcp.raw(`MIXER ${mv.channel} COMMIT`)
		await new Promise((r) => setTimeout(r, 800))

		browser = await connectCefBrowser(port)
		const before = await readClickCount(browser, needle, port)
		t.diagnostic(`click count before API input: ${before}`)

		await apiClick(config, sourceId)
		await new Promise((r) => setTimeout(r, 400))
		const afterClick = await readClickCount(browser, needle, port)
		assert.ok(afterClick > before, `expected click after API mouse, before=${before} after=${afterClick}`)

		await apiKeyEnter(config, sourceId)
		await new Promise((r) => setTimeout(r, 400))
		const afterKey = await readClickCount(browser, needle, port)
		assert.ok(afterKey > afterClick, `expected click after API Enter, afterClick=${afterClick} afterKey=${afterKey}`)

		await caspar.amcp.raw(`CLEAR ${mv.channel}-${mv.layer}`)
		await caspar.amcp.raw(`MIXER ${mv.channel} COMMIT`)
		await new Promise((r) => setTimeout(r, 500))

		const beforeSecond = await readClickCount(browser, needle, port)
		assert.equal(
			beforeSecond,
			afterKey,
			'host CEF state should survive operator route clear',
		)

		await apiClick(config, sourceId)
		await new Promise((r) => setTimeout(r, 400))
		const afterSecondClick = await readClickCount(browser, needle, port)
		assert.ok(
			afterSecondClick > beforeSecond,
			`refocus click after operator clear: before=${beforeSecond} after=${afterSecondClick}`,
		)
	} finally {
		clearCefFocusTarget()
		if (caspar) {
			try {
				await caspar.amcp.raw(`CLEAR ${mv.channel}-${mv.layer}`)
			} catch (_) {}
			try {
				await caspar.amcp.raw(`CLEAR ${hostChannel}-${hostLayer}`)
			} catch (_) {}
			caspar.stop()
		}
		if (browser) {
			await Promise.race([
				browser.disconnect().catch(() => {}),
				new Promise((r) => setTimeout(r, 1500)),
			])
		}
	}
})
