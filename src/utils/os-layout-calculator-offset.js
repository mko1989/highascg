'use strict'

const { resolvePixelMapFeedToProgramScreen } = require('../config/pixel-mapping-config')

/**
 * WO-40a: place destination-driven heads outside the mapping-fed bbox — to its right when the
 * mapping spans wider than tall, below it otherwise.
 *
 * Every head arrives here already carrying a relative offset from computePlacedLayoutResults'
 * running cumulativeX, so the move must be a SHIFT. Screens shifted, but multiview/prv heads were
 * clamped (`x = max(x, offX)`), which threw that offset away and parked them exactly on the bbox
 * edge — where the first shifted screen also lands. On highascg7579 an operator_gui head at
 * cumulative 1920 became max(1920, 6144) = 6144, the same origin as screen_2 at 0 + 6144: two
 * xrandr outputs scanning identical pixels, so the operator GUI showed on the PGM2 monitor too.
 *
 * The horizontal and vertical placements are mutually exclusive. They used to be split across two
 * blocks, the second running unconditionally, so a vertically-stacked layout moved multiview/prv
 * heads down AND right; the clamp hid it by usually being a no-op on that path.
 *
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
	if (skipWo40aAutoOffset || !mappingGpuBBox || mappingGpuOutputs.length === 0) return

	const screens = Object.entries(results.screens || {})
	const multiview = Object.entries(results.multiview || {})
	const prv = Object.entries(results.prv || {})

	/* A screen the pixel mapping already feeds is positioned by its mapping outputs — shifting it
	 * again would move it off its own raster. */
	const mappingFeedScreens = new Set()
	if (screens.length > 0) {
		const devices = Array.isArray(config?.deviceGraph?.devices) ? config.deviceGraph.devices : []
		for (const d of devices) {
			if (!d || d.role !== 'pixel_mapping') continue
			const feed = resolvePixelMapFeedToProgramScreen(config, String(d.id))
			if (feed?.kind === 'program' && Number.isFinite(feed.screenIndex) && feed.screenIndex >= 1) {
				mappingFeedScreens.add(feed.screenIndex)
			}
		}
	}

	const spanX = mappingGpuBBox.maxX - mappingGpuBBox.minX
	const spanY = mappingGpuBBox.maxY - mappingGpuBBox.minY
	const verticalStack = spanY > spanX
	const axis = verticalStack ? 'y' : 'x'
	const off = Math.max(0, verticalStack ? mappingGpuBBox.maxY : mappingGpuBBox.maxX)
	if (off <= 0) return

	const manual = (...keys) => {
		for (const k of keys) {
			if (Number.isFinite(config[k])) return config[k]
		}
		return null
	}

	for (const [key, info] of screens) {
		const n = parseInt(key, 10)
		if (!Number.isFinite(n) || n < 1 || !info) continue
		if (mappingFeedScreens.size > 0 && mappingFeedScreens.has(n)) continue
		if (manual(`screen_${n}_os_${axis}`) != null) continue
		info[axis] = (Number(info[axis]) || 0) + off
	}
	for (const [key, info] of multiview) {
		const n = parseInt(key, 10)
		if (!Number.isFinite(n) || n < 1 || !info) continue
		if (manual(`multiview_${n}_os_${axis}`, `multiview_os_${axis}`) != null) continue
		info[axis] = (Number(info[axis]) || 0) + off
	}
	for (const [key, info] of prv) {
		const n = parseInt(key, 10)
		if (!Number.isFinite(n) || n < 1 || !info) continue
		if (manual(`screen_${n}_prv_os_${axis}`) != null) continue
		info[axis] = (Number(info[axis]) || 0) + off
	}
}

module.exports = { applyMappingGpuPlacementOffsets }
