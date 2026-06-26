'use strict'

const { resolvePixelMapFeedToProgramScreen } = require('../config/pixel-mapping-config')

/**
 * WO-40a: place destination-driven heads to the right of mapping-fed bbox.
 * @param {object} config
 * @param {object} results
 * @param {object | null} mappingGpuBBox
 * @param {object[]} mappingGpuOutputs
 * @param {Map<number, object>} operatorScreenAssignments
 * @param {boolean} graphHasDestinationGpuBinding
 */
function applyMappingGpuPlacementOffsets(
	config,
	results,
	mappingGpuBBox,
	mappingGpuOutputs,
	operatorScreenAssignments,
	graphHasDestinationGpuBinding,
) {
	const skipWo40aAutoOffset = !graphHasDestinationGpuBinding && operatorScreenAssignments.size > 0

	if (
		!skipWo40aAutoOffset &&
		mappingGpuBBox &&
		mappingGpuOutputs.length > 0 &&
		Object.keys(results.screens).length > 0
	) {
		const devices = Array.isArray(config?.deviceGraph?.devices) ? config.deviceGraph.devices : []
		const mappingFeedScreens = new Set()
		for (const d of devices) {
			if (!d || d.role !== 'pixel_mapping') continue
			const feed = resolvePixelMapFeedToProgramScreen(config, String(d.id))
			if (feed?.kind === 'program' && Number.isFinite(feed.screenIndex) && feed.screenIndex >= 1) {
				mappingFeedScreens.add(feed.screenIndex)
			}
		}
		const offX = Math.max(0, mappingGpuBBox.maxX)
		const spanX = mappingGpuBBox.maxX - mappingGpuBBox.minX
		const spanY = mappingGpuBBox.maxY - mappingGpuBBox.minY
		const verticalStack = spanY > spanX
		if (verticalStack) {
			const offY = Math.max(0, mappingGpuBBox.maxY)
			if (offY > 0) {
				for (const [key, info] of Object.entries(results.screens)) {
					const n = parseInt(key, 10)
					if (!Number.isFinite(n) || n < 1 || !info) continue
					if (mappingFeedScreens.size > 0 && mappingFeedScreens.has(n)) continue
					const manualOsY = Number.isFinite(config[`screen_${n}_os_y`]) ? config[`screen_${n}_os_y`] : null
					if (manualOsY != null) continue
					info.y += offY
				}
				for (const [key, info] of Object.entries(results.multiview)) {
					const n = parseInt(key, 10)
					if (!Number.isFinite(n) || n < 1 || !info) continue
					const manualOsY =
						Number.isFinite(config[`multiview_${n}_os_y`]) ? config[`multiview_${n}_os_y`] :
						Number.isFinite(config.multiview_os_y) ? config.multiview_os_y : null
					if (manualOsY != null) continue
					info.y += offY
				}
			}
		} else if (offX > 0) {
			for (const [key, info] of Object.entries(results.screens)) {
				const n = parseInt(key, 10)
				if (!Number.isFinite(n) || n < 1 || !info) continue
				if (mappingFeedScreens.size > 0 && mappingFeedScreens.has(n)) continue
				const manualOsX = Number.isFinite(config[`screen_${n}_os_x`]) ? config[`screen_${n}_os_x`] : null
				if (manualOsX != null) continue
				info.x += offX
			}
		}
	}

	if (!skipWo40aAutoOffset && mappingGpuBBox && mappingGpuOutputs.length > 0) {
		const offX = Math.max(0, mappingGpuBBox.maxX)
		if (offX > 0) {
			for (const [key, info] of Object.entries(results.multiview)) {
				const n = parseInt(key, 10)
				if (!Number.isFinite(n) || n < 1 || !info) continue
				const manualOsX =
					Number.isFinite(config[`multiview_${n}_os_x`]) ? config[`multiview_${n}_os_x`] :
					Number.isFinite(config.multiview_os_x) ? config.multiview_os_x : null
				if (manualOsX != null) continue
				info.x = Math.max(Number(info.x) || 0, offX)
			}
		}
	}
}

module.exports = { applyMappingGpuPlacementOffsets }
