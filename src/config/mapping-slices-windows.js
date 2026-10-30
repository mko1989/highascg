'use strict'

/**
 * WO-869 path (b) — the screen-slices windows a device graph asks for: one `<screen>` consumer per mapping node that
 * has screen-slices outputs (owner Q8: one window per mapping node), on the PROGRAM channel that feeds the node.
 *
 * The window is a second screen consumer on that channel with its own `<device>`. On Linux the screen consumer uses
 * `<device>` only for its consumer index (600 + device − 1; screen_consumer.cpp `index()`), so slice windows take a
 * fixed range — device 41.. → index 640.. — and never shift the device numbers of the PGM / PRV / multiview /
 * operator windows. `APPLY <ch>-<index> SLICES SET …` addresses exactly this window.
 */

const { planAllMappingNodes } = require('./mapping-slices-plan')
const { resolvePixelMapFeedToProgramScreen } = require('./pixel-mapping-config')

const SLICE_WINDOW_DEVICE_BASE = 41
const MAX_SLICE_WINDOWS = 16

/** Consumer index of a screen consumer with `<device>` d (key-only off): screen_consumer.cpp index(). */
function screenConsumerIndex(device) {
	return 600 + device - 1
}

/**
 * @param {object} appConfig `ctx.config` shape (deviceGraph, screenDestinations)
 * @param {{ caps?: object }} [opts]
 * @returns {{ nodeId: string, label: string, screenIndex: number, device: number, consumerIndex: number,
 *   window: object, plan: object }[]}
 */
function sliceWindowsFromConfig(appConfig, opts = {}) {
	const graph = appConfig?.deviceGraph
	if (!graph || !Array.isArray(graph.devices)) return []
	const out = []
	for (const plan of planAllMappingNodes(graph, { caps: opts.caps })) {
		if (!plan.window || !plan.window.slices) continue
		const feed = resolvePixelMapFeedToProgramScreen(appConfig, plan.nodeId)
		if (feed?.kind !== 'program' || !Number.isFinite(feed.screenIndex)) continue
		if (out.length >= MAX_SLICE_WINDOWS) break
		const device = SLICE_WINDOW_DEVICE_BASE + out.length
		const node = graph.devices.find((d) => String(d?.id || '') === plan.nodeId)
		out.push({
			nodeId: plan.nodeId,
			label: String(node?.label || plan.nodeId),
			screenIndex: feed.screenIndex,
			device,
			consumerIndex: screenConsumerIndex(device),
			window: plan.window,
			plan,
		})
	}
	return out
}

/** AMCP number: at most 3 decimals, never "-0" or an exponent. */
function amcpNum(v) {
	const r = Math.round(Number(v) * 1000) / 1000
	if (!Number.isFinite(r) || Object.is(r, -0)) return '0'
	return String(r)
}

/** Per slice, the 21 numbers of the `SLICES SET` / `<slice>` contract (src, dst ul ur lr ll, opacity, feather, clip). */
function sliceNumbers(s) {
	const f = s.feather || {}
	const c = s.clip || { x: 0, y: 0, w: 0, h: 0 }
	return [
		s.src.x, s.src.y, s.src.w, s.src.h,
		...s.dst.flat(),
		s.opacity,
		f.l || 0, f.t || 0, f.r || 0, f.b || 0,
		c.x, c.y, c.w, c.h,
	]
}

/** `SLICES SET n …` (or `SLICES CLEAR` for an empty window) — the parameters after `APPLY <ch>-<index>`. */
function slicesSetParams(window) {
	const slices = Array.isArray(window?.slices) ? window.slices : []
	if (!slices.length) return 'SLICES CLEAR'
	return `SLICES SET ${slices.length} ${slices.map((s) => sliceNumbers(s).map(amcpNum).join(' ')).join(' ')}`
}

/** The `<slices>` block for the window's `<screen>` (restart-safe baseline; live edits go over APPLY). */
function slicesXml(window, indent = '                    ') {
	const slices = Array.isArray(window?.slices) ? window.slices : []
	if (!slices.length) return ''
	const rows = slices.map((s) => {
		const n = sliceNumbers(s).map(amcpNum)
		return `${indent}    <slice>
${indent}        <src>${n.slice(0, 4).join(' ')}</src>
${indent}        <dst>${n.slice(4, 12).join(' ')}</dst>
${indent}        <opacity>${n[12]}</opacity>
${indent}        <feather>${n.slice(13, 17).join(' ')}</feather>
${indent}        <clip>${n.slice(17, 21).join(' ')}</clip>
${indent}    </slice>`
	})
	return `${indent}<slices>\n${rows.join('\n')}\n${indent}</slices>`
}

/**
 * What changes the GENERATED config (and so needs Apply + a Caspar restart) as opposed to what APPLY changes live:
 * per output its backend and direct placement (DeckLink `<subregion>`, xrandr head), and the window's raster and
 * head layout. Slice geometry inside a window is not in it.
 */
function planConfigSignature(plan) {
	return JSON.stringify({
		outputs: (plan?.outputs || []).map((o) => [o.outputId, o.backend, o.direct || null, o.backend === 'screen-slices' ? o.pos : null]),
		window: plan?.window ? [plan.window.width, plan.window.height, plan.window.outputs] : null,
	})
}

module.exports = {
	SLICE_WINDOW_DEVICE_BASE,
	MAX_SLICE_WINDOWS,
	screenConsumerIndex,
	sliceWindowsFromConfig,
	amcpNum,
	sliceNumbers,
	slicesSetParams,
	slicesXml,
	planConfigSignature,
}
