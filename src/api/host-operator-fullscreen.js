'use strict'

const { getChannelMap } = require('../config/routing')
const { isWebpageHostCandidate } = require('../config/host-live-sources')
const { calculateLayoutPositions } = require('../utils/os-layout-calculator')
const {
	multiviewScreenConsumerEnabled,
	multiviewInteractiveEnabled,
	screenConsumerEnabled,
	screenInteractiveEnabled,
	multiviewPhysicalPortIndex,
} = require('../utils/x-display-session')

/**
 * WO-257: relocated from the (removed) CEF interactive-bridge zone resolver
 * (src/system/cef-interactive-bridge-zones.js). The `interactive` config flags
 * (multiviewInteractiveEnabled/screenInteractiveEnabled) still gate which outputs are
 * eligible operator-fullscreen targets and the default reserved layer is still 999 —
 * only the CEF input-forwarding half of that concept is gone; this is routing-only now.
 * @param {object} config
 */
function resolveOperatorFullscreenLayer(config) {
	const fromEnv = parseInt(String(process.env.HIGHASCG_CEF_INTERACTIVE_LAYER || ''), 10)
	if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv
	const ot = config?.operatorTools
	const fromCfg = parseInt(String(ot?.cefInteractiveLayer ?? ''), 10)
	if (Number.isFinite(fromCfg) && fromCfg >= 0) return fromCfg
	return 999
}

/**
 * @param {object} config
 * @returns {Array<{ id: string, channel: number, layer: number }>}
 */
function listOperatorFullscreenZones(config) {
	const layout = calculateLayoutPositions(config)
	const map = getChannelMap(config)
	const layer = resolveOperatorFullscreenLayer(config)
	/** @type {Array<{ id: string, channel: number, layer: number }>} */
	const zones = []
	const mv = layout?.multiview?.[1]
	if (multiviewScreenConsumerEnabled(config) && multiviewInteractiveEnabled(config) && mv?.width > 0 && map.multiviewCh != null) {
		zones.push({ id: 'multiview', channel: map.multiviewCh, layer })
	}
	const mvPort = multiviewPhysicalPortIndex(config)
	for (let n = 1; n <= 8; n++) {
		const sc = layout?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n) || !screenInteractiveEnabled(config, n)) continue
		if (mvPort && n === mvPort) continue
		const ch = map.programCh?.(n)
		if (ch == null) continue
		zones.push({ id: `screen-${n}`, channel: ch, layer })
	}
	return zones
}

/**
 * @param {object} config
 */
function resolveOperatorRouteTarget(config) {
	const zones = listOperatorFullscreenZones(config || {})
	const mv = zones.find((z) => z.id === 'multiview')
	if (mv) {
		return {
			channel: mv.channel,
			layer: resolveOperatorFullscreenLayer(config),
			zoneId: mv.id,
		}
	}
	const first = zones[0]
	if (!first) return null
	return {
		channel: first.channel,
		layer: first.layer,
		zoneId: first.id,
	}
}

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
 * @param {object} source
 * @param {{ channel: number, layer: number, zoneId: string }} target
 */
function buildOperatorFullscreenState(source, target) {
	const hostChannel = parseInt(String(source.hostChannel), 10)
	const hostLayer = parseInt(String(source.hostLayer ?? 1), 10) || 1
	return {
		active: true,
		sourceId: String(source.sourceId || ''),
		hostChannel,
		hostLayer,
		route: String(source.value || `route://${hostChannel}-${hostLayer}`),
		operatorChannel: target.channel,
		operatorLayer: target.layer,
		zoneId: target.zoneId,
		label: String(source.label || source.sourceId || 'Webpage'),
		updatedAt: Date.now(),
	}
}

function broadcastOperatorFullscreen(ctx) {
	if (typeof ctx._wsBroadcast !== 'function') return
	ctx._wsBroadcast('change', { path: 'hostOperatorFullscreen', value: ctx._hostOperatorFullscreen })
}

/**
 * @param {object} ctx
 * @param {{ quiet?: boolean }} [opts]
 */
async function clearHostOperatorFullscreen(ctx, opts = {}) {
	const prev = ctx._hostOperatorFullscreen
	const target =
		prev?.operatorChannel != null
			? { channel: prev.operatorChannel, layer: prev.operatorLayer ?? resolveOperatorFullscreenLayer(ctx.config) }
			: resolveOperatorRouteTarget(ctx.config)

	if (target && ctx.amcp) {
		try {
			await ctx.amcp.raw(`CLEAR ${target.channel}-${target.layer}`)
			await ctx.amcp.raw(`MIXER ${target.channel} COMMIT`)
		} catch (e) {
			if (!opts.quiet) throw e
		}
	}

	const hostChannel = prev?.hostChannel
	ctx._hostOperatorFullscreen = null
	broadcastOperatorFullscreen(ctx)

	return {
		ok: true,
		active: false,
		hostChannel: hostChannel ?? null,
		message: hostChannel != null ? `Webpage still running on ch ${hostChannel}` : 'Operator route cleared',
		hostOperatorFullscreen: null,
	}
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string }} payload
 */
async function applyHostOperatorFullscreen(ctx, payload) {
	if (!ctx?.amcp) return { ok: false, status: 503, error: 'AMCP not connected' }
	const source = findWebpageHostSource(ctx.config, payload)
	if (!source) return { ok: false, status: 404, error: 'Webpage host source not found' }
	if (source.interactiveCapable === false) {
		return { ok: false, status: 400, error: 'Source is not interactive-capable' }
	}

	const target = resolveOperatorRouteTarget(ctx.config)
	if (!target) {
		return { ok: false, status: 400, error: 'No interactive operator display configured (multiview or screen consumer)' }
	}

	if (ctx._hostOperatorFullscreen?.sourceId && ctx._hostOperatorFullscreen.sourceId !== source.sourceId) {
		await clearHostOperatorFullscreen(ctx, { quiet: true })
	}

	const route = String(source.value || '').trim()
	if (!route.startsWith('route://')) {
		return { ok: false, status: 400, error: 'Invalid host route on source' }
	}

	const { channel, layer } = target
	// WO-156: routing the operator display channel into itself wedges it in CasparCG.
	const { findSelfRouteViolation } = require('../engine/scene-route-deps')
	const selfRoute = findSelfRouteViolation(route, channel)
	if (selfRoute) {
		return {
			ok: false,
			status: 400,
			error: `Operator fullscreen blocked: ${selfRoute.reason} (self-route would wedge channel ${channel})`,
		}
	}
	const cmds = [`PLAY ${channel}-${layer} ${route}`, `MIXER ${channel}-${layer} FILL 0 0 1 1`, `MIXER ${channel} COMMIT`]
	for (const cmd of cmds) {
		await ctx.amcp.raw(cmd)
	}

	const state = buildOperatorFullscreenState(source, target)
	ctx._hostOperatorFullscreen = state
	broadcastOperatorFullscreen(ctx)

	if (typeof ctx.log === 'function') {
		ctx.log(
			'info',
			`Operator fullscreen: ${state.label} → ch${channel}-L${layer} (${route}); host ch${state.hostChannel} keeps playing`,
		)
	}

	return { ok: true, ...state }
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string, action?: string }} payload
 */
async function handleHostOperatorFullscreen(ctx, payload) {
	const action = String(payload?.action || 'toggle').toLowerCase()
	const source = findWebpageHostSource(ctx.config, payload)
	const activeForSource =
		source &&
		ctx._hostOperatorFullscreen?.active &&
		ctx._hostOperatorFullscreen?.sourceId === String(source.sourceId || '')

	if (action === 'off' || (action === 'toggle' && activeForSource)) {
		return clearHostOperatorFullscreen(ctx)
	}
	if (action === 'on' || action === 'toggle') {
		return applyHostOperatorFullscreen(ctx, payload)
	}
	return { ok: false, status: 400, error: 'action must be on, off, or toggle' }
}

function getHostOperatorFullscreenSnapshot(ctx) {
	return {
		hostOperatorFullscreen: ctx._hostOperatorFullscreen ?? null,
	}
}

module.exports = {
	resolveOperatorRouteTarget,
	findWebpageHostSource,
	applyHostOperatorFullscreen,
	clearHostOperatorFullscreen,
	handleHostOperatorFullscreen,
	getHostOperatorFullscreenSnapshot,
	buildOperatorFullscreenState,
}
