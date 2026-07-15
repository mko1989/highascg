'use strict'

const { getChannelMap } = require('../config/routing')
const { getModeDimensions } = require('../config/config-modes')
const { isWebpageHostCandidate } = require('../config/host-live-sources')
const {
	readCefDebugPortFromCasparXml,
	connectCefBrowser,
	resolveStableCefPage,
	warmCefPage,
	clearStableCefPages,
	urlMatchesNeedle,
	listCefPageUrls,
	forwardMouseEvent,
	forwardKeyEvent,
} = require('./cef-interactive-cdp')
const {
	getCefFocusTarget,
	setCefFocusTarget,
	clearCefFocusTarget,
} = require('./cef-focus-registry')

/** @type {import('puppeteer-core').Browser | null} */
let cefBrowser = null
/** @type {number} */
let debugPort = 0

/**
 * @param {object} config
 * @param {{ sourceId?: string, value?: string }} query
 */
function findWebpageHostSource(config, query) {
	const list = Array.isArray(config?.extraLiveSources) ? config.extraLiveSources : []
	const sourceId = String(query?.sourceId || '').trim()
	const value = String(query?.value || '').trim()
	return list.find((item) => {
		if (!isWebpageHostCandidate(item)) return false
		if (sourceId && String(item.sourceId || '') === sourceId) return true
		if (value && String(item.value || '') === value) return true
		return false
	})
}

/**
 * @param {object} config
 */
function listFocusableWebpageHosts(config) {
	const list = Array.isArray(config?.extraLiveSources) ? config.extraLiveSources : []
	return list
		.filter((item) => isWebpageHostCandidate(item) && item.interactiveCapable !== false)
		.map((item) => {
			const hostChannel = parseInt(String(item.hostChannel), 10)
			const hostLayer = parseInt(String(item.hostLayer ?? 1), 10) || 1
			const needle = String(item.cefNeedle || item.playArg || item.templateOrUrl || '').trim()
			return {
				sourceId: String(item.sourceId || ''),
				label: String(item.label || item.sourceId || needle || 'Webpage'),
				hostChannel,
				hostLayer,
				needle,
				playArg: String(item.playArg || item.templateOrUrl || '').trim(),
				route: String(item.value || ''),
			}
		})
		.filter((t) => t.sourceId && t.needle && Number.isFinite(t.hostChannel))
}

/**
 * @param {object} config
 * @param {number} hostChannel
 */
function hostChannelVideoSize(config, hostChannel) {
	const map = getChannelMap(config)
	const cs = config?.casparServer || config
	let mode = cs.multiview_mode || '1080p5000'
	if (hostChannel === map.multiviewCh) mode = cs.multiview_mode || mode
	else {
		const idx = (map.programChannels || []).indexOf(hostChannel)
		if (idx >= 0) mode = cs[`screen_${idx + 1}_mode`] || mode
	}
	const dims = getModeDimensions(String(mode || '1080p5000'), config, 1)
	return { width: dims?.width || 1920, height: dims?.height || 1080 }
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {boolean} [normalized]
 */
function resolveCefCoordinates(x, y, width, height, normalized = false) {
	const nx = Number(x)
	const ny = Number(y)
	if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
		throw new Error('x and y must be numbers')
	}
	if (normalized || (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1)) {
		return {
			x: Math.round(nx * Math.max(1, width - 1)),
			y: Math.round(ny * Math.max(1, height - 1)),
		}
	}
	return {
		x: Math.round(Math.max(0, Math.min(width - 1, nx))),
		y: Math.round(Math.max(0, Math.min(height - 1, ny))),
	}
}

/**
 * @param {Function} [log]
 */
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
	log?.('info', `[CEF forward] Connected CDP :${port}`)
	return cefBrowser
}

/**
 * @param {string} needle
 * @param {Function} [log]
 */
async function resolveCefPageForNeedle(needle, log, playArg = null) {
	const browser = await ensureCefBrowser(log)
	let page = await resolveStableCefPage(browser, needle, debugPort, playArg)
	if (!page) {
		page = await warmCefPage(browser, needle, debugPort, 2000, playArg)
	}
	if (!page) throw new Error(`CEF page not found for needle=${needle}`)
	return page
}

/**
 * @param {object} config
 * @param {string} sourceId
 * @param {string} [zoneId]
 */
function buildFocusTargetFromSource(config, sourceId, zoneId = 'multiview') {
	const source = findWebpageHostSource(config, { sourceId })
	if (!source) return null
	const hostChannel = parseInt(String(source.hostChannel), 10)
	const hostLayer = parseInt(String(source.hostLayer ?? 1), 10) || 1
	const needle = String(source.cefNeedle || source.playArg || source.templateOrUrl || '').trim()
	if (!needle || !Number.isFinite(hostChannel)) return null
	return {
		sourceId: String(source.sourceId || sourceId),
		hostChannel,
		hostLayer,
		needle,
		playArg: String(source.playArg || source.templateOrUrl || '').trim(),
		zoneId: String(zoneId || 'multiview'),
	}
}

/**
 * @param {object} config
 * @param {string} sourceId
 * @param {{ zoneId?: string, log?: Function }} [opts]
 */
async function setCefFocusFromSourceId(config, sourceId, opts = {}) {
	const target = buildFocusTargetFromSource(config, sourceId, opts.zoneId)
	if (!target) return { ok: false, status: 404, error: 'Unknown or non-interactive sourceId' }
	setCefFocusTarget(target)
	try {
		await resolveCefPageForNeedle(target.needle, opts.log, target.playArg)
	} catch (e) {
		return { ok: false, status: 502, error: e?.message || String(e), cefFocusTarget: target }
	}
	return { ok: true, cefFocusTarget: target }
}

function clearCefFocusOnly() {
	clearCefFocusTarget()
	return { ok: true, cefFocusTarget: null }
}

/**
 * @param {object} config
 * @param {object} [ctx]
 */
async function listCefInteractiveTargets(config, ctx) {
	const focus = getCefFocusTarget()
	const port = readCefDebugPortFromCasparXml()
	let cdpUrls = []
	if (port > 0) {
		try {
			cdpUrls = await listCefPageUrls(port)
		} catch (_) {}
	}
	const hosts = listFocusableWebpageHosts(config)
	return hosts.map((h) => ({
		...h,
		focused: focus?.sourceId === h.sourceId,
		cdpAttached: cdpUrls.some((u) => urlMatchesNeedle(u, h.needle, h.playArg || h.route)),
		operatorFullscreen:
			ctx?._hostOperatorFullscreen?.sourceId === h.sourceId ? ctx._hostOperatorFullscreen : null,
	}))
}

/**
 * Resolve needle + host channel for a forward request.
 * @param {object} config
 * @param {string} [sourceId]
 */
function resolveForwardTarget(config, sourceId) {
	const focus = getCefFocusTarget()
	const sid = String(sourceId || focus?.sourceId || '').trim()
	if (!sid) return { ok: false, status: 400, error: 'sourceId required' }
	if (focus && focus.sourceId !== sid) {
		return { ok: false, status: 409, error: `sourceId does not match active focus (${focus.sourceId})` }
	}
	const target = focus || buildFocusTargetFromSource(config, sid)
	if (!target) return { ok: false, status: 404, error: 'Unknown sourceId' }
	return { ok: true, target }
}

/**
 * Shared CDP forward for X11 bridge and HTTP API (WO-89).
 * @param {object} opts
 */
async function forwardToCefTarget(opts) {
	const config = opts.config || {}
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const type = String(opts.type || '').trim()
	if (!type) return { ok: false, status: 400, error: 'type required' }

	const resolved = resolveForwardTarget(config, opts.sourceId)
	if (!resolved.ok) return resolved
	const { target } = resolved
	const size = hostChannelVideoSize(config, target.hostChannel)

	if (type === 'eval') {
		const expression = String(opts.expression || '').trim()
		if (!expression) return { ok: false, status: 400, error: 'expression required' }
		const page = await resolveCefPageForNeedle(target.needle, log, target.playArg)
		// WO-247: Runtime.evaluate takes the raw expression string directly — no eval-wrapper needed.
		const value = await page.evaluate(expression)
		return { ok: true, sourceId: target.sourceId, value }
	}

	if (type === 'mousedown' || type === 'mouseup' || type === 'mousemove') {
		const pt = resolveCefCoordinates(
			opts.x,
			opts.y,
			size.width,
			size.height,
			opts.coordsNormalized === true || opts.normalized === true,
		)
		const page = await resolveCefPageForNeedle(target.needle, log, target.playArg)
		await forwardMouseEvent(page, type, pt.x, pt.y, parseInt(String(opts.button ?? 1), 10) || 1)
		return { ok: true, sourceId: target.sourceId, type, x: pt.x, y: pt.y }
	}

	if (type === 'keydown' || type === 'keyup') {
		const page = await resolveCefPageForNeedle(target.needle, log, target.playArg)
		const keysym = parseInt(String(opts.keysym ?? 0), 10) || 0
		const text = String(opts.text ?? opts.key ?? '')
		await forwardKeyEvent(page, type, keysym, text, {
			modifiers: Array.isArray(opts.modifiers) ? opts.modifiers : undefined,
		})
		return { ok: true, sourceId: target.sourceId, type, keysym, text }
	}

	return { ok: false, status: 400, error: `unsupported type: ${type}` }
}

module.exports = {
	findWebpageHostSource,
	listFocusableWebpageHosts,
	hostChannelVideoSize,
	resolveCefCoordinates,
	setCefFocusFromSourceId,
	clearCefFocusOnly,
	listCefInteractiveTargets,
	forwardToCefTarget,
	buildFocusTargetFromSource,
}
