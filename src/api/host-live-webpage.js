'use strict'

const { isWebpageHostCandidate, resolveWebpagePlayTarget } = require('../config/host-live-sources')
const { playHostLiveSourceNow } = require('../config/host-live-sources-setup')
const { findWebpageHostSource, buildOperatorFullscreenState } = require('../api/host-operator-fullscreen')
const { setCefFocusTarget } = require('../system/cef-focus-registry')
const { notifyCefFocusChanged, notifyCefInteractiveAmcpLines } = require('../system/cef-interactive-bridge')
const { clearStableCefPages } = require('../system/cef-interactive-cdp')
const { enrichExtraLiveSource } = require('../config/extra-live-source-enrich')

/**
 * @param {object} ctx
 * @param {object} patch
 */
function persistConfigPatch(ctx, patch) {
	if (!ctx.configManager) {
		Object.assign(ctx.config, patch)
		return true
	}
	return ctx.configManager.save({ ...ctx.configManager.get(), ...patch })
}

/**
 * @param {object} existing
 * @param {string} urlOrTemplate
 * @param {string} [label]
 */
function patchWebpageHostUrl(existing, urlOrTemplate, label) {
	const raw = String(urlOrTemplate || '').trim()
	if (!raw) throw new Error('URL or template name required')
	const { templateOrUrl, cefNeedle, playArg } = resolveWebpagePlayTarget(raw)
	const nextLabel =
		label != null && String(label).trim()
			? String(label).trim()
			: raw.length > 64
				? `${raw.slice(0, 61)}…`
				: raw
	return {
		...existing,
		type: 'browser',
		routeType: 'webpage_host',
		templateOrUrl,
		cefNeedle,
		playArg,
		label: nextLabel,
		hostChannel: existing.hostChannel,
		hostLayer: existing.hostLayer ?? 1,
		sourceId: existing.sourceId,
		value: existing.value,
		interactiveCapable: existing.interactiveCapable !== false,
		hostRole: 'webpage_host',
	}
}

/**
 * @param {object} ctx
 * @param {object} updated
 */
function syncCefFocusAfterWebpageChange(ctx, updated) {
	const fs = ctx._hostOperatorFullscreen
	if (!fs?.active || String(fs.sourceId || '') !== String(updated.sourceId || '')) return
	const target = {
		channel: fs.operatorChannel,
		layer: fs.operatorLayer,
		zoneId: fs.zoneId || ctx._cefFocusTarget?.zoneId || 'multiview',
	}
	const state = buildOperatorFullscreenState(updated, target)
	ctx._hostOperatorFullscreen = state
	ctx._cefFocusTarget = state.cefFocusTarget
	setCefFocusTarget(state.cefFocusTarget)
	notifyCefFocusChanged(typeof ctx.log === 'function' ? (level, msg) => ctx.log(level, msg) : undefined)
	if (typeof ctx._wsBroadcast === 'function') {
		ctx._wsBroadcast('change', { path: 'hostOperatorFullscreen', value: state })
		ctx._wsBroadcast('change', { path: 'cefFocusTarget', value: state.cefFocusTarget })
	}
}

/**
 * @param {object} ctx
 * @param {object} item
 */
async function playWebpageHostNow(ctx, item) {
	if (!ctx?.amcp) return { ok: false, error: 'AMCP not connected' }
	clearStableCefPages()
	const playResult = await playHostLiveSourceNow(ctx, item)
	try {
		const { amcpCommandsForHostLiveSource } = require('./host-live-sources')
		notifyCefInteractiveAmcpLines(amcpCommandsForHostLiveSource(item), ctx.config || {}, (level, msg) =>
			ctx.log?.(level, msg),
		)
	} catch (_) {}
	return playResult
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string }} query
 */
function findWebpageHostEntry(ctx, query) {
	const source = findWebpageHostSource(ctx.config, query)
	if (!source) return null
	const list = Array.isArray(ctx.config?.extraLiveSources) ? ctx.config.extraLiveSources : []
	const idx = list.findIndex(
		(s) =>
			isWebpageHostCandidate(s) &&
			(String(s.sourceId || '') === String(source.sourceId || '') ||
				String(s.value || '') === String(source.value || '')),
	)
	if (idx < 0) return { source, idx: -1, list }
	return { source: list[idx], idx, list }
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string, templateOrUrl?: string, label?: string }} payload
 */
async function updateWebpageHostSource(ctx, payload) {
	const hit = findWebpageHostEntry(ctx, payload)
	if (!hit || hit.idx < 0) return { ok: false, status: 404, error: 'Webpage host source not found' }
	let updated
	try {
		updated = patchWebpageHostUrl(hit.source, payload.templateOrUrl, payload.label)
	} catch (e) {
		return { ok: false, status: 400, error: e?.message || String(e) }
	}
	const list = [...hit.list]
	list[hit.idx] = updated
	if (!persistConfigPatch(ctx, { extraLiveSources: list })) {
		return { ok: false, status: 503, error: 'Failed to save config' }
	}
	ctx.config.extraLiveSources = list
	let playResult = null
	try {
		playResult = await playWebpageHostNow(ctx, updated)
	} catch (e) {
		playResult = { ok: false, error: e?.message || String(e) }
	}
	syncCefFocusAfterWebpageChange(ctx, updated)
	if (typeof ctx._wsBroadcast === 'function') {
		ctx._wsBroadcast('change', { path: 'extraLiveSources', value: list })
	}
	return {
		ok: true,
		action: 'update',
		source: enrichExtraLiveSource(updated, ctx),
		extraLiveSources: list.map((x) => enrichExtraLiveSource(x, ctx)),
		hostLivePlay: playResult,
		hostOperatorFullscreen: ctx._hostOperatorFullscreen ?? null,
		cefFocusTarget: ctx._cefFocusTarget ?? null,
		message: `Webpage updated on ch ${updated.hostChannel} (route unchanged)`,
	}
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string }} payload
 */
async function reloadWebpageHostSource(ctx, payload) {
	const hit = findWebpageHostEntry(ctx, payload)
	if (!hit || hit.idx < 0) return { ok: false, status: 404, error: 'Webpage host source not found' }
	const source = hit.source
	let playResult = null
	try {
		playResult = await playWebpageHostNow(ctx, source)
	} catch (e) {
		playResult = { ok: false, error: e?.message || String(e) }
	}
	syncCefFocusAfterWebpageChange(ctx, source)
	return {
		ok: true,
		action: 'reload',
		source: enrichExtraLiveSource(source, ctx),
		hostLivePlay: playResult,
		hostOperatorFullscreen: ctx._hostOperatorFullscreen ?? null,
		cefFocusTarget: ctx._cefFocusTarget ?? null,
		message: `Reloaded webpage on ch ${source.hostChannel}`,
	}
}

/**
 * @param {object} ctx
 * @param {object} payload
 */
async function handleWebpageHostLive(ctx, payload) {
	const action = String(payload?.action || 'reload').toLowerCase()
	if (action === 'update') {
		return updateWebpageHostSource(ctx, payload)
	}
	if (action === 'reload') {
		return reloadWebpageHostSource(ctx, payload)
	}
	return { ok: false, status: 400, error: 'action must be update or reload' }
}

module.exports = {
	patchWebpageHostUrl,
	updateWebpageHostSource,
	reloadWebpageHostSource,
	handleWebpageHostLive,
}
