'use strict'

/**
 * host-live-browser.js — WO-258 T258.3/T258.4: update/reload a browser_display source (mirrors
 * host-live-ndi.js's update/reload shape) and the T258.4 "Interact on operator screen" <-> "Return to
 * background" toggle.
 *
 * T258.4 design (grab-vs-move, decided in the WO-258 report): while interacting, the on-air feed
 * keeps tracking the SAME window via "grab-follows-window" — `restartBrowserCaptureBridge` respawns
 * the x11grab bridge at the operator monitor's rect the moment the window lands there (and back at
 * the source's off-screen dead zone on return), so Caspar never shows an empty capture region. A
 * brief (sub-second) capture gap during each swap is the accepted cost — see
 * browser-capture-bridge.js's header.
 */

const { isBrowserDisplayCandidate } = require('../config/host-live-sources')
const { playHostLiveSourceNow } = require('../config/host-live-sources-setup')
const { enrichExtraLiveSource } = require('../config/extra-live-source-enrich')
const { resolveOperatorDisplayRect } = require('../utils/x-display-session-layout')
const {
	moveBrowserSourceToOperator,
	returnBrowserSourceToOffscreen,
	browserSourceStats,
} = require('../system/browser-source-session')
const { restartBrowserCaptureBridge } = require('../capture/browser-capture-bridge')
const { resolveBrowserOffscreenRegion } = require('../capture/browser-source-region')

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
 * @param {{ url?: string, width?: number, height?: number, fps?: number, label?: string }} patch
 */
function patchBrowserDisplaySource(existing, patch) {
	const url = patch.url != null ? String(patch.url).trim() : String(existing.url || '')
	if (!/^https?:\/\//i.test(url)) throw new Error('Browser source requires an http(s) URL')
	const width = patch.width != null ? Math.max(160, parseInt(String(patch.width), 10) || 1920) : existing.width
	const height = patch.height != null ? Math.max(120, parseInt(String(patch.height), 10) || 1080) : existing.height
	const fps = patch.fps != null ? Math.max(1, Math.min(60, parseInt(String(patch.fps), 10) || 25)) : existing.fps
	const label = patch.label != null && String(patch.label).trim() ? String(patch.label).trim() : existing.label || url
	return { ...existing, url, width, height, fps, label }
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string }} query
 */
function findBrowserHostEntry(ctx, query) {
	const list = Array.isArray(ctx.config?.extraLiveSources) ? ctx.config.extraLiveSources : []
	const sourceId = String(query?.sourceId || '').trim()
	const value = String(query?.value || '').trim()
	const idx = list.findIndex((s) => {
		if (!isBrowserDisplayCandidate(s)) return false
		if (sourceId && String(s.sourceId || '') === sourceId) return true
		if (value && String(s.value || '') === value) return true
		return false
	})
	if (idx < 0) return null
	return { source: list[idx], idx, list }
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string, url?: string, width?: number, height?: number, fps?: number, label?: string }} payload
 */
async function updateBrowserDisplaySource(ctx, payload) {
	const hit = findBrowserHostEntry(ctx, payload)
	if (!hit) return { ok: false, status: 404, error: 'Browser source not found' }
	let updated
	try {
		updated = patchBrowserDisplaySource(hit.source, payload)
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
		message: `Browser source updated on ch ${updated.hostChannel}`,
	}
}

/**
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string }} payload
 */
async function reloadBrowserDisplaySource(ctx, payload) {
	const hit = findBrowserHostEntry(ctx, payload)
	if (!hit) return { ok: false, status: 404, error: 'Browser source not found' }
	const source = hit.source
	let playResult
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
		message: `Reloaded browser source on ch ${source.hostChannel}`,
	}
}

/**
 * @param {object} ctx
 * @param {object} payload
 */
async function handleBrowserDisplayHostLive(ctx, payload) {
	const action = String(payload?.action || 'update').toLowerCase()
	if (action === 'update') return updateBrowserDisplaySource(ctx, payload)
	if (action === 'reload') return reloadBrowserDisplaySource(ctx, payload)
	return { ok: false, status: 400, error: 'action must be update or reload' }
}

/**
 * T258.4 — "Interact on operator screen": move the source's real Firefox window onto the operator's
 * monitor (native mouse/keyboard) and re-point the capture bridge there so the on-air feed keeps
 * tracking it (grab-follows-window).
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string }} payload
 */
async function interactBrowserDisplaySource(ctx, payload) {
	const hit = findBrowserHostEntry(ctx, payload)
	if (!hit) return { ok: false, status: 404, error: 'Browser source not found' }
	const source = hit.source
	const operatorRect = resolveOperatorDisplayRect(ctx.config)
	if (!operatorRect) return { ok: false, status: 400, error: 'No operator display configured' }
	const rect = { x: operatorRect.x, y: operatorRect.y, w: operatorRect.width, h: operatorRect.height }
	const moved = await moveBrowserSourceToOperator(ctx, source.sourceId, rect)
	if (!moved.ok) return { ok: false, status: 409, error: moved.reason || 'move_failed' }
	await restartBrowserCaptureBridge(ctx, source.sourceId, rect, source.hostChannel, { fps: source.fps })
	return { ok: true, action: 'interact', sourceId: source.sourceId, stats: browserSourceStats(source.sourceId) }
}

/**
 * T258.4 — "Return to background": move the window back to its off-screen dead zone and re-point
 * the capture bridge there.
 * @param {object} ctx
 * @param {{ sourceId?: string, value?: string }} payload
 */
async function returnBrowserDisplaySource(ctx, payload) {
	const hit = findBrowserHostEntry(ctx, payload)
	if (!hit) return { ok: false, status: 404, error: 'Browser source not found' }
	const source = hit.source
	const returned = await returnBrowserSourceToOffscreen(ctx, source.sourceId)
	if (!returned.ok) return { ok: false, status: 409, error: returned.reason || 'return_failed' }
	const region = resolveBrowserOffscreenRegion(source.width, source.height)
	if (region) {
		await restartBrowserCaptureBridge(ctx, source.sourceId, region, source.hostChannel, { fps: source.fps })
	}
	return { ok: true, action: 'return', sourceId: source.sourceId, stats: browserSourceStats(source.sourceId) }
}

/**
 * @param {object} ctx
 * @param {object} payload
 */
async function handleBrowserDisplayInteract(ctx, payload) {
	const action = String(payload?.action || 'toggle').toLowerCase()
	if (action === 'on' || action === 'interact') return interactBrowserDisplaySource(ctx, payload)
	if (action === 'off' || action === 'return') return returnBrowserDisplaySource(ctx, payload)
	if (action === 'toggle') {
		const hit = findBrowserHostEntry(ctx, payload)
		if (!hit) return { ok: false, status: 404, error: 'Browser source not found' }
		const stats = browserSourceStats(hit.source.sourceId)
		return stats.interacting ? returnBrowserDisplaySource(ctx, payload) : interactBrowserDisplaySource(ctx, payload)
	}
	return { ok: false, status: 400, error: 'action must be on, off, or toggle' }
}

module.exports = {
	patchBrowserDisplaySource,
	findBrowserHostEntry,
	updateBrowserDisplaySource,
	reloadBrowserDisplaySource,
	handleBrowserDisplayHostLive,
	interactBrowserDisplaySource,
	returnBrowserDisplaySource,
	handleBrowserDisplayInteract,
}
