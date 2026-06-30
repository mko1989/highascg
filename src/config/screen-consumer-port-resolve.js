'use strict'

const {
	createDestinationWiringContext,
	destinationSourceIds,
} = require('./device-graph-destination-wiring')

/** Caspar screen-consumer fields saved per physical rear port in Device View (`screen_${portN}_*`). */
const PHYSICAL_PORT_CONSUMER_FIELDS = [
	'windowed',
	'vsync',
	'borderless',
	'stretch',
	'key_only',
	'always_on_top',
	'interactive',
	'sbs_key',
	'colour_space',
	'force_linear_filter',
	'enable_mipmaps',
	'high_bitdepth',
	'name',
	'aspect_ratio',
	'x',
	'y',
]

const WINDOW_CHROME_FIELDS = ['windowed', 'vsync', 'borderless']

/**
 * @param {object | null | undefined} connector
 * @returns {number | null} 1-based physical port index (gpu_p0 → 1)
 */
function physicalPortIndexFromGpuConnector(connector) {
	if (!connector || typeof connector !== 'object') return null
	const id = String(connector.id || '').trim()
	const m = /^gpu_p(\d+)$/i.exec(id)
	if (m) return Math.max(1, Math.min(4, parseInt(m[1], 10) + 1))
	const slot = Number(connector.gpuPhysical?.slotOrder)
	if (Number.isFinite(slot) && slot >= 0) return Math.max(1, Math.min(4, Math.round(slot) + 1))
	return null
}

/**
 * @param {string} sourceId
 * @param {ReturnType<typeof createDestinationWiringContext>} ctx
 * @returns {object | null}
 */
function resolveGpuOutConnectorFromSource(sourceId, ctx) {
	const queue = [String(sourceId || '')]
	const seen = new Set()
	while (queue.length) {
		const cur = queue.shift()
		if (!cur || seen.has(cur)) continue
		seen.add(cur)
		for (const sinkId of ctx.outgoing.get(cur) || []) {
			const sink = ctx.byId.get(String(sinkId || ''))
			if (!sink) continue
			if (sink.kind === 'gpu_out') return sink
			if (sink.kind === 'pixel_map_in') {
				const nodeId = String(sink.deviceId || '')
				for (const no of ctx.g.connectors || []) {
					if (String(no?.deviceId || '') === nodeId && no?.kind === 'pixel_map_out') {
						queue.push(String(no?.id || ''))
					}
				}
			}
		}
	}
	return null
}

/**
 * @param {object} dest
 * @param {number} destIndex
 * @param {ReturnType<typeof createDestinationWiringContext>} ctx
 * @returns {number | null}
 */
function resolvePhysicalPortIndexForDestination(dest, destIndex, ctx) {
	for (const src of destinationSourceIds(dest, destIndex, ctx)) {
		const gpu = resolveGpuOutConnectorFromSource(src, ctx)
		const port = physicalPortIndexFromGpuConnector(gpu)
		if (port) return port
	}
	return null
}

/**
 * @param {Record<string, unknown>} merged
 * @param {string} fromKey
 * @param {string} toKey
 */
function copyConsumerFieldIfSet(merged, fromKey, toKey) {
	if (merged[fromKey] === undefined || merged[fromKey] === null) return
	merged[toKey] = merged[fromKey]
}

/** Physical-port interactive=false must not clobber multiview_interactive=true from Device View. */
function copyInteractiveConsumerField(merged, fromKey, toKey) {
	const v = merged[fromKey]
	if (v === true || v === 'true') merged[toKey] = true
}

/**
 * Device View stores window chrome on physical rear-port keys; Caspar generator reads per Caspar screen / multiview index.
 * @param {Record<string, unknown>} merged flat generator config (mutated)
 * @param {Record<string, unknown>} appConfig
 */
function applyPhysicalPortConsumerFlagsToScreens(merged, appConfig) {
	const ctx = createDestinationWiringContext(appConfig || {})
	if (!ctx.destinations.length) return

	for (let destIndex = 0; destIndex < ctx.destinations.length; destIndex++) {
		const dest = ctx.destinations[destIndex]
		const mode = String(dest?.mode || 'pgm_prv').toLowerCase()
		if (mode === 'stream') continue

		const portIdx = resolvePhysicalPortIndexForDestination(dest, destIndex, ctx)
		if (!portIdx) continue

		if (mode === 'multiview') {
			const mvDests = ctx.destinations.filter((d) => String(d?.mode || '').toLowerCase() === 'multiview')
			const mvSlot = mvDests.indexOf(dest)
			if (mvSlot < 0) continue
			const n = mvSlot + 1
			for (const field of WINDOW_CHROME_FIELDS) {
				copyConsumerFieldIfSet(merged, `screen_${portIdx}_${field}`, `multiview_${n}_${field}`)
				if (n === 1) copyConsumerFieldIfSet(merged, `screen_${portIdx}_${field}`, `multiview_${field}`)
			}
			copyInteractiveConsumerField(merged, `screen_${portIdx}_interactive`, `multiview_${n}_interactive`)
			if (n === 1) copyInteractiveConsumerField(merged, `screen_${portIdx}_interactive`, 'multiview_interactive')
			continue
		}

		const n = Math.max(1, (parseInt(String(dest?.mainScreenIndex ?? 0), 10) || 0) + 1)
		if (portIdx === n) continue
		for (const field of PHYSICAL_PORT_CONSUMER_FIELDS) {
			copyConsumerFieldIfSet(merged, `screen_${portIdx}_${field}`, `screen_${n}_${field}`)
		}
	}
}

module.exports = {
	PHYSICAL_PORT_CONSUMER_FIELDS,
	WINDOW_CHROME_FIELDS,
	physicalPortIndexFromGpuConnector,
	resolveGpuOutConnectorFromSource,
	resolvePhysicalPortIndexForDestination,
	applyPhysicalPortConsumerFlagsToScreens,
}
