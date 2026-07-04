'use strict'

const { swallow } = require('../utils/swallow')
const { infoResponseToXml } = require('../caspar/channel-info-xml')
const {
	readCefDebugPortFromCasparXml,
	connectCefBrowser,
	htmlNeedleFromInfoXml,
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
	cefFocusTargetForHostChannel,
} = require('./cef-focus-registry')
const { S, hostFocusActive, syncPageHintFromFocus } = require('./cef-interactive-bridge-shared')
const {
	bridgeEnabledInConfig,
	resolveInteractiveLayer,
	listInteractiveZones,
	channelVideoSize,
} = require('./cef-interactive-bridge-zones')

async function ensureCefBrowser(log) {
	const port = readCefDebugPortFromCasparXml()
	if (port <= 0) throw new Error('remote-debugging-port not set in casparcg.config')
	if (S.cefBrowser && S.debugPort === port && S.cefBrowser.connected) return S.cefBrowser
	if (S.cefBrowser) {
		S.cefBrowser.disconnect().catch(() => {})
		S.cefBrowser = null
	}
	clearStableCefPages()
	S.debugPort = port
	S.cefBrowser = await connectCefBrowser(port)
	log?.('info', `[CEF bridge] Connected CDP :${port}`)
	return S.cefBrowser
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
	if (!S.amcpRef?.info) return false
	const channels = new Set([...zoneTargets.values()].map((t) => t.channel))
	for (const ch of channels) {
		try {
			const r = await amcpRef.info(ch)
			const xml = infoResponseToXml(r)
			const layer = [...zoneTargets.values()].find((t) => t.channel === ch)?.layer ?? resolveInteractiveLayer({})
			const hint = htmlNeedleFromInfoXml(xml, layer)
			if (hint.hasHtml) {
				if (hint.needle !== S.pageHint.needle) clearStableCefPages()
				S.pageHint = hint
				S.pageHintAt = Date.now()
				return true
			}
		} catch (err) { swallow(err, { tag: 'cef-bridge' }) }
	}
	return false
}

/**
 * @param {boolean} [force]
 */
async function refreshPageHintIfStale(force = false) {
	if (hostFocusActive()) {
		if (force || !S.pageHint.hasHtml) syncPageHintFromFocus()
		return
	}
	if (!force && S.pageHint.hasHtml && Date.now() - S.pageHintAt < S.PAGE_HINT_TTL_MS) return
	await refreshPageHint()
}

/**
 * @param {Function} [log]
 */
async function warmCefInteractivePage(log) {
	if (!S.pageHint.needle && !S.pageHint.hasHtml) return null
	try {
		const browser = await ensureCefBrowser(log)
		let page = await resolveStableCefPage(browser, S.pageHint.needle, S.debugPort, S.pageHint.playArg)
		if (!page && S.pageHint.needle) {
			page = await warmCefPage(browser, S.pageHint.needle, S.debugPort, 3000, S.pageHint.playArg)
		}
		if (page) {
			S.lastWarmAt = Date.now()
			try {
				await page.evaluate(() => {
					document.body?.focus?.()
				})
			} catch (err) { swallow(err, { tag: 'cef-bridge' }) }
			bridgeTrace(log, `warmed CEF page needle=${S.pageHint.needle || '(any)'}`)
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
		if (S.warmInFlight) {
			void warmInFlight.finally(() => warmCefInteractivePage(log))
			return
		}
		S.warmInFlight = warmCefInteractivePage(log).finally(() => {
			S.warmInFlight = null
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
	S.bridgeConfigRef = config
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
					S.pageHint = { needle: null, hasHtml: false, playArg: null }
					S.pageHintAt = 0
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
	if (!S.activeKey) return
	if (syncPageHintFromFocus()) {
		scheduleCefWarm(log, 0)
		scheduleCefWarm(log, 400)
	} else if (!hostFocusActive()) {
		S.pageHint = { needle: null, hasHtml: false, playArg: null }
		S.pageHintAt = 0
		clearStableCefPages()
	}
}

/**
 * @param {string} zoneId
 * @param {Function} [log]
 */
function onPointerZoneEnter(zoneId, log) {
	if (!zoneId || zoneId === S.pointerInZone) return
	S.pointerInZone = zoneId
	if (Date.now() - S.lastWarmAt < S.ZONE_WARM_DEBOUNCE_MS) return
	scheduleCefWarm(log, 0)
}

/**
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} type
 * @param {Function} log
 */
async function resolvePageForEvent(browser, type, log) {
	let page = await resolveStableCefPage(browser, S.pageHint.needle, S.debugPort, S.pageHint.playArg)
	if (!page && S.pageHint.needle) {
		let cdpUrls = []
		try {
			cdpUrls = await listCefPageUrls(S.debugPort)
		} catch (err) { swallow(err, { tag: 'cef-bridge' }) }
		if (cdpUrls.some((u) => urlMatchesNeedle(u, S.pageHint.needle, S.pageHint.playArg))) {
			if (S.cefBrowser) {
				S.cefBrowser.disconnect().catch(() => {})
				S.cefBrowser = null
			}
			clearStableCefPages()
			const fresh = await ensureCefBrowser(log)
			page = await resolveStableCefPage(fresh, S.pageHint.needle, S.debugPort, S.pageHint.playArg)
		}
	}
	if (!page && S.pageHint.needle) {
		const warmMs = hostFocusActive()
			? 200
			: Date.now() - S.lastWarmAt < 5000
				? 200
				: 1200
		page = await warmCefPage(browser, S.pageHint.needle, S.debugPort, warmMs, S.pageHint.playArg)
		if (page) S.lastWarmAt = Date.now()
	}
	return page
}

/**
 * @param {object} ev
 * @param {{ log?: Function }} opts
 */
function enqueueX11Event(ev, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	S.eventChain = S.eventChain
		.then(() => handleX11Event(ev, opts))
		.catch((e) => {
			log('warn', `[CEF bridge] event: ${e?.message || e}`)
		})
}

async function drainCefInteractiveEvents() {
	await S.eventChain
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
		S.keyboardZoneId = zoneId
		await refreshPageHintIfStale(false)
	} else if (type === 'keydown' || type === 'keyup') {
		if (S.keyboardZoneId && zoneId !== S.keyboardZoneId) {
			bridgeTrace(log, `skip ${type}: zone=${zoneId} (keyboard focus on ${S.keyboardZoneId})`)
			return
		}
		await refreshPageHintIfStale(false)
	} else if (type === 'mousedown') {
		S.keyboardZoneId = zoneId
		onPointerZoneEnter(zoneId, log)
		if (hostFocusActive() || S.pageHint.hasHtml) scheduleCefWarm(log, 0)
		else await refreshPageHintIfStale(true)
	} else if (type === 'mouseup') {
		await refreshPageHintIfStale(false)
	} else if (!S.pageHint.hasHtml && !S.pageHint.needle) {
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
			cdpUrls = await listCefPageUrls(S.debugPort)
		} catch (err) { swallow(err, { tag: 'cef-bridge' }) }
		const cdpNames = cdpUrls.map((u) => u.split('/').pop())
		const inCdp = S.pageHint.needle && cdpUrls.some((u) => urlMatchesNeedle(u, S.pageHint.needle, S.pageHint.playArg))
		bridgeTrace(
			log,
			`skip ${type} zone=${zoneId}: no CEF page for needle=${S.pageHint.needle || '(none)'} cdp=[${cdpNames.join(', ')}]` +
				(S.pageHint.hasHtml && !inCdp ? ' (AMCP INFO has HTML but CEF/CDP target missing — run load-test or PLAY template)' : ''),
		)
		return
	}
	let cefW = target.width
	let cefH = target.height
	if (focus && S.bridgeConfigRef) {
		const hostSz = channelVideoSize(S.bridgeConfigRef, focus.hostChannel)
		cefW = hostSz.width
		cefH = hostSz.height
	}
	const pt = type.startsWith('mouse') ? mapPointToCef(target.zone, ev.x, ev.y, cefW, cefH) : { x: 0, y: 0 }
	let pageUrl = ''
	try {
		pageUrl = page.url()
	} catch (err) { swallow(err, { tag: 'cef-bridge' }) }
	if (S.pageHint.needle && pageUrl && !urlMatchesNeedle(pageUrl, S.pageHint.needle, S.pageHint.playArg)) {
		log(
			'warn',
			`[CEF bridge] page/url mismatch: needle=${S.pageHint.needle} page=${pageUrl.split('/').pop() || pageUrl} — clearing cache`,
		)
		clearStableCefPages()
		page = await resolveStableCefPage(browser, S.pageHint.needle, S.debugPort, S.pageHint.playArg)
		if (!page) {
			bridgeTrace(log, `skip ${type}: no CEF page matching needle=${S.pageHint.needle}`)
			return
		}
		try {
			pageUrl = page.url()
		} catch (err) { swallow(err, { tag: 'cef-bridge' }) }
	}
	bridgeTrace(
		log,
		`${type} zone=${zoneId} ch${target.channel}-L${target.layer}` +
			(focus ? ` hostCh${focus.hostChannel}` : '') +
			(type.startsWith('key')
				? ` keysym=${ev.keysym || 0} text=${JSON.stringify(ev.text || '')}`
				: ` local=(${ev.x},${ev.y}) → cef=(${pt.x},${pt.y})`) +
			` needle=${S.pageHint.needle || '?'} page=${pageUrl.split('/').pop() || pageUrl}`,
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
			} catch (err) { swallow(err, { tag: 'cef-bridge' }) }
		}
		if (type === 'keydown') {
			try {
				const kc = await page.evaluate(() => window.__keyCount ?? null)
				if (kc != null) bridgeTrace(log, `cef key count after keydown: ${kc}`)
			} catch (err) { swallow(err, { tag: 'cef-bridge' }) }
		}
		bridgeTrace(log, `forwarded ${type} ok`)
	} catch (e) {
		log('warn', `[CEF bridge] forward ${type} failed: ${e?.message || e}`)
		if (S.cefBrowser) {
			S.cefBrowser.disconnect().catch(() => {})
			S.cefBrowser = null
		}
		clearStableCefPages()
		try {
			browser = await ensureCefBrowser(log)
			page = await resolveStableCefPage(browser, S.pageHint.needle, S.debugPort, S.pageHint.playArg)
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

module.exports = {
	ensureCefBrowser,
	targetForZone,
	refreshPageHint,
	refreshPageHintIfStale,
	warmCefInteractivePage,
	scheduleCefWarm,
	notifyCefInteractiveAmcpLines,
	notifyCefFocusChanged,
	onPointerZoneEnter,
	resolvePageForEvent,
	enqueueX11Event,
	drainCefInteractiveEvents,
	handleX11Event,
}
