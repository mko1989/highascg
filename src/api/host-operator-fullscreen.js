'use strict'

const { getChannelMap } = require('../config/routing')
const { isWebpageHostCandidate } = require('../config/host-live-sources')
const { listInteractiveZones, resolveInteractiveLayer, notifyCefFocusChanged } = require('../system/cef-interactive-bridge')
const { setCefFocusTarget, clearCefFocusTarget } = require('../system/cef-focus-registry')

/**
 * @param {object} config
 */
function resolveOperatorRouteTarget(config) {
	const zones = listInteractiveZones(config || {})
	const mv = zones.find((z) => z.id === 'multiview')
	if (mv) {
		return {
			channel: mv.channel,
			layer: resolveInteractiveLayer(config),
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
	const cefFocusTarget = {
		sourceId: String(source.sourceId || ''),
		hostChannel,
		hostLayer,
		needle: String(source.cefNeedle || source.playArg || source.templateOrUrl || '').trim(),
		playArg: String(source.playArg || source.templateOrUrl || '').trim(),
		zoneId: target.zoneId,
	}
	return {
		active: true,
		sourceId: cefFocusTarget.sourceId,
		hostChannel,
		hostLayer,
		route: String(source.value || `route://${hostChannel}-${hostLayer}`),
		operatorChannel: target.channel,
		operatorLayer: target.layer,
		zoneId: target.zoneId,
		label: String(source.label || source.sourceId || 'Webpage'),
		cefFocusTarget,
		updatedAt: Date.now(),
	}
}

function broadcastOperatorFullscreen(ctx) {
	if (typeof ctx._wsBroadcast !== 'function') return
	ctx._wsBroadcast('change', { path: 'hostOperatorFullscreen', value: ctx._hostOperatorFullscreen })
	ctx._wsBroadcast('change', { path: 'cefFocusTarget', value: ctx._cefFocusTarget })
}

/**
 * @param {object} ctx
 * @param {{ quiet?: boolean }} [opts]
 */
async function clearHostOperatorFullscreen(ctx, opts = {}) {
	const prev = ctx._hostOperatorFullscreen
	const target =
		prev?.operatorChannel != null
			? { channel: prev.operatorChannel, layer: prev.operatorLayer ?? resolveInteractiveLayer(ctx.config) }
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
	ctx._cefFocusTarget = null
	clearCefFocusTarget()
	notifyCefFocusChanged(ctx.log)
	broadcastOperatorFullscreen(ctx)

	return {
		ok: true,
		active: false,
		hostChannel: hostChannel ?? null,
		message: hostChannel != null ? `Webpage still running on ch ${hostChannel}` : 'Operator route cleared',
		hostOperatorFullscreen: null,
		cefFocusTarget: null,
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
	const cmds = [`PLAY ${channel}-${layer} ${route}`, `MIXER ${channel}-${layer} FILL 0 0 1 1`, `MIXER ${channel} COMMIT`]
	for (const cmd of cmds) {
		await ctx.amcp.raw(cmd)
	}

	const state = buildOperatorFullscreenState(source, target)
	ctx._hostOperatorFullscreen = state
	ctx._cefFocusTarget = state.cefFocusTarget
	setCefFocusTarget(state.cefFocusTarget)
	notifyCefFocusChanged(ctx.log)
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
		cefFocusTarget: ctx._cefFocusTarget ?? null,
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
