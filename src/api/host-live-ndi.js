'use strict'

const { isNdiHostCandidate } = require('../config/host-live-sources')
const { playHostLiveSourceNow } = require('../config/host-live-sources-setup')
const { enrichExtraLiveSource } = require('../config/extra-live-source-enrich')
const { normalizeNdiSourceName, ndiDisplayLabel } = require('../config/ndi-playback')

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
 * @param {string} ndiNameRaw
 * @param {string} [label]
 */
function patchNdiHostSource(existing, ndiNameRaw, label) {
	const raw = String(ndiNameRaw || '').trim()
	const ndiName = normalizeNdiSourceName(raw)
	const display = ndiDisplayLabel(ndiName)
	const nextLabel =
		label != null && String(label).trim()
			? String(label).trim()
			: String(existing.label || display).trim() || existing.sourceId
	return {
		...existing,
		type: 'ndi',
		routeType: 'ndi_host',
		value: existing.value,
		label: nextLabel,
		hostChannel: existing.hostChannel,
		hostLayer: existing.hostLayer ?? 1,
		sourceId: existing.sourceId,
		ndiName,
		interactiveCapable: false,
		hostRole: 'ndi_host',
		useDirect: false,
	}
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string }} query
 */
function findNdiHostEntry(ctx, query) {
	const list = Array.isArray(ctx.config?.extraLiveSources) ? ctx.config.extraLiveSources : []
	const sourceId = String(query?.sourceId || '').trim()
	const value = String(query?.value || '').trim()
	const idx = list.findIndex((s) => {
		if (!isNdiHostCandidate(s)) return false
		if (sourceId && String(s.sourceId || '') === sourceId) return true
		if (value && String(s.value || '') === value) return true
		return false
	})
	if (idx < 0) return null
	return { source: list[idx], idx, list }
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string, ndiName?: string, label?: string }} payload
 */
async function updateNdiHostSource(ctx, payload) {
	const hit = findNdiHostEntry(ctx, payload)
	if (!hit) return { ok: false, status: 404, error: 'NDI host source not found' }
	let updated
	try {
		updated = patchNdiHostSource(hit.source, payload.ndiName, payload.label)
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
		playResult = await playHostLiveSourceNow(ctx, updated)
	} catch (e) {
		playResult = { ok: false, error: e?.message || String(e) }
	}
	if (typeof ctx._wsBroadcast === 'function') {
		ctx._wsBroadcast('change', { path: 'extraLiveSources', value: list })
	}
	return {
		ok: true,
		action: 'update',
		source: enrichExtraLiveSource(updated, ctx),
		extraLiveSources: list.map((x) => enrichExtraLiveSource(x, ctx)),
		hostLivePlay: playResult,
		casparRestartRecommended: false,
		message: `NDI updated on ch ${updated.hostChannel} (route unchanged)`,
	}
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string }} payload
 */
async function reloadNdiHostSource(ctx, payload) {
	const hit = findNdiHostEntry(ctx, payload)
	if (!hit) return { ok: false, status: 404, error: 'NDI host source not found' }
	const source = hit.source
	let playResult = null
	try {
		playResult = await playHostLiveSourceNow(ctx, source)
	} catch (e) {
		playResult = { ok: false, error: e?.message || String(e) }
	}
	return {
		ok: true,
		action: 'reload',
		source: enrichExtraLiveSource(source, ctx),
		hostLivePlay: playResult,
		message: `Reloaded NDI on ch ${source.hostChannel}`,
	}
}

/**
 * @param {object} ctx
 * @param {object} payload
 */
async function handleNdiHostLive(ctx, payload) {
	const action = String(payload?.action || 'update').toLowerCase()
	if (action === 'update') {
		return updateNdiHostSource(ctx, payload)
	}
	if (action === 'reload') {
		return reloadNdiHostSource(ctx, payload)
	}
	return { ok: false, status: 400, error: 'action must be update or reload' }
}

module.exports = {
	patchNdiHostSource,
	updateNdiHostSource,
	reloadNdiHostSource,
	handleNdiHostLive,
}
