'use strict'

/**
 * WO-869 path (b) — the generator half of the screen-slices backend.
 *
 * `applySliceWindowsToScreens(merged, appConfig)` (flat-config step) records, per program screen, the slice windows
 * that feed from it (`screen_N_slice_windows`, one per mapping node — owner Q8) and switches the PGM `<screen>` off
 * when every GPU head that screen reaches goes through a slice window: the PGM window would otherwise sit on the same
 * heads (it spans the node canvas, WO-40a) and fight the slice window for the top of the stack.
 *
 * `sliceWindowScreensXml(config, n)` writes those windows as extra `<screen>` consumers on the PGM channel: device
 * 41+k (consumer index 640+k, mapping-slices-windows.js), at the window's place on the desktop (its bounding box of
 * output heads on the node canvas — the same numbers sliceHeadRects() gives xrandr), window-sized, gpu-texture on,
 * and the `<slices>` block as the restart-safe baseline. Live edits go over `APPLY <ch>-<640+k> SLICES SET …`.
 */

const { sliceWindowsFromConfig, slicesXml } = require('./mapping-slices-windows')
const { SCREEN_VSYNC_XML, SCREEN_GPU_TEXTURE_XML } = require('./screen-consumer-policy')
const {
	createDestinationWiringContext,
	destinationSourceIds,
	reachesGpuFromSource,
} = require('./device-graph-destination-wiring')

const KEY_RE = /^screen_\d+_slice_windows$/
const NOT_PROGRAM = new Set(['operator_gui', 'multiview', 'stream', 'host_channel'])

/** The pixel_map_out connector ids of a node's screen-slices outputs. */
function sliceOutputConnectorIds(graph, w) {
	const conns = (graph?.connectors || []).filter((c) => String(c?.deviceId || '') === w.nodeId && c?.kind === 'pixel_map_out')
	const ids = new Set()
	w.plan.outputs.forEach((row, idx) => {
		if (row.backend !== 'screen-slices') return
		const c =
			conns.find((x) => Number(x?.index) === idx) ||
			conns.find((x) => String(x?.id || '') === `${w.nodeId}_${row.outputId}`) ||
			conns.find((x) => String(x?.id || '').endsWith(`_${row.outputId}`))
		if (c) ids.add(String(c.id))
	})
	return ids
}

/** The wiring context with the slice outputs' cables removed. */
function withoutSources(ctx, drop) {
	const strip = (m) => new Map([...m].filter(([src]) => !drop.has(src)))
	return { ...ctx, outgoing: strip(ctx.outgoing), outgoingPgm: strip(ctx.outgoingPgm) }
}

/**
 * @param {Record<string, unknown>} merged flat generator config (mutated)
 * @param {object} appConfig
 * @returns {ReturnType<typeof sliceWindowsFromConfig>}
 */
function applySliceWindowsToScreens(merged, appConfig) {
	for (const k of Object.keys(merged)) if (KEY_RE.test(k)) delete merged[k]
	const windows = sliceWindowsFromConfig(appConfig || {})
	if (!windows.length) return windows
	const byScreen = new Map()
	for (const w of windows) {
		const list = byScreen.get(w.screenIndex) || []
		list.push({
			nodeId: w.nodeId,
			label: w.label,
			device: w.device,
			consumerIndex: w.consumerIndex,
			x: w.window.origin.x,
			y: w.window.origin.y,
			width: w.window.width,
			height: w.window.height,
			slices: w.window.slices,
		})
		byScreen.set(w.screenIndex, list)
	}
	const ctx = createDestinationWiringContext(appConfig || {})
	const drop = new Set()
	for (const w of windows) for (const id of sliceOutputConnectorIds(ctx.g, w)) drop.add(id)
	const rest = withoutSources(ctx, drop)
	for (const [n, list] of byScreen) {
		merged[`screen_${n}_slice_windows`] = list
		// The screen's program destination: an operator GUI / multiview / stream / host destination can share its
		// mainScreenIndex, and its own GPU cable kept the PGM window on (WO-869 on the box, operator GUI index 0).
		const dest = ctx.destinations.find((d) => !NOT_PROGRAM.has(String(d?.mode || 'pgm_prv')) &&
			(Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0)) + 1 === n)
		if (!dest) continue
		const otherGpu = destinationSourceIds(dest, n - 1, rest).some((src) => reachesGpuFromSource(src, rest, { pgmOnly: true }))
		if (!otherGpu) merged[`screen_${n}_screen_consumer`] = false
	}
	return windows
}

const num = (v) => Math.round(Number(v) || 0)

/**
 * @param {Record<string, unknown>} config flat generator config
 * @param {number} n 1-based screen index
 */
function sliceWindowScreensXml(config, n) {
	const list = Array.isArray(config?.[`screen_${n}_slice_windows`]) ? config[`screen_${n}_slice_windows`] : []
	return list
		.filter((w) => num(w.width) > 0 && num(w.height) > 0 && Array.isArray(w.slices))
		.map((w) => {
			const body = slicesXml(w, '                    ')
			return `
                <screen>
                    <device>${num(w.device)}</device>
                    <x>${num(w.x)}</x><y>${num(w.y)}</y>
                    <width>${num(w.width)}</width><height>${num(w.height)}</height>
                    <stretch>none</stretch>
                    <windowed>true</windowed>
                    ${SCREEN_VSYNC_XML}
                    <always-on-top>true</always-on-top>
                    <borderless>true</borderless>
                    ${SCREEN_GPU_TEXTURE_XML}${body ? `\n${body}` : ''}
                </screen>`
		})
		.join('')
}

module.exports = { applySliceWindowsToScreens, sliceWindowScreensXml }
