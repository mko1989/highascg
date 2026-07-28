'use strict'

const { isWebpageHostCandidate, resolveWebpagePlayTarget } = require('../config/host-live-sources')
const { playHostLiveSourceNow } = require('../config/host-live-sources-setup')
const { findWebpageHostSource, buildOperatorFullscreenState } = require('../api/host-operator-fullscreen')
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
 * Keeps the operator-fullscreen state's label/route metadata current when the
 * underlying webpage URL changes while it's routed to the operator display.
 * @param {object} ctx
 * @param {object} updated
 */
function syncOperatorFullscreenAfterWebpageChange(ctx, updated) {
	const fs = ctx._hostOperatorFullscreen
	if (!fs?.active || String(fs.sourceId || '') !== String(updated.sourceId || '')) return
	const target = {
		channel: fs.operatorChannel,
		layer: fs.operatorLayer,
		zoneId: fs.zoneId || 'multiview',
	}
	const state = buildOperatorFullscreenState(updated, target)
	ctx._hostOperatorFullscreen = state
	if (typeof ctx._wsBroadcast === 'function') {
		ctx._wsBroadcast('change', { path: 'hostOperatorFullscreen', value: state })
	}
}

/**
 * @param {object} ctx
 * @param {object} item
 */
async function playWebpageHostNow(ctx, item) {
	if (!ctx?.amcp) return { ok: false, error: 'AMCP not connected' }
	return playHostLiveSourceNow(ctx, item)
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
	let playResult
	try {
		playResult = await playWebpageHostNow(ctx, updated)
	} catch (e) {
		playResult = { ok: false, error: e?.message || String(e) }
	}
	syncOperatorFullscreenAfterWebpageChange(ctx, updated)
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
	let playResult
	try {
		playResult = await playWebpageHostNow(ctx, source)
	} catch (e) {
		playResult = { ok: false, error: e?.message || String(e) }
	}
	syncOperatorFullscreenAfterWebpageChange(ctx, source)
	return {
		ok: true,
		action: 'reload',
		source: enrichExtraLiveSource(source, ctx),
		hostLivePlay: playResult,
		hostOperatorFullscreen: ctx._hostOperatorFullscreen ?? null,
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
