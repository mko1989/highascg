'use strict'

/**
 * WO-624 E1 — add / remove operator compose windows on the server (owner 20.10: "i should be able to add each
 * source from live tab to be a window in the compose/live preview standard").
 *
 * The web kept dropped source tiles in browser localStorage (WO-323, client/components/operator-compose-tiles-state.js
 * sourceTileRejection / addSourceTileFromDrop) and reported them as `mvcell` cells. Here the server owns those rules:
 * a drop names a Sources-panel item ({ type, value, label, resolution }) and a point on the canvas; the server checks
 * it, sizes the window and applies the persisted cell set plus the new window exactly like a client report (so the
 * `operatorGuiLayout` broadcast re-syncs every client and the project keeps the arrangement).
 *
 * PGM / PRV routes become the main's own `pgm` / `prv` cell (server aspect-fit, role chrome); any other route is an
 * `mvcell` sized at the source aspect (mvcell rects are not aspect-fitted by the server).
 */

const { getChannelMap } = require('../config/routing')
const { parseRouteClip } = require('../engine/scene-route-deps')
const { resolveOperatorGuiChannelDims } = require('./operator-gui-channel-geometry')
const {
	applyOperatorGuiLayout,
	getPersistedOperatorGuiLayout,
	noteClientLayoutReport,
	resolveOperatorGuiChannel,
} = require('./operator-gui-channel')

const DEFAULT_W = 0.3 // web addSourceTileFromDrop: ~30% of the canvas wide
const FALLBACK_DIMS = { width: 1920, height: 1080 }

/** The media-inspector cell(s) of the last client report — the persisted set omits them, and a server-side edit
 * must not stop a running media preview (operator-gui-media-layer.js clears it on present → absent). */
let lastMediaCells = []

/** @param {unknown[]} cells - a client's full report (POST /api/operator-gui/layout) */
function noteReportedCells(cells) {
	lastMediaCells = (Array.isArray(cells) ? cells : []).filter((c) => c && c.role === 'media')
}

/** "1920×1080" / "1280x720" → { width, height } | null */
function parseResolution(s) {
	const m = String(s || '').match(/(\d+)\s*[×x]\s*(\d+)/i)
	if (!m) return null
	const width = Number(m[1])
	const height = Number(m[2])
	return width > 0 && height > 0 ? { width, height } : null
}

/**
 * Web sourceTileRejection, server side: only route:// sources compose; never a multiview output (WO-156) or the
 * compose channel itself (a self-route wedges the mosaic). `composeCh` is the channel the apply really targets
 * (resolveOperatorGuiChannel) — the channel map's `operatorGuiCh` can be null on a box whose compose channel is
 * resolved from its destination (box 20.10: map null, compose ch 3).
 * @returns {string|null}
 */
function sourceCellRejection(value, map, composeCh = null) {
	const parsed = parseRouteClip(value)
	if (!parsed) return `"${value}" has no playout channel to compose — only route:// live sources can be added.`
	const ch = parsed.channel
	const mv = Array.isArray(map.multiviewChannels) && map.multiviewChannels.length
		? map.multiviewChannels.map(Number)
		: (map.multiviewCh != null ? [Number(map.multiviewCh)] : [])
	if (mv.includes(ch)) return `Cannot compose route://${ch} — channel ${ch} is a multiview output.`
	const og = Array.isArray(map.operatorGuiChannels) && map.operatorGuiChannels.length
		? map.operatorGuiChannels.map(Number)
		: (map.operatorGuiCh != null ? [Number(map.operatorGuiCh)] : [])
	if (composeCh != null) og.push(Number(composeCh))
	if (og.includes(ch)) return `Cannot compose route://${ch} — channel ${ch} is the compose output itself.`
	return null
}

/**
 * A window of `DEFAULT_W` canvas width at `aspect`, centred on `at` (canvas fractions) and kept inside the canvas.
 * @returns {{ x: number, y: number, w: number, h: number }} fractions
 */
function defaultRect(at, aspect, gui) {
	const W = gui.width
	const H = gui.height
	let w = W * DEFAULT_W
	let h = w / aspect
	if (h > H) {
		h = H
		w = h * aspect
	}
	const frac = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(1, Math.max(0, Number(v))) : 0.5)
	const ax = frac(at?.x)
	const ay = frac(at?.y)
	const x = Math.min(W - w, Math.max(0, ax * W - w / 2))
	const y = Math.min(H - h, Math.max(0, ay * H - h / 2))
	return { x: x / W, y: y / H, w: w / W, h: h / H }
}

/**
 * Pure: the cell a drop adds to `cells`, or why not.
 * @param {{ type?: string, value?: string, label?: string, resolution?: string }} item
 * @param {{ x?: number, y?: number }} at - drop point, canvas fractions
 * @param {object[]} cells - the current (persisted) cell set
 * @param {object} map - getChannelMap()
 * @param {{ width: number, height: number }|null} gui - operator canvas dims
 * @param {number|null} [composeCh] - the compose channel itself (never routable into it)
 * @returns {{ cell: object } | { status: number, error: string }}
 */
function planSourceCell(item, at, cells, map, gui, composeCh = null) {
	const value = String(item?.value || '').trim()
	const rejection = sourceCellRejection(value, map || {}, composeCh)
	if (rejection) return { status: 400, error: rejection }
	const ch = parseRouteClip(value).channel
	const label = String(item?.label || value)
	const list = Array.isArray(cells) ? cells : []
	const dims = gui && gui.width > 0 && gui.height > 0 ? gui : FALLBACK_DIMS
	const res = parseResolution(item?.resolution)
	const aspect = res ? res.width / res.height : 16 / 9
	const pgm = Array.isArray(map.programChannels) ? map.programChannels.map(Number).indexOf(ch) : -1
	const prv = Array.isArray(map.previewChannels) ? map.previewChannels.map(Number).indexOf(ch) : -1
	if (pgm >= 0 || prv >= 0) {
		const role = pgm >= 0 ? 'pgm' : 'prv'
		const mainIndex = pgm >= 0 ? pgm : prv
		if (list.some((c) => c?.role === role && (parseInt(String(c.mainIndex ?? 0), 10) || 0) === mainIndex)) {
			return { status: 409, error: `${role.toUpperCase()} ${mainIndex + 1} is already on the preview.` }
		}
		return { cell: { id: `${role}_${mainIndex + 1}`, role, mainIndex, rect: defaultRect(at, aspect, dims), surface: 'compose' } }
	}
	const id = `src_${value.replace(/[^a-z0-9]+/gi, '_')}`
	if (list.some((c) => c?.id === id || (c?.role === 'mvcell' && Number(c.srcCh) === ch))) {
		return { status: 409, error: `${label} is already on the preview.` }
	}
	const cell = { id, role: 'mvcell', srcCh: ch, mainIndex: 0, label, rect: defaultRect(at, aspect, dims), surface: 'compose' }
	if (res) Object.assign(cell, { srcW: res.width, srcH: res.height })
	cell.sourceTile = { type: String(item?.type || 'route'), value, label }
	return { cell }
}

/**
 * Pure: `cells` without window `id`, or why not. The last window cannot go: an empty set is never persisted
 * (operator-gui-channel.js — it means "no client reporting"), so the old windows would come back.
 * @returns {{ cells: object[] } | { status: number, error: string }}
 */
function planRemoveCell(id, cells) {
	const list = Array.isArray(cells) ? cells : []
	if (!list.some((c) => c?.id === id)) return { status: 404, error: `No window "${id}" on the preview.` }
	if (list.length <= 1) return { status: 409, error: 'The last window stays — the preview needs at least one.' }
	return { cells: list.filter((c) => c?.id !== id) }
}

async function apply(ctx, cells) {
	const full = [...cells, ...lastMediaCells]
	noteClientLayoutReport(ctx, full)
	if (!ctx.amcp) return { skipped: true, reason: 'amcp_disconnected' }
	return applyOperatorGuiLayout(ctx, full)
}

/** POST /api/operator-gui/cell — body { item: { type, value, label, resolution }, at: { x, y } } */
async function addSourceCell(ctx, body) {
	const { cells } = getPersistedOperatorGuiLayout(ctx)
	const config = ctx.config || {}
	const composeCh = resolveOperatorGuiChannel(config)?.ch ?? null
	const plan = planSourceCell(body?.item, body?.at, cells, getChannelMap(config), resolveOperatorGuiChannelDims(config), composeCh)
	if (!plan.cell) return { status: plan.status, body: { ok: false, error: plan.error } }
	const next = [...cells, plan.cell]
	const result = await apply(ctx, next)
	return { status: 200, body: { ok: true, cell: plan.cell, cells: next, ...(result?.skipped ? { skipped: true, reason: result.reason } : {}) } }
}

/** POST /api/operator-gui/cell/remove — body { id } */
async function removeCell(ctx, body) {
	const { cells } = getPersistedOperatorGuiLayout(ctx)
	const plan = planRemoveCell(String(body?.id || ''), cells)
	if (!plan.cells) return { status: plan.status, body: { ok: false, error: plan.error } }
	const result = await apply(ctx, plan.cells)
	return { status: 200, body: { ok: true, cells: plan.cells, ...(result?.skipped ? { skipped: true, reason: result.reason } : {}) } }
}

module.exports = {
	noteReportedCells,
	parseResolution,
	planSourceCell,
	planRemoveCell,
	addSourceCell,
	removeCell,
}
