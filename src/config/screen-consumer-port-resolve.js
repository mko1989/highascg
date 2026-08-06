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

/** Destination modes that put live program video on a port. */
const PGM_DESTINATION_MODES = new Set(['pgm_prv', 'pgm_only'])

/**
 * Port flags implied by cabling the operator GUI to a GPU port. These are not preferences — each one
 * is load-bearing:
 *  - always_on_top false: the operator-GUI consumer stacks BELOW the fullscreen Firefox GUI, which
 *    the shape helper punches holes in (WO-263). On top, the WM raises focused Firefox above it and
 *    the picture vanishes the moment the operator clicks.
 *  - interactive true: the holes must pass pointer events through to the video window.
 *  - operator_monitor true: this is the flag resolveOperatorMonitorPort() reads, which in turn feeds
 *    resolveOperatorGuiPort() and the helper-window confinement in x-display-session-layout. Deriving
 *    it from the cable removes the manual "tick Operator monitor on this port" step entirely.
 */
const OPERATOR_GUI_PORT_FLAGS = {
	always_on_top: false,
	interactive: true,
	operator_monitor: true,
}

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
		// The operator-GUI destination drives its own consumer (config-generator-operator-gui.js) and
		// carries a meaningless mainScreenIndex (always 0). Letting it fall through to the generic
		// branch below copied its rear-port flags — always_on_top=false per WO-263, plus x/y/name/
		// stretch/colour_space — straight over the PGM screen_1_* keys on every generate, silently
		// discarding the operator's PGM choices (owner: "changing manualy doesnt change the config").
		// ...but the port it is CABLED TO still has to be told what it now is. Resolve the port and
		// stamp the operator-GUI flags on that port's own `screen_${portIdx}_*` keys, then stop —
		// deliberately without falling through to the screen_${n} copy that WO-263 removed.
		if (mode === 'operator_gui') {
			const guiPort = resolvePhysicalPortIndexForDestination(dest, destIndex, ctx)
			if (guiPort) {
				for (const [field, value] of Object.entries(OPERATOR_GUI_PORT_FLAGS)) {
					merged[`screen_${guiPort}_${field}`] = value
				}
			}
			continue
		}

		const portIdx = resolvePhysicalPortIndexForDestination(dest, destIndex, ctx)
		if (!portIdx) continue

		// A port that used to carry the operator GUI keeps always_on_top=false and
		// operator_monitor=true once those were written; re-cabling it to PGM must undo both, or the
		// program output silently stops stacking above desktop chrome and the operator-monitor
		// resolver keeps pointing at a screen that is now showing program.
		if (PGM_DESTINATION_MODES.has(mode)) {
			merged[`screen_${portIdx}_always_on_top`] = true
			merged[`screen_${portIdx}_operator_monitor`] = false
		}

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

/**
 * WO-412 (owner 03.08): cabling the operator GUI to an output IS the "Operator monitor"
 * choice. `applyPhysicalPortConsumerFlagsToScreens` above stamps the implied flags on the
 * MERGED generator config only — the app config (what the runtime display session, kiosk
 * placement and the Device-View tick read) never got them, so the tick stayed manual.
 * This derives the app-config patch: single-select operator_monitor on the cabled port
 * (mirroring the inspector's own 1..4 loop) + the WO-263 stacking flags on that port.
 * @param {object} appConfig
 * @returns {{ patch: Record<string, boolean>, guiPort: number | null }}
 */
function deriveOperatorGuiAppConfigPortFlags(appConfig) {
	const ctx = createDestinationWiringContext(appConfig || {})
	let guiPort = null
	for (let i = 0; i < ctx.destinations.length; i++) {
		const dest = ctx.destinations[i]
		if (String(dest?.mode || '').toLowerCase() !== 'operator_gui') continue
		guiPort = resolvePhysicalPortIndexForDestination(dest, i, ctx)
		if (guiPort) break
	}
	if (!guiPort) return { patch: {}, guiPort: null }
	const patch = {}
	for (let p = 1; p <= 4; p++) patch[`screen_${p}_operator_monitor`] = p === guiPort
	patch[`screen_${guiPort}_always_on_top`] = false
	patch[`screen_${guiPort}_interactive`] = true
	return { patch, guiPort }
}

module.exports = {
	PHYSICAL_PORT_CONSUMER_FIELDS,
	WINDOW_CHROME_FIELDS,
	PGM_DESTINATION_MODES,
	OPERATOR_GUI_PORT_FLAGS,
	physicalPortIndexFromGpuConnector,
	resolveGpuOutConnectorFromSource,
	resolvePhysicalPortIndexForDestination,
	applyPhysicalPortConsumerFlagsToScreens,
	deriveOperatorGuiAppConfigPortFlags,
}
