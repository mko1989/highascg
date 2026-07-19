'use strict'

const { getChannelMap } = require('../config/routing')

/** Remove take-only fields from stored live scene JSON. */
function stripEphemeralTakeFields(scene) {
	if (!scene || typeof scene !== 'object') return scene
	const layers = Array.isArray(scene.layers)
		? scene.layers.map((L) => {
				if (!L || typeof L !== 'object') return L
				const { playSeekFrames, ...rest } = L
				return rest
			})
		: scene.layers
	return { ...scene, layers }
}

/** Resolve Caspar preview (PRV) channel for a program take request. */
function resolvePreviewChannel(routeMap, mainIdx, requestChannel) {
	if (mainIdx >= 0) {
		return routeMap.switcherBus1Channels?.[mainIdx] ?? routeMap.previewChannels?.[mainIdx] ?? null
	}
	const ch = parseInt(requestChannel, 10)
	const previews = (routeMap.previewChannels || []).map((p) => Number(p)).filter((n) => Number.isFinite(n) && n > 0)
	return previews.includes(ch) ? ch : null
}

function isPreviewTakeTarget(body) {
	const t = String(body?.target || body?.bus || '').toLowerCase()
	return t === 'preview' || t === 'prv' || t === 'bus1'
}

function getRouteMap(ctx) {
	return getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
}

/**
 * Serialize AMCP work with `/api/scene/take`'s per-channel promise chain
 * (`ctx._sceneTakeChainByChannel`, keyed by the PGM channel of the main).
 * Preview nudges and preview clears MUST join this chain: a nudge or clear that
 * interleaves into a mid-flight staging take is exactly the "layer missing /
 * layer with another look's transform" race on PRV (todos19.07.26).
 * @param {object} ctx
 * @param {number|string} chainKey — the take request channel (PGM channel)
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
function chainSceneTakeWork(ctx, chainKey, fn) {
	if (!ctx._sceneTakeChainByChannel) ctx._sceneTakeChainByChannel = {}
	const key = String(chainKey)
	const prev = ctx._sceneTakeChainByChannel[key] || Promise.resolve()
	const run = prev.then(() => fn())
	ctx._sceneTakeChainByChannel[key] = run.catch(() => {})
	return run
}

/**
 * Chain key for PRV-channel work: the PGM channel of the owning main — the SAME key
 * `/api/scene/take` chains its preview-only staging under (`b.channel` is the PGM channel there).
 * Falls back to the preview channel itself when no main maps to it.
 * @param {{ programChannels?: unknown[], previewChannels?: unknown[] }} routeMap
 * @param {number} previewCh
 * @param {number} [mainIdx]
 * @returns {number}
 */
function takeChainKeyForPreviewChannel(routeMap, previewCh, mainIdx = -1) {
	if (Number.isInteger(mainIdx) && mainIdx >= 0) {
		const pgm = Number(routeMap.programChannels?.[mainIdx])
		if (Number.isFinite(pgm) && pgm > 0) return pgm
	}
	const previews = (routeMap.previewChannels || []).map((p) => Number(p))
	const idx = previews.indexOf(Number(previewCh))
	if (idx >= 0) {
		const pgm = Number(routeMap.programChannels?.[idx])
		if (Number.isFinite(pgm) && pgm > 0) return pgm
	}
	return Number(previewCh)
}

module.exports = {
	stripEphemeralTakeFields,
	resolvePreviewChannel,
	isPreviewTakeTarget,
	getRouteMap,
	chainSceneTakeWork,
	takeChainKeyForPreviewChannel,
}
