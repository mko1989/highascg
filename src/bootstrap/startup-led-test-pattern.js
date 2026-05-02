'use strict'

const fs = require('fs')
const { getLanIPv4Addresses } = require('../utils/lan-ipv4')
const { parseServerChannels } = require('../config/config-compare')
const { responseToStr } = require('../utils/query-cycle')
const persistence = require('../utils/persistence')

/** Same layer as manual LED test card (`routes-led-test-card.js`). */
const STARTUP_LED_TEST_LAYER = 999
const TEMPLATE_NAME = 'led_grid_test'

const DONE_KEY = 'ledTestStartupDoneBootId'

/** @type {ReturnType<typeof setTimeout> | null} */
let retryTimer = null
/** CEF “catch-up” replays (must be cancelled if layer 999 is cleared for Web UI) */
let cefReplayTimeouts = []

/**
 * Stable per-boot id so we run once per machine boot, not on every INFO CONFIG refresh.
 * @returns {string | null}
 */
function getMachineBootIdentity() {
	try {
		const p = '/proc/sys/kernel/random/boot_id'
		if (fs.existsSync(p)) {
			const id = fs.readFileSync(p, 'utf8').trim()
			if (id) return `linux:${id}`
		}
	} catch (_) {}
	try {
		if (process.platform === 'darwin') {
			const { execSync } = require('child_process')
			const out = execSync('sysctl -n kern.boottime 2>/dev/null', { encoding: 'utf8' }).trim()
			if (out) return `darwin:${out}`
		}
	} catch (_) {}
	return null
}

function clearRetryTimer() {
	if (retryTimer) {
		clearTimeout(retryTimer)
		retryTimer = null
	}
}

function clearCefReplayTimers() {
	for (const t of cefReplayTimeouts) {
		if (t) clearTimeout(t)
	}
	cefReplayTimeouts = []
}

function scheduleRetry(appCtx, delayMs) {
	clearRetryTimer()
	retryTimer = setTimeout(() => {
		retryTimer = null
		void runStartupLedTestPatternIfNeeded(appCtx)
	}, delayMs)
	if (retryTimer.unref) retryTimer.unref()
}

function channelsForLedTestOutput(channels) {
	return channels.filter((c) => c.hasScreen || c.hasDecklinkOutput)
}

/**
 * Build JSON payload for `led_grid_test.html` — screens-only mode (no LED grid), circle + cross, resolution + IPs under title.
 * @param {{ resolutionLabel: string, screenWidth: number, screenHeight: number, videoMode: string, ipLines: string[] }} opts
 */
function buildStartupPayload(opts) {
	return {
		showLedGrid: false,
		showCircle: true,
		showCross: true,
		videoMode: opts.videoMode || '',
		connectorLabel: opts.connectorLabel || '',
		resolutionWidth: opts.screenWidth,
		resolutionHeight: opts.screenHeight,
		resolutionLabel: opts.resolutionLabel || '',
		ipLines: opts.ipLines || [],
		centerLabel: 'HighAsCG',
		showCenterCharacter: true,
		showPanelLabels: false,
		showSpecLine: false,
		cols: 4,
		rows: 3,
		panelWidth: 192,
		panelHeight: 108,
	}
}

/**
 * After INFO CONFIG: show startup test pattern (layer 999) on every screen/DeckLink output channel (incl. multiview if it has screen/DeckLink).
 * Template is cleared from **layer 999 only** on those same channels when the **first** Web UI WebSocket client connects (see `index.js` `onFirstWebSocketClient`).
 * @param {{ amcp: import('../caspar/amcp-client').AmcpClient, gatheredInfo: { infoConfig?: string }, log: Function }} appCtx
 */
async function runStartupLedTestPatternIfNeeded(appCtx) {
	if (process.env.HIGHASCG_NO_STARTUP_LED_TEST === '1' || String(process.env.HIGHASCG_NO_STARTUP_LED_TEST).toLowerCase() === 'true') {
		return
	}
	const bootId = getMachineBootIdentity()
	if (!bootId) {
		appCtx.log('debug', '[Startup LED test] No boot id — skip')
		return
	}
	if (persistence.get(DONE_KEY) === bootId) {
		return
	}

	const amcp = appCtx.amcp
	if (!amcp?.query?.infoConfig || !amcp.isConnected) {
		return
	}

	let xml = appCtx.gatheredInfo?.infoConfig
	if (!xml || !String(xml).trim()) {
		try {
			const res = await amcp.query.infoConfig()
			xml = responseToStr(res?.data)
			if (xml) appCtx.gatheredInfo = { ...appCtx.gatheredInfo, infoConfig: xml }
		} catch (e) {
			appCtx.log('warn', '[Startup LED test] INFO CONFIG: ' + (e?.message || e))
			scheduleRetry(appCtx, 4000)
			return
		}
	}

	const channels = await parseServerChannels(xml || '')
	const withTarget = channelsForLedTestOutput(channels)

	if (withTarget.length === 0) {
		appCtx.log('info', '[Startup LED test] No screen or DeckLink output in INFO CONFIG — skip')
		persistence.set(DONE_KEY, bootId)
		return
	}

	const ipLines = getLanIPv4Addresses()

	/** Same order as `routes-led-test-card.js` (PLAY before UPDATE) — some Caspar HTML builds reject UPDATE until after PLAY. */
	const flat = buildStartupLedTestFlatCommands(withTarget, ipLines)
	try {
		await amcp.batchSendChunked(flat, { skipMixerPreCommit: true })
	} catch (e) {
		appCtx.log(
			'warn',
			`[Startup LED test] AMCP: ${e?.message || e} (deploy templates/${TEMPLATE_NAME}.html to Caspar template-path)`,
		)
		scheduleRetry(appCtx, 5000)
		return
	}

	for (const ch of withTarget) {
		try {
			await amcp.mixerCommit(ch.index)
		} catch (_) {}
	}

	clearRetryTimer()
	persistence.set(DONE_KEY, bootId)
	appCtx._startupLedTestChannelIndices = withTarget.map((c) => c.index)

	if (appCtx._webUiClientConnected) {
		await tryClearStartupLedTestForWebUi(appCtx)
	}

	const ipMsg = ipLines.length ? ipLines.join(', ') : '(no LAN IPv4)'
	if (appCtx._ledTestLayer999ClearedAfterWebUi) {
		appCtx.log(
			'info',
			`[Startup LED test] ${TEMPLATE_NAME} was applied then cleared (Web UI already connected) — output channel(s) ${withTarget.map((c) => c.index).join(', ')} · ${ipMsg}`,
		)
	} else {
		appCtx.log(
			'info',
			`[Startup LED test] ${TEMPLATE_NAME} on ${withTarget.length} channel(s) layer ${STARTUP_LED_TEST_LAYER}: ${ipMsg} — clears on first Web UI WS connect.`,
		)
		/**
		 * CEF may still be spinning up; UPDATE-only batches caused **403 CG UPDATE FAILED** + **COMMIT PARTIAL** on some builds.
		 * Re-run the **full** CLEAR→ADD→PLAY→UPDATE sequence (same as UI), not UPDATE alone — **skip** if Web UI cleared layer 999.
		 */
		clearCefReplayTimers()
		const bootSnap = bootId
		for (const ms of [4000, 10000]) {
			const t = setTimeout(() => {
				if (persistence.get(DONE_KEY) !== bootSnap) return
				if (appCtx._ledTestLayer999ClearedAfterWebUi) return
				void replayStartupLedTestFullBatch(appCtx, withTarget, ipLines)
			}, ms)
			if (t.unref) t.unref()
			cefReplayTimeouts.push(t)
		}
	}
}

/**
 * Remove only the startup LED template + mixer on layer 999 (not whole-channel CLEAR).
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number[]} channelIndices
 * @param {(s: string, ...a: unknown[]) => void} [log]
 */
async function clearLedTestLayerOnChannels(amcp, channelIndices, log) {
	if (!amcp?.cg?.cgClear || !channelIndices?.length) return
	for (const ch of channelIndices) {
		if (!Number.isFinite(ch) || ch < 1) continue
		const cl = `${ch}-${STARTUP_LED_TEST_LAYER}`
		try {
			await amcp.cg.cgClear(ch, STARTUP_LED_TEST_LAYER)
		} catch (e) {
			log?.('debug', `[Startup LED test] CG CLEAR ${cl}: ${e?.message || e}`)
		}
		try {
			if (amcp.mixerClear) await amcp.mixerClear(ch, STARTUP_LED_TEST_LAYER)
		} catch (e) {
			log?.('debug', `[Startup LED test] MIXER CLEAR ${cl}: ${e?.message || e}`)
		}
		try {
			await amcp.mixerCommit(ch)
		} catch (e) {
			log?.('debug', `[Startup LED test] COMMIT ch${ch}: ${e?.message || e}`)
		}
	}
}

/**
 * After Web UI (first WS) or immediately after startup if UI connected first: clear test pattern.
 * @param {object} appCtx
 * @returns {Promise<void>}
 */
async function tryClearStartupLedTestForWebUi(appCtx) {
	if (!appCtx || appCtx._ledTestLayer999ClearedAfterWebUi) return
	const amcp = appCtx.amcp
	if (!amcp?.isConnected) return
	const indices = appCtx._startupLedTestChannelIndices
	if (!Array.isArray(indices) || indices.length === 0) return
	clearCefReplayTimers()
	try {
		await clearLedTestLayerOnChannels(amcp, indices, appCtx.log)
		appCtx._ledTestLayer999ClearedAfterWebUi = true
		appCtx.log?.(
			'info',
			`[Startup LED test] Cleared ${TEMPLATE_NAME} (L${STARTUP_LED_TEST_LAYER}) on ` +
				`channel(s) ${indices.join(', ')} — Web UI present.`,
		)
	} catch (e) {
		appCtx.log?.('warn', `[Startup LED test] clear: ${e?.message || e}`)
	}
}

/**
 * Called from WebSocket on first client connection. If startup already stashed channel list, clear now; else a flag
 * is set so {@link runStartupLedTestPatternIfNeeded} clears right after it paints.
 * @param {object} appCtx
 */
function notifyWebSocketClientConnected(appCtx) {
	if (!appCtx) return
	appCtx._webUiClientConnected = true
	void tryClearStartupLedTestForWebUi(appCtx)
}

function buildStartupLedTestFlatCommands(withTarget, ipLines) {
	const flat = []
	for (const ch of withTarget) {
		const payload = buildStartupPayload({
			resolutionLabel: ch.resolutionLabel,
			screenWidth: ch.screenWidth,
			screenHeight: ch.screenHeight,
			videoMode: ch.videoMode,
			connectorLabel: `PGM ch ${ch.index}${ch.videoMode ? ` · ${ch.videoMode}` : ''}`,
			ipLines,
		})
		const json = JSON.stringify(payload)
		const escaped = json.replace(/"/g, '\\"')
		const channel = ch.index
		const cl = `${channel}-${STARTUP_LED_TEST_LAYER}`
		flat.push(
			`CG ${cl} CLEAR`,
			`MIXER ${cl} CLEAR`,
			`CG ${cl} ADD 0 "${TEMPLATE_NAME}" 1 "${escaped}"`,
			`CG ${cl} PLAY 0`,
			`CG ${cl} UPDATE 0 "${escaped}"`,
			`MIXER ${cl} FILL 0 0 1 1 0`,
			`MIXER ${cl} OPACITY 1`
		)
	}
	return flat
}

async function replayStartupLedTestFullBatch(appCtx, withTarget, ipLines) {
	if (appCtx._ledTestLayer999ClearedAfterWebUi) return
	const amcp = appCtx.amcp
	if (!amcp?.batchSendChunked || !withTarget?.length) return
	const flat = buildStartupLedTestFlatCommands(withTarget, ipLines)
	try {
		await amcp.batchSendChunked(flat, { skipMixerPreCommit: true })
		for (const ch of withTarget) {
			try {
				await amcp.mixerCommit(ch.index)
			} catch (_) {}
		}
		appCtx.log?.('debug', '[Startup LED test] Full CG replay (CEF catch-up)')
	} catch (e) {
		appCtx.log?.('warn', '[Startup LED test] replay: ' + (e?.message || e))
	}
}

module.exports = {
	runStartupLedTestPatternIfNeeded,
	getMachineBootIdentity,
	STARTUP_LED_TEST_LAYER,
	TEMPLATE_NAME,
	channelsForLedTestOutput,
	notifyWebSocketClientConnected,
	tryClearStartupLedTestForWebUi,
	/** @deprecated use runStartupLedTestPatternIfNeeded */
	runStartupHostIpSplashIfNeeded: runStartupLedTestPatternIfNeeded,
}
