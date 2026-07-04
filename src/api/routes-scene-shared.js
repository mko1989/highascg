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

module.exports = {
	stripEphemeralTakeFields,
	resolvePreviewChannel,
	isPreviewTakeTarget,
	getRouteMap,
}
