'use strict'

/**
 * WO-869 — which backend draws each output of a mapping node (pure). The operator never chooses; the planner does,
 * from the output's sink and its slice set (WO §2.0 table + owner decisions 30.10):
 *
 * | sink     | slices                                                     | backend                               |
 * |----------|------------------------------------------------------------|---------------------------------------|
 * | none     | any                                                        | idle (nothing to draw)                |
 * | DeckLink | 0, or 1 slice 1:1 (no rotate/flip/warp, opacity 1, no feather) | direct: `<subregion>` src → dest-x/y |
 * | DeckLink | anything else                                              | refused (Q2: placement only on SDI in v1); the first slice is still placed 1:1 |
 * | GPU head | 0, or 1 slice 1:1 at dst (0,0)                             | direct: today's xrandr head at src.x/y |
 * | GPU head | anything else                                              | screen-slices (one `<screen>` window per node, Q8) when Caspar has them, else route-slices when allowed and in budget (Q3), else refused |
 * | other    | any                                                        | refused                               |
 *
 * Every existing project lands on `direct` with byte-identical config (zero regression). The compiled slice is the
 * quad (mapping-slices-geometry.js): `{ id, src:{x,y,w,h}, dst:[ul,ur,lr,ll] in output px, opacity, feather }`.
 */

const { dstQuad, isConvexQuad, isOneToOne } = require('./mapping-slices-geometry')
const { getCasparCaps } = require('./caspar-caps')
const { effectiveSlices } = require('./mapping-slices-model')

const REASONS = {
	SDI_PLACEMENT_ONLY:
		'SDI outputs show one 1:1 slice (placement only). Scaling, rotation, keystone, flips, opacity, feather and several slices need a GPU output.',
	NO_SCREEN_SLICES:
		'This Caspar build cannot draw slices in its screen consumer (no APPLY … SLICES). Install the WO-869 build.',
	OVER_BUDGET: 'Route slices need one more Caspar channel and the channel budget is used up. Cable this output to a GPU head.',
	OTHER_SINK: 'Only DeckLink and GPU outputs take slices.',
}

/** Default channel budget (WO-502: seven channels at 50p fill the single GL thread). */
const DEFAULT_CHANNEL_BUDGET = 7

function resolveSizeOf(outDef) {
	return require('../utils/mapping-gpu-os-layout').resolveOutputPixelSize(outDef)
}

/**
 * Sink kind per output id for one node: 'decklink' | 'gpu' | 'other' (cabled elsewhere) | null (not cabled).
 * Connector ↔ output matching is the same as the config generator's (index, then `${nodeId}_${outId}`, then suffix).
 * @returns {Map<string, 'decklink'|'gpu'|'other'|null>}
 */
function resolveOutputSinks(graph, node) {
	const nodeId = String(node?.id || '')
	const connectors = Array.isArray(graph?.connectors) ? graph.connectors : []
	const edges = Array.isArray(graph?.edges) ? graph.edges : []
	const byId = new Map(connectors.map((c) => [String(c?.id || ''), c]))
	const outs = connectors.filter((c) => String(c?.deviceId || '') === nodeId && c?.kind === 'pixel_map_out')
	const outputs = Array.isArray(node?.settings?.outputs) ? node.settings.outputs : []
	const map = new Map()
	outputs.forEach((o, idx) => {
		const oid = String(o?.id || '')
		const conn =
			outs.find((c) => Number(c?.index) === idx) ||
			outs.find((c) => String(c?.id || '') === `${nodeId}_${oid}`) ||
			outs.find((c) => String(c?.id || '').endsWith(`_${oid}`))
		const edge = conn && edges.find((e) => String(e?.sourceId || '') === String(conn.id))
		const sink = edge && byId.get(String(edge.sinkId || ''))
		let kind = null
		if (sink) {
			if (sink.kind === 'decklink_io' || sink.kind === 'decklink_out') kind = 'decklink'
			else if (sink.kind === 'gpu_out' || sink.kind === 'gpu_output') kind = 'gpu'
			else kind = 'other'
		}
		map.set(oid, kind)
	})
	return map
}

function hasFeather(s) {
	const f = s.feather || {}
	return !!(f.l || f.t || f.r || f.b)
}

/** 1:1, opaque, unfeathered: what a `<subregion>` / a plain head shows without resampling. */
function isPlainCopy(s) {
	return isOneToOne(s) && s.opacity >= 1 && !hasFeather(s)
}

/**
 * The stored feather names the slice's sides as they sit on the output (before rotation); Caspar feathers the quad's
 * own edges (l = ul–ll, t = ul–ur in SOURCE corner order), so a flip swaps the pair it mirrors.
 */
function quadFeather(s) {
	const f = { l: 0, t: 0, r: 0, b: 0, ...(s.feather || {}) }
	const h = s.dst?.flipH === true
	const v = s.dst?.flipV === true
	return { l: h ? f.r : f.l, r: h ? f.l : f.r, t: v ? f.b : f.t, b: v ? f.t : f.b }
}

/** @returns {{ id: string, src: object, dst: number[][], opacity: number, feather: object }} */
function compileSlice(s) {
	return { id: s.id, src: { ...s.src }, dst: dstQuad(s.dst), opacity: s.opacity, feather: quadFeather(s) }
}

/** Output positions on the node's window canvas: stored `pos`, else packed left to right in output order. */
function outputPositions(outputs) {
	const out = new Map()
	let cumX = 0
	for (const o of outputs) {
		const { width } = resolveSizeOf(o)
		const p = o?.pos && typeof o.pos === 'object' ? o.pos : null
		const x = p && Number.isFinite(Number(p.x)) ? Math.round(Number(p.x)) : cumX
		const y = p && Number.isFinite(Number(p.y)) ? Math.round(Number(p.y)) : 0
		out.set(String(o?.id || ''), { x, y })
		cumX = Math.max(cumX, x + width)
	}
	return out
}

/**
 * @param {object} node pixel_mapping device
 * @param {{ sinks?: Map<string, string|null>, graph?: object, caps?: { screenSlices?: boolean|null, routeSlices?: boolean },
 *   channelBudget?: { used: number, max?: number } }} [opts] `caps` defaults to the running Caspar's (config/caspar-caps.js)
 */
function planMappingNode(node, opts = {}) {
	const settings = node?.settings || {}
	const outputs = Array.isArray(settings.outputs) ? settings.outputs : []
	const sinks = opts.sinks || resolveOutputSinks(opts.graph || {}, node)
	const caps = opts.caps || getCasparCaps()
	const budget = opts.channelBudget || null
	const positions = outputPositions(outputs)
	const slices = effectiveSlices(node)
		.map((s, i) => ({ s, i }))
		.sort((a, b) => a.s.z - b.s.z || a.i - b.i)
		.map((e) => e.s)
	const warnings = []
	let routeChannelsTaken = 0
	const planned = outputs.map((o) => {
		const oid = String(o?.id || '')
		const { width, height } = resolveSizeOf(o)
		const mine = slices.filter((s) => s.outputId === oid && s.enabled)
		const valid = mine.filter((s) => {
			const ok = isConvexQuad(dstQuad(s.dst))
			if (!ok) warnings.push(`${s.name}: the warped shape is not convex; it is not drawn.`)
			return ok
		})
		const sink = sinks.get(oid) ?? null
		const row = {
			outputId: oid,
			label: String(o?.label || oid),
			sink,
			size: { w: width, h: height },
			pos: positions.get(oid),
			backend: 'idle',
			reason: '',
			slices: valid.map(compileSlice),
		}
		const first = valid[0]
		if (sink === null) return row
		if (sink === 'other') return { ...row, backend: 'refused', reason: REASONS.OTHER_SINK }
		if (sink === 'decklink') {
			const direct = first ? { src: { ...first.src }, destX: first.dst.rect.x, destY: first.dst.rect.y } : null
			if (valid.length <= 1 && (!first || isPlainCopy(first))) return { ...row, backend: 'direct', direct }
			return { ...row, backend: 'refused', reason: REASONS.SDI_PLACEMENT_ONLY, direct }
		}
		// GPU head
		if (valid.length === 0 || (valid.length === 1 && isPlainCopy(first) && first.dst.rect.x === 0 && first.dst.rect.y === 0)) {
			return { ...row, backend: 'direct', direct: first ? { src: { ...first.src }, destX: 0, destY: 0 } : null }
		}
		if (caps.screenSlices !== false) return { ...row, backend: 'screen-slices' }
		// Refused GPU outputs still show their first slice the legacy way (the head at its src), as SDI does.
		const fallback = { src: { ...first.src }, destX: 0, destY: 0 }
		if (caps.routeSlices === true) {
			const max = Number.isFinite(Number(budget?.max)) ? Number(budget.max) : DEFAULT_CHANNEL_BUDGET
			const used = Number(budget?.used) || 0
			if (used + routeChannelsTaken + 1 > max) {
				return { ...row, backend: 'refused', reason: REASONS.OVER_BUDGET, direct: fallback }
			}
			routeChannelsTaken++
			return { ...row, backend: 'route-slices' }
		}
		return { ...row, backend: 'refused', reason: REASONS.NO_SCREEN_SLICES, direct: fallback }
	})
	// Q8: once the node has a slice window, its other GPU heads that show a slice join it. Left `direct` they would
	// need the PGM window spanning the node canvas, which sits on the same heads as the slice window.
	if (planned.some((r) => r.backend === 'screen-slices')) {
		planned.forEach((r, i) => {
			if (r.sink !== 'gpu' || r.backend !== 'direct' || !r.direct) return
			const { direct, ...rest } = r
			planned[i] = { ...rest, backend: 'screen-slices' }
		})
	}
	return { nodeId: String(node?.id || ''), outputs: planned, window: buildSliceWindow(planned), warnings }
}

/**
 * The node's one screen-slices window (Q8): the bounding box of its screen-slices outputs at their `pos`; each
 * slice's quad moved into window px and clipped to its own output (a slice never spills onto the next head).
 */
function buildSliceWindow(planned) {
	const rows = planned.filter((r) => r.backend === 'screen-slices')
	if (!rows.length) return null
	const minX = Math.min(...rows.map((r) => r.pos.x))
	const minY = Math.min(...rows.map((r) => r.pos.y))
	const maxX = Math.max(...rows.map((r) => r.pos.x + r.size.w))
	const maxY = Math.max(...rows.map((r) => r.pos.y + r.size.h))
	const slices = []
	for (const r of rows) {
		const ox = r.pos.x - minX
		const oy = r.pos.y - minY
		for (const s of r.slices) {
			slices.push({
				id: s.id,
				outputId: r.outputId,
				src: s.src,
				dst: s.dst.map(([x, y]) => [x + ox, y + oy]),
				opacity: s.opacity,
				feather: s.feather,
				clip: { x: ox, y: oy, w: r.size.w, h: r.size.h },
			})
		}
	}
	return {
		origin: { x: minX, y: minY },
		width: maxX - minX,
		height: maxY - minY,
		outputs: rows.map((r) => ({ outputId: r.outputId, x: r.pos.x - minX, y: r.pos.y - minY, w: r.size.w, h: r.size.h })),
		slices,
	}
}

/** One plan per pixel_mapping node of a device graph. */
function planAllMappingNodes(graph, opts = {}) {
	const devices = Array.isArray(graph?.devices) ? graph.devices : []
	return devices
		.filter((d) => d && d.role === 'pixel_mapping')
		.map((d) => planMappingNode(d, { ...opts, graph, sinks: resolveOutputSinks(graph, d) }))
}

module.exports = {
	REASONS,
	resolveOutputSinks,
	compileSlice,
	planMappingNode,
	planAllMappingNodes,
}
