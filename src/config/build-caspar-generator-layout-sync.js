'use strict'

const { calculateLayoutPositions } = require('../utils/os-layout-calculator')
const { resolveMultiviewConsumerX } = require('./config-generator-channels')
const { resolvePixelMapFeedToProgramScreen } = require('./pixel-mapping-config')

function copyLegacyScreenAndMultiviewSettings(merged, appConfig) {
	if (!appConfig) return
	for (let i = 1; i <= 16; i++) {
		const prefix = `screen_${i}_`
		if (appConfig[prefix + 'system_id']) merged[prefix + 'system_id'] = appConfig[prefix + 'system_id']
		if (appConfig[prefix + 'os_mode']) merged[prefix + 'os_mode'] = appConfig[prefix + 'os_mode']
		if (appConfig[prefix + 'os_rate']) merged[prefix + 'os_rate'] = appConfig[prefix + 'os_rate']
		if (appConfig[prefix + 'os_x'] !== undefined) merged[prefix + 'os_x'] = appConfig[prefix + 'os_x']
		if (appConfig[prefix + 'os_y'] !== undefined) merged[prefix + 'os_y'] = appConfig[prefix + 'os_y']
	}
	if (appConfig.multiview_system_id) merged.multiview_system_id = appConfig.multiview_system_id
	if (appConfig.multiview_os_mode) merged.multiview_os_mode = appConfig.multiview_os_mode
	if (appConfig.multiview_os_rate) merged.multiview_os_rate = appConfig.multiview_os_rate
	if (appConfig.multiview_os_x !== undefined) merged.multiview_os_x = appConfig.multiview_os_x
	if (appConfig.multiview_os_y !== undefined) merged.multiview_os_y = appConfig.multiview_os_y
}

function applyLayoutPositionsToMerged(merged) {
	try {
		const layout = calculateLayoutPositions(merged)
		const mv1 = layout?.multiview?.[1]
		const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 1), 10) || 1))
		/** @type {Record<number, boolean>} */
		const screenHasConsumer = {}
		let casparScreenCumulativeX = 0
		for (let n = 1; n <= sc; n++) {
			const wantsScreen =
				merged[`screen_${n}_screen_consumer`] === true || merged[`screen_${n}_screen_consumer`] === 'true'
			if (wantsScreen) screenHasConsumer[n] = true
			if (!wantsScreen) continue
			const head = layout?.screens?.[n]
			if (head && Number.isFinite(head.width) && head.width > 0) casparScreenCumulativeX += head.width
		}
		if (mv1 && Number.isFinite(mv1.x)) {
			merged.multiview_x = resolveMultiviewConsumerX(merged, layout, 1, casparScreenCumulativeX, {
				screenHasConsumer,
			})
		}
		if (mv1 && Number.isFinite(mv1.y)) merged.multiview_y = mv1.y
		const mappingFeedScreens = new Set()
		const devices = Array.isArray(merged.deviceGraph?.devices) ? merged.deviceGraph.devices : []
		for (const d of devices) {
			if (!d || d.role !== 'pixel_mapping') continue
			const feed = resolvePixelMapFeedToProgramScreen(merged, String(d.id))
			if (feed?.kind === 'program' && Number.isFinite(feed.screenIndex) && feed.screenIndex >= 1) {
				mappingFeedScreens.add(feed.screenIndex)
			}
		}
		const bbox = layout?.mappingGpuBBox
		const hasMappingGpu = Array.isArray(layout?.mappingGpuOutputs) && layout.mappingGpuOutputs.length > 0
		for (let n = 1; n <= 16; n++) {
			const head = layout?.screens?.[n]
			if (head && Number.isFinite(head.x)) merged[`screen_${n}_x`] = head.x
			if (head && Number.isFinite(head.y)) merged[`screen_${n}_y`] = head.y
			const tiles = merged[`screen_${n}_decklink_tiles`]
			const wantsScreen =
				merged[`screen_${n}_screen_consumer`] !== false && merged[`screen_${n}_screen_consumer`] !== 'false'
			const manualOsX = Number.isFinite(merged[`screen_${n}_os_x`]) ? merged[`screen_${n}_os_x`] : null
			if (
				wantsScreen &&
				Array.isArray(tiles) &&
				tiles.length > 0 &&
				hasMappingGpu &&
				bbox &&
				manualOsX == null &&
				!head
			) {
				const spanX = bbox.maxX - bbox.minX
				const spanY = bbox.maxY - bbox.minY
				if (mappingFeedScreens.has(n)) {
					merged[`screen_${n}_x`] = Math.max(0, bbox.minX)
					merged[`screen_${n}_y`] = Math.max(0, bbox.minY)
				} else if (spanY > spanX) {
					merged[`screen_${n}_y`] = Math.max(0, bbox.maxY)
				} else {
					merged[`screen_${n}_x`] = Math.max(0, bbox.maxX)
				}
			}
		}
	} catch (_) {}
}

module.exports = {
	copyLegacyScreenAndMultiviewSettings,
	applyLayoutPositionsToMerged,
}
