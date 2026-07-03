'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { REPO_ROOT } = require('../repo-paths')
const { getChannelMap } = require('../config/routing')
const { calculateLayoutPositions } = require('../utils/os-layout-calculator')
const {
	displaySessionEnv,
	multiviewScreenConsumerEnabled,
	multiviewInteractiveEnabled,
	screenConsumerEnabled,
	screenInteractiveEnabled,
	multiviewPhysicalPortIndex,
} = require('../utils/x-display-session')
const { getModeDimensions } = require('../config/config-modes')
const { infoResponseToXml } = require('../caspar/channel-info-xml')
const {
	readCefDebugPortFromCasparXml,
	connectCefBrowser,
	htmlNeedleFromInfoXml,
	findCefPage,
	resolveStableCefPage,
	warmCefPage,
	clearStableCefPages,
	urlMatchesNeedle,
	listCefPageUrls,
	mapPointToCef,
	forwardMouseEvent,
	forwardKeyEvent,
} = require('./cef-interactive-cdp')
const { bridgeTrace, shouldTraceX11Event } = require('./cef-interactive-trace')
const {
	getCefFocusTarget,
	onCefFocusChange,
	cefFocusTargetForHostChannel,
} = require('./cef-focus-registry')

const X11_SCRIPT = path.join(REPO_ROOT, 'tools/runtime/cef-interactive-x11.py')

/** @type {import('child_process').ChildProcess | null} */
let x11Proc = null
/** @type {import('puppeteer-core').Browser | null} */
let cefBrowser = null
/** @type {string | null} */
let activeKey = null
/** @type {Map<string, { channel: number, layer: number, width: number, height: number, zone: object }>} */
let zoneTargets = new Map()
/** @type {number} */
let debugPort = 0
/** @type {ReturnType<typeof setInterval> | null} */
let infoPollTimer = null
/** @type {{ amcp?: { info: (ch: number) => Promise<{ data?: string }> } } | null} */
let amcpRef = null
/** @type {{ needle: string|null, hasHtml: boolean, playArg: string|null }} */
let pageHint = { needle: null, hasHtml: false, playArg: null }
/** @type {number} */
let pageHintAt = 0
/** @type {string|null} */
let keyboardZoneId = null
/** @type {string|null} */
let pointerInZone = null
/** @type {Promise<unknown>|null} */
let warmInFlight = null
/** @type {number} */
let lastWarmAt = 0
/** @type {object|null} */
let bridgeConfigRef = null
/** @type {(() => void)|null} */
let focusUnsubscribe = null
/** @type {Function|null} */
let bridgeLogRef = null

/** @type {Promise<void>} */
let eventChain = Promise.resolve()

function forceLegacyInfoPath() {
	const v = String(process.env.HIGHASCG_CEF_FORCE_LEGACY_INFO || '').trim().toLowerCase()
	return v === '1' || v === 'true' || v === 'yes'
}

function hostFocusActive() {
	return !forceLegacyInfoPath() && !!getCefFocusTarget()?.needle
}

function syncPageHintFromFocus() {
	const focus = getCefFocusTarget()
	if (!focus?.needle) return false
	let playArg = focus.playArg || null
	if (!playArg && bridgeConfigRef) {
		const list = Array.isArray(bridgeConfigRef.extraLiveSources) ? bridgeConfigRef.extraLiveSources : []
		const src = list.find((s) => String(s.sourceId || '') === String(focus.sourceId || ''))
		playArg = src?.playArg || src?.templateOrUrl || null
	}
	if (pageHint.needle !== focus.needle || pageHint.playArg !== playArg) clearStableCefPages()
	pageHint = { needle: focus.needle, hasHtml: true, playArg: playArg || null }
	pageHintAt = Date.now()
	return true
}
const PAGE_HINT_TTL_MS = 4000
const WARM_INTERVAL_MS = 5000
const ZONE_WARM_DEBOUNCE_MS = 150

function envDisabled() {
	const v = String(process.env.HIGHASCG_CEF_INTERACTIVE_BRIDGE || '').trim().toLowerCase()
	return v === '0' || v === 'false' || v === 'no'
}

function resolveInteractiveLayer(config) {
	const fromEnv = parseInt(String(process.env.HIGHASCG_CEF_INTERACTIVE_LAYER || ''), 10)
	if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv
	const ot = config?.operatorTools
	const fromCfg = parseInt(String(ot?.cefInteractiveLayer ?? ''), 10)
	if (Number.isFinite(fromCfg) && fromCfg >= 0) return fromCfg
	return 999
}

/**
 * Cheap config-only check: is any screen/multiview marked interactive at all?
 * Must run before {@link listInteractiveZones} — zone listing walks the OS layout
 * calculator into live xrandr queries, far too expensive for per-AMCP hooks.
 * @param {object} config
 * @returns {boolean}
 */
function anyInteractiveConfigured(config) {
	if (multiviewInteractiveEnabled(config)) return true
	for (let n = 1; n <= 8; n++) {
		if (screenInteractiveEnabled(config, n)) return true
	}
	return false
}

function bridgeEnabledInConfig(config) {
	if (envDisabled()) return false
	const ot = config?.operatorTools
	if (ot?.cefInteractiveBridge === false || ot?.cefInteractiveBridge === 'false') return false
	if (!anyInteractiveConfigured(config)) return false
	if (readCefDebugPortFromCasparXml() <= 0) return false
	return listInteractiveZones(config).length > 0
}

/**
 * @param {object} config
 * @returns {Array<{ id: string, x: number, y: number, width: number, height: number, channel: number, layer: number }>}
 */
function listInteractiveZones(config) {
	const layout = calculateLayoutPositions(config)
	const map = getChannelMap(config)
	const layer = resolveInteractiveLayer(config)
	/** @type {Array<{ id: string, x: number, y: number, width: number, height: number, channel: number, layer: number }>} */
	const zones = []
	const mv = layout?.multiview?.[1]
	if (multiviewScreenConsumerEnabled(config) && multiviewInteractiveEnabled(config) && mv?.width > 0 && map.multiviewCh != null) {
		zones.push({
			id: 'multiview',
			x: mv.x,
			y: mv.y,
			width: mv.width,
			height: mv.height,
			channel: map.multiviewCh,
			layer,
		})
	}
	const mvPort = multiviewPhysicalPortIndex(config)
	for (let n = 1; n <= 8; n++) {
		const sc = layout?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n) || !screenInteractiveEnabled(config, n)) continue
		if (mvPort && n === mvPort) continue
		const ch = map.programCh?.(n)
		if (ch == null) continue
		zones.push({
			id: `screen-${n}`,
			x: sc.x,
			y: sc.y,
			width: sc.width,
			height: sc.height,
			channel: ch,
			layer,
		})
	}
	return zones
}

/**
 * @param {object} config
 * @param {number} channel
 */
function channelVideoSize(config, channel) {
	const map = getChannelMap(config)
	const cs = config?.casparServer || config
	let mode = cs.multiview_mode || '1080p5000'
	if (channel === map.multiviewCh) mode = cs.multiview_mode || mode
	else {
		const idx = (map.programChannels || []).indexOf(channel)
		if (idx >= 0) {
			mode = cs[`screen_${idx + 1}_mode`] || mode
		}
	}
	const dims = getModeDimensions(String(mode || '1080p5000'), config, 1)
	return { width: dims?.width || 1920, height: dims?.height || 1080 }
}

function zonesKey(zones) {
	return zones.map((z) => `${z.id}@${z.x},${z.y},${z.width}x${z.height},ch${z.channel},L${z.layer}`).join('|')
}

async function ensureCefBrowser(log) {
	const port = readCefDebugPortFromCasparXml()
	if (port <= 0) throw new Error('remote-debugging-port not set in casparcg.config')
	if (cefBrowser && debugPort === port && cefBrowser.connected) return cefBrowser
	if (cefBrowser) {
		cefBrowser.disconnect().catch(() => {})
		cefBrowser = null
	}
	clearStableCefPages()
	debugPort = port
	cefBrowser = await connectCefBrowser(port)
	log?.('info', `[CEF bridge] Connected CDP :${port}`)
	return cefBrowser
}

/**
 * @param {string} zoneId
 */
function targetForZone(zoneId) {
	return zoneTargets.get(zoneId) || null
}

async function refreshPageHint() {
	if (hostFocusActive()) {
		return syncPageHintFromFocus()
	}
	if (!amcpRef?.info) return false
	const channels = new Set([...zoneTargets.values()].map((t) => t.channel))
	for (const ch of channels) {
		try {
			const r = await amcpRef.info(ch)
			const xml = infoResponseToXml(r)
			const layer = [...zoneTargets.values()].find((t) => t.channel === ch)?.layer ?? resolveInteractiveLayer({})
			const hint = htmlNeedleFromInfoXml(xml, layer)
			if (hint.hasHtml) {
				if (hint.needle !== pageHint.needle) clearStableCefPages()
				pageHint = hint
				pageHintAt = Date.now()
				return true
			}
		} catch (_) {}
	}
	return false
}

/**
 * @param {boolean} [force]
 */
async function refreshPageHintIfStale(force = false) {
	if (hostFocusActive()) {
		if (force || !pageHint.hasHtml) syncPageHintFromFocus()
		return
	}
	if (!force && pageHint.hasHtml && Date.now() - pageHintAt < PAGE_HINT_TTL_MS) return
	await refreshPageHint()
}

/**
 * @param {Function} [log]
 */
async function warmCefInteractivePage(log) {
	if (!pageHint.needle && !pageHint.hasHtml) return null
	try {
		const browser = await ensureCefBrowser(log)
		let page = await resolveStableCefPage(browser, pageHint.needle, debugPort, pageHint.playArg)
		if (!page && pageHint.needle) {
			page = await warmCefPage(browser, pageHint.needle, debugPort, 3000, pageHint.playArg)
		}
		if (page) {
			lastWarmAt = Date.now()
			try {
				await page.evaluate(() => {
					document.body?.focus?.()
				})
			} catch (_) {}
			bridgeTrace(log, `warmed CEF page needle=${pageHint.needle || '(any)'}`)
		}
		return page
	} catch (e) {
		bridgeTrace(log, `warm failed: ${e?.message || e}`)
		return null
	}
}

/**
 * @param {Function} [log]
 * @param {number} [delayMs]
 */
function scheduleCefWarm(log, delayMs = 0) {
	const timer = setTimeout(() => {
		if (warmInFlight) {
			void warmInFlight.finally(() => warmCefInteractivePage(log))
			return
		}
		warmInFlight = warmCefInteractivePage(log).finally(() => {
			warmInFlight = null
		})
	}, delayMs)
	if (typeof timer.unref === 'function') timer.unref()
}

/**
 * @param {string[]} lines
 * @param {object} config
 * @param {Function} [log]
 */
function notifyCefInteractiveAmcpLines(lines, config, log) {
	if (!bridgeEnabledInConfig(config)) return
	bridgeConfigRef = config
	const layer = resolveInteractiveLayer(config)
	const zoneChannels = new Set(listInteractiveZones(config).map((z) => z.channel))
	for (const raw of lines) {
		const line = String(raw || '').trim()
		if (!line) continue
		const clearM = line.match(/^CLEAR\s+(\d+)(?:-(\d+))?/i)
		if (clearM) {
			const ch = parseInt(clearM[1], 10)
			const lyr = clearM[2] != null ? parseInt(clearM[2], 10) : null
			const focus = getCefFocusTarget()
			if (focus && focus.hostChannel === ch && (lyr == null || lyr === focus.hostLayer)) {
				clearStableCefPages()
			}
			if (zoneChannels.has(ch) && (lyr == null || lyr === layer)) {
				if (!hostFocusActive()) {
					clearStableCefPages()
					pageHint = { needle: null, hasHtml: false, playArg: null }
					pageHintAt = 0
				}
			}
			continue
		}
		const playM = line.match(/^(?:PLAY|LOADBG|LOAD)\s+(\d+)-(\d+)\s+\[HTML\]/i)
		if (!playM) continue
		const ch = parseInt(playM[1], 10)
		const lyr = parseInt(playM[2], 10)
		const hostMeta = cefFocusTargetForHostChannel(config, ch, lyr)
		if (hostMeta) {
			clearStableCefPages()
			if (hostFocusActive() && getCefFocusTarget()?.hostChannel === ch) {
				syncPageHintFromFocus()
			}
			scheduleCefWarm(log, 200)
			scheduleCefWarm(log, 800)
			continue
		}
		if (lyr !== layer || !zoneChannels.has(ch)) continue
		clearStableCefPages()
		scheduleCefWarm(log, 200)
		scheduleCefWarm(log, 1000)
		void refreshPageHint().then(() => scheduleCefWarm(log, 400))
	}
}

/**
 * Called when WO-88 operator fullscreen sets or clears cefFocusTarget.
 * @param {Function} [log]
 */
function notifyCefFocusChanged(log) {
	if (!activeKey) return
	if (syncPageHintFromFocus()) {
		scheduleCefWarm(log, 0)
		scheduleCefWarm(log, 400)
	} else if (!hostFocusActive()) {
		pageHint = { needle: null, hasHtml: false, playArg: null }
		pageHintAt = 0
		clearStableCefPages()
	}
}

/**
 * @param {string} zoneId
 * @param {Function} [log]
 */
function onPointerZoneEnter(zoneId, log) {
	if (!zoneId || zoneId === pointerInZone) return
	pointerInZone = zoneId
	if (Date.now() - lastWarmAt < ZONE_WARM_DEBOUNCE_MS) return
	scheduleCefWarm(log, 0)
}

/**
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} type
 * @param {Function} log
 */
async function resolvePageForEvent(browser, type, log) {
	let page = await resolveStableCefPage(browser, pageHint.needle, debugPort, pageHint.playArg)
	if (!page && pageHint.needle) {
		let cdpUrls = []
		try {
			cdpUrls = await listCefPageUrls(debugPort)
		} catch (_) {}
		if (cdpUrls.some((u) => urlMatchesNeedle(u, pageHint.needle, pageHint.playArg))) {
			if (cefBrowser) {
				cefBrowser.disconnect().catch(() => {})
				cefBrowser = null
			}
			clearStableCefPages()
			const fresh = await ensureCefBrowser(log)
			page = await resolveStableCefPage(fresh, pageHint.needle, debugPort, pageHint.playArg)
		}
	}
	if (!page && pageHint.needle) {
		const warmMs = hostFocusActive()
			? 200
			: Date.now() - lastWarmAt < 5000
				? 200
				: 1200
		page = await warmCefPage(browser, pageHint.needle, debugPort, warmMs, pageHint.playArg)
		if (page) lastWarmAt = Date.now()
	}
	return page
}

/**
 * @param {object} ev
 * @param {{ log?: Function }} opts
 */
function enqueueX11Event(ev, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	eventChain = eventChain
		.then(() => handleX11Event(ev, opts))
		.catch((e) => {
			log('warn', `[CEF bridge] event: ${e?.message || e}`)
		})
}

async function drainCefInteractiveEvents() {
	await eventChain
}

async function handleX11Event(ev, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const zoneId = String(ev.zone || '')
	const type = String(ev.type || '')
	if (!targetForZone(zoneId)) {
		bridgeTrace(log, `skip ${type}: unknown zone "${zoneId}"`)
		return
	}
	const focus = hostFocusActive() ? getCefFocusTarget() : null
	if (focus?.zoneId && zoneId !== focus.zoneId) {
		if (type === 'keydown' || type === 'keyup' || type === 'mousedown' || type === 'mouseup') {
			bridgeTrace(log, `skip ${type}: zone=${zoneId} (cef focus on ${focus.zoneId})`)
			return
		}
	}
	const target = targetForZone(zoneId)
	if (hostFocusActive()) syncPageHintFromFocus()
	if (type === 'mousemove') {
		onPointerZoneEnter(zoneId, log)
		keyboardZoneId = zoneId
		await refreshPageHintIfStale(false)
	} else if (type === 'keydown' || type === 'keyup') {
		if (keyboardZoneId && zoneId !== keyboardZoneId) {
			bridgeTrace(log, `skip ${type}: zone=${zoneId} (keyboard focus on ${keyboardZoneId})`)
			return
		}
		await refreshPageHintIfStale(false)
	} else if (type === 'mousedown') {
		keyboardZoneId = zoneId
		onPointerZoneEnter(zoneId, log)
		if (hostFocusActive() || pageHint.hasHtml) scheduleCefWarm(log, 0)
		else await refreshPageHintIfStale(true)
	} else if (type === 'mouseup') {
		await refreshPageHintIfStale(false)
	} else if (!pageHint.hasHtml && !pageHint.needle) {
		await refreshPageHintIfStale(true)
	}
	let browser
	try {
		browser = await ensureCefBrowser(log)
	} catch (e) {
		log('warn', `[CEF bridge] CDP: ${e?.message || e}`)
		return
	}
	let page = await resolvePageForEvent(browser, type, log)
	if (!page) {
		let cdpUrls = []
		try {
			cdpUrls = await listCefPageUrls(debugPort)
		} catch (_) {}
		const cdpNames = cdpUrls.map((u) => u.split('/').pop())
		const inCdp = pageHint.needle && cdpUrls.some((u) => urlMatchesNeedle(u, pageHint.needle, pageHint.playArg))
		bridgeTrace(
			log,
			`skip ${type} zone=${zoneId}: no CEF page for needle=${pageHint.needle || '(none)'} cdp=[${cdpNames.join(', ')}]` +
				(pageHint.hasHtml && !inCdp ? ' (AMCP INFO has HTML but CEF/CDP target missing — run load-test or PLAY template)' : ''),
		)
		return
	}
	let cefW = target.width
	let cefH = target.height
	if (focus && bridgeConfigRef) {
		const hostSz = channelVideoSize(bridgeConfigRef, focus.hostChannel)
		cefW = hostSz.width
		cefH = hostSz.height
	}
	const pt = type.startsWith('mouse') ? mapPointToCef(target.zone, ev.x, ev.y, cefW, cefH) : { x: 0, y: 0 }
	let pageUrl = ''
	try {
		pageUrl = page.url()
	} catch (_) {}
	if (pageHint.needle && pageUrl && !urlMatchesNeedle(pageUrl, pageHint.needle, pageHint.playArg)) {
		log(
			'warn',
			`[CEF bridge] page/url mismatch: needle=${pageHint.needle} page=${pageUrl.split('/').pop() || pageUrl} — clearing cache`,
		)
		clearStableCefPages()
		page = await resolveStableCefPage(browser, pageHint.needle, debugPort, pageHint.playArg)
		if (!page) {
			bridgeTrace(log, `skip ${type}: no CEF page matching needle=${pageHint.needle}`)
			return
		}
		try {
			pageUrl = page.url()
		} catch (_) {}
	}
	bridgeTrace(
		log,
		`${type} zone=${zoneId} ch${target.channel}-L${target.layer}` +
			(focus ? ` hostCh${focus.hostChannel}` : '') +
			(type.startsWith('key')
				? ` keysym=${ev.keysym || 0} text=${JSON.stringify(ev.text || '')}`
				: ` local=(${ev.x},${ev.y}) → cef=(${pt.x},${pt.y})`) +
			` needle=${pageHint.needle || '?'} page=${pageUrl.split('/').pop() || pageUrl}`,
	)
	const forward = async () => {
		if (type === 'mousedown' || type === 'mouseup' || type === 'mousemove') {
			await forwardMouseEvent(page, type, pt.x, pt.y, ev.button || 1)
		} else if (type === 'keydown' || type === 'keyup') {
			await forwardKeyEvent(page, type, ev.keysym || 0, ev.text || '', {
				modifiers: Array.isArray(ev.modifiers) ? ev.modifiers : undefined,
			})
		}
	}
	try {
		await forward()
		if (type === 'mouseup' && (ev.button || 1) === 1) {
			try {
				const count = await page.evaluate(() => window.__clickCount ?? null)
				if (count != null) bridgeTrace(log, `cef click count after mouseup: ${count}`)
			} catch (_) {}
		}
		if (type === 'keydown') {
			try {
				const kc = await page.evaluate(() => window.__keyCount ?? null)
				if (kc != null) bridgeTrace(log, `cef key count after keydown: ${kc}`)
			} catch (_) {}
		}
		bridgeTrace(log, `forwarded ${type} ok`)
	} catch (e) {
		log('warn', `[CEF bridge] forward ${type} failed: ${e?.message || e}`)
		if (cefBrowser) {
			cefBrowser.disconnect().catch(() => {})
			cefBrowser = null
		}
		clearStableCefPages()
		try {
			browser = await ensureCefBrowser(log)
			page = await resolveStableCefPage(browser, pageHint.needle, debugPort, pageHint.playArg)
			if (!page) {
				bridgeTrace(log, `retry ${type}: still no CEF page`)
				return
			}
			await forward()
			bridgeTrace(log, `forwarded ${type} ok (after CDP reconnect)`)
		} catch (e2) {
			log('warn', `[CEF bridge] forward ${type} retry failed: ${e2?.message || e2}`)
		}
	}
}

function stopCefInteractiveBridge() {
	if (infoPollTimer) {
		clearInterval(infoPollTimer)
		infoPollTimer = null
	}
	if (x11Proc) {
		try {
			x11Proc.kill('SIGTERM')
		} catch (_) {}
		x11Proc = null
	}
	if (cefBrowser) {
		cefBrowser.disconnect().catch(() => {})
		cefBrowser = null
	}
	warmInFlight = null
	clearStableCefPages()
	zoneTargets = new Map()
	activeKey = null
	amcpRef = null
	pageHint = { needle: null, hasHtml: false }
	pageHintAt = 0
	keyboardZoneId = null
	pointerInZone = null
	lastWarmAt = 0
	bridgeConfigRef = null
	if (focusUnsubscribe) {
		focusUnsubscribe()
		focusUnsubscribe = null
	}
	bridgeLogRef = null
	eventChain = Promise.resolve()
}

/**
 * @param {object} config
 * @param {{ log?: Function, amcp?: object }} [opts]
 */
async function startCefInteractiveBridge(config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	if (!bridgeEnabledInConfig(config)) {
		stopCefInteractiveBridge()
		return { ok: false, reason: 'disabled_or_no_interactive_zones' }
	}
	if (!fs.existsSync(X11_SCRIPT)) {
		log('warn', `[CEF bridge] missing ${X11_SCRIPT}`)
		return { ok: false, reason: 'missing_x11_script' }
	}

	const zones = listInteractiveZones(config)
	const key = zonesKey(zones)
	if (x11Proc && activeKey === key) {
		amcpRef = opts.amcp || amcpRef
		return { ok: true, reason: 'already_running', zones: zones.length }
	}

	stopCefInteractiveBridge()
	activeKey = key
	amcpRef = opts.amcp || null
	bridgeConfigRef = config
	bridgeLogRef = log

	if (focusUnsubscribe) focusUnsubscribe()
	focusUnsubscribe = onCefFocusChange(() => notifyCefFocusChanged(bridgeLogRef || log))
	if (hostFocusActive()) syncPageHintFromFocus()

	zoneTargets = new Map()
	for (const z of zones) {
		const size = channelVideoSize(config, z.channel)
		// Multiview screen consumer is 1:1 with layout pixels (often 2160p); casparServer.multiview_mode can lag.
		const width = z.id === 'multiview' ? z.width : size.width
		const height = z.id === 'multiview' ? z.height : size.height
		zoneTargets.set(z.id, {
			channel: z.channel,
			layer: z.layer,
			width,
			height,
			zone: { x: z.x, y: z.y, width: z.width, height: z.height },
		})
	}

	const payload = JSON.stringify({
		zones: zones.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
	})
	const env = displaySessionEnv()
	x11Proc = spawn('python3', ['-u', X11_SCRIPT], {
		env,
		stdio: ['pipe', 'pipe', 'pipe'],
	})
	x11Proc.stdin.write(payload)
	x11Proc.stdin.end()

	let buf = ''
	x11Proc.stdout.on('data', (chunk) => {
		buf += String(chunk)
		let nl
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl).trim()
			buf = buf.slice(nl + 1)
			if (!line) continue
			try {
				const ev = JSON.parse(line)
				if (shouldTraceX11Event(String(ev.type || ''))) {
					const extra =
						ev.type === 'keydown' || ev.type === 'keyup'
							? ` keysym=${ev.keysym ?? 0} text=${JSON.stringify(ev.text || '')}`
							: ` (${ev.x},${ev.y}) btn=${ev.button ?? 0}`
					bridgeTrace(log, `x11→node ${ev.type} zone=${ev.zone}${extra}`)
				}
				enqueueX11Event(ev, { log })
			} catch (e) {
				log('warn', `[CEF bridge] bad x11 json: ${line.slice(0, 120)} (${e?.message || e})`)
			}
		}
	})
	x11Proc.stderr.on('data', (chunk) => {
		const t = String(chunk).trim()
		if (t) log('info', `[CEF bridge] ${t}`)
	})
	x11Proc.on('exit', (code, sig) => {
		if (activeKey === key) {
			log('warn', `[CEF bridge] X11 capture exited code=${code} sig=${sig}`)
			x11Proc = null
			activeKey = null
		}
	})

	await refreshPageHint().catch(() => {})
	bridgeTrace(log, `pageHint after start: needle=${pageHint.needle || '(none)'} hasHtml=${pageHint.hasHtml}`)
	for (let attempt = 0; attempt < 6; attempt++) {
		try {
			await ensureCefBrowser(log)
			break
		} catch (e) {
			if (attempt >= 5) log('warn', `[CEF bridge] CDP preconnect: ${e?.message || e}`)
			else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
		}
	}
	await warmCefInteractivePage(log)
	scheduleCefWarm(log, 1500)
	infoPollTimer = setInterval(() => {
		if (hostFocusActive()) {
			syncPageHintFromFocus()
			void warmCefInteractivePage(log)
			return
		}
		void (async () => {
			const prev = pageHint.needle
			await refreshPageHintIfStale(false)
			if (pageHint.needle !== prev || pageHint.hasHtml) {
				await warmCefInteractivePage(log)
			}
		})()
	}, WARM_INTERVAL_MS)

	log(
		'info',
		`[CEF bridge] Started — ${zones.length} interactive zone(s): ${zones.map((z) => `${z.id} ch${z.channel} L${z.layer}`).join(', ')}`,
	)
	return { ok: true, zones: zones.length }
}

/**
 * @param {object} config
 * @param {{ log?: Function, amcp?: object }} [opts]
 */
function syncCefInteractiveBridge(config, opts = {}) {
	if (!bridgeEnabledInConfig(config)) {
		stopCefInteractiveBridge()
		return Promise.resolve({ ok: false, reason: 'disabled' })
	}
	return startCefInteractiveBridge(config, opts)
}

module.exports = {
	listInteractiveZones,
	resolveInteractiveLayer,
	bridgeEnabledInConfig,
	startCefInteractiveBridge,
	stopCefInteractiveBridge,
	syncCefInteractiveBridge,
	handleX11Event,
	enqueueX11Event,
	drainCefInteractiveEvents,
	notifyCefInteractiveAmcpLines,
	notifyCefFocusChanged,
	hostFocusActive,
}
