'use strict'

/**
 * @param {string} clip
 * @returns {{ channel: number, layer: number|null }|null}
 */
function parseRouteClip(clip) {
	const s = String(clip || '').trim()
	const m = s.match(/^route:\/\/(\d+)(?:-(\d+))?$/i)
	if (!m) return null
	const channel = parseInt(m[1], 10)
	const layer = m[2] != null ? parseInt(m[2], 10) : null
	if (!Number.isFinite(channel) || channel < 1) return null
	return { channel, layer: Number.isFinite(layer) ? layer : null }
}

/**
 * @param {string} clip
 */
function isRouteClip(clip) {
	return String(clip || '').trim().toLowerCase().startsWith('route://')
}

/**
 * @param {object} scene
 * @returns {Set<number>}
 */
function lookLogicalLayerSet(scene) {
	const set = new Set()
	for (const l of scene?.layers || []) {
		const n = parseInt(l?.layerNumber, 10)
		if (Number.isFinite(n)) set.add(n)
	}
	return set
}

/**
 * Looks store intra-composition routes against the program bus (e.g. route://1-10).
 * When staging the same look on preview, rewrite to route://<takeChannel>-<layer>.
 * @param {object} scene
 * @param {number} takeChannel
 */
function remapIntraLookRoutesForTakeChannel(scene, takeChannel) {
	if (!scene || !Array.isArray(scene.layers)) return scene
	const ch = parseInt(takeChannel, 10)
	if (!ch || ch < 1) return scene
	const logical = lookLogicalLayerSet(scene)
	let changed = false
	const layers = scene.layers.map((layer) => {
		const v = layer?.source?.value
		if (!v || !isRouteClip(v)) return layer
		const parsed = parseRouteClip(v)
		if (!parsed || parsed.layer == null) return layer
		if (!logical.has(parsed.layer)) return layer
		if (parsed.channel === ch) return layer
		const next = `route://${ch}-${parsed.layer}`
		changed = true
		return {
			...layer,
			source: { ...(layer.source || {}), value: next },
		}
	})
	return changed ? { ...scene, layers } : scene
}

/**
 * Same-channel route layers must PLAY after their source layers are on-air.
 * @param {object[]} takeJobs
 * @param {number} channel
 */
function partitionTakeJobsPlayOrder(takeJobs, channel) {
	const ch = parseInt(channel, 10)
	/** @type {object[]} */
	const sources = []
	/** @type {object[]} */
	const routes = []
	for (const job of takeJobs || []) {
		if (!isRouteClip(job?.clip)) {
			sources.push(job)
			continue
		}
		const parsed = parseRouteClip(job.clip)
		if (parsed && parsed.channel === ch && parsed.layer != null) {
			routes.push(job)
		} else {
			sources.push(job)
		}
	}
	return { sources, routes }
}

module.exports = {
	parseRouteClip,
	isRouteClip,
	remapIntraLookRoutesForTakeChannel,
	partitionTakeJobsPlayOrder,
}
