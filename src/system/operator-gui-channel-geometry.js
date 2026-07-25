/**
 * operator-gui-channel-geometry.js — WO-243/254/255: pure geometry/resolution helpers split out of
 * operator-gui-channel.js. Destination/channel resolution, cell-source-channel/dims resolution, the
 * aspect-fit math, and the pure cells -> per-layer route/rect plan builder. No I/O beyond reading
 * `config` — see operator-gui-channel.js for the stateful apply/persistence/runtime side.
 */
'use strict'

const { getChannelMap } = require('../config/routing')
const { destinationsFromConfig } = require('../config/screen-destinations')
const { getModeDimensions } = require('../config/config-modes')
const { screenModeString } = require('../config/config-generator-mode-helpers')
const { operatorGuiModeDimensions } = require('../config/config-generator-channel-plan')
const { resolveOperatorGuiPort } = require('../config/config-generator-operator-gui')
const { resolveLayoutRectForOperatorPort } = require('../utils/x-display-session-layout')

const ROUTE_LAYER_START = 10
const ROUTE_LAYER_MAX = 49
const DEFAULT_GUI_URL = 'http://127.0.0.1:4200/?operatorGui=1'

/**
 * @param {object} config
 * @returns {ReturnType<import('../config/screen-destinations').normalizeDestination>|null}
 */
function operatorGuiDestination(config) {
	const dests = destinationsFromConfig(config)
	return dests.find((d) => d && d.mode === 'operator_gui') || null
}

/**
 * @param {object} config
 * @returns {{ ch: number, dest: object, guiUrl: string }|null}
 */
function resolveOperatorGuiChannel(config) {
	const dest = operatorGuiDestination(config)
	if (!dest) return null
	const map = getChannelMap(config)
	const ch = map.operatorGuiCh
	if (ch == null) return null
	return { ch, dest, guiUrl: String(dest.guiUrl || DEFAULT_GUI_URL) }
}

function clampFraction(v) {
	const n = parseFloat(String(v))
	if (!Number.isFinite(n)) return 0
	return Math.min(1, Math.max(0, n))
}

/**
 * Resolve the route:// source channel for one preview cell (compose PGM/PRV, or WO-255's
 * 'multiview' role for the mv-edit dock surface — routes the whole multiview channel into the
 * reported rect rather than indexing by mainIndex).
 * @param {{ role?: string, mainIndex?: number }} cell
 * @param {ReturnType<typeof getChannelMap>} map
 * @returns {number|null}
 */
function resolveCellSourceChannel(cell, map) {
	if (cell?.role === 'multiview') return map.multiviewCh ?? null
	// 'mvcell' (2026-07-17, mv-editor blend): the multiview layout editor's per-cell holes carry
	// an explicit source channel (route:// cells can point at any channel, not a mainIndex).
	if (cell?.role === 'mvcell') {
		const srcCh = Number(cell.srcCh)
		if (!Number.isFinite(srcCh) || srcCh <= 0) return null
		const ch = Math.floor(srcCh)
		// WO-156: never route a multiview output into an mv-editor hole — the client filters
		// this too, but the map is authoritative here and a stale client reporting
		// srcCh == multiview channel would wedge the multiview exactly as WO-156 documented.
		const mvChs = Array.isArray(map.multiviewChannels) && map.multiviewChannels.length
			? map.multiviewChannels
			: (map.multiviewCh != null ? [map.multiviewCh] : [])
		if (mvChs.includes(ch)) return null
		return ch
	}
	const role = cell?.role === 'prv' ? 'prv' : 'pgm'
	const idx = Math.max(0, parseInt(String(cell?.mainIndex ?? 0), 10) || 0)
	if (role === 'pgm') return Array.isArray(map.programChannels) ? (map.programChannels[idx] ?? null) : null
	return Array.isArray(map.previewChannels) ? (map.previewChannels[idx] ?? null) : null
}

/**
 * WO-255 T255.1: resolve the operator monitor's ROOT/absolute-pixel rect for the shape helper —
 * same port-resolution chain the generator uses (`resolveOperatorGuiPort`, incl. the gpu-map
 * fallback inside `resolveLayoutRectForOperatorPort`), so the shape helper's monitor rect always
 * matches where the generator actually placed the screen consumer window.
 * @param {object} config
 * @param {object} [layout] - pre-computed `calculateLayoutPositions()` result; recomputed if omitted
 * @returns {{x: number, y: number, w: number, h: number}|null}
 */
function resolveOperatorGuiMonitorRect(config, layout) {
	const dest = operatorGuiDestination(config)
	if (!dest) return null
	const port = resolveOperatorGuiPort(config, dest)
	if (port == null) return null
	try {
		const rect = resolveLayoutRectForOperatorPort(config, layout || null, port)
		if (rect && rect.width > 0 && rect.height > 0) return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
	} catch (_) {
		/* hardware detection unavailable (headless/tests) — treat as unresolved */
	}
	return null
}

/**
 * WO-255 T255.1: pure conversion — a 0-1 viewport-fraction rect (of the GUI channel's raster) to
 * monitor-relative INTEGER pixels, for the shape helper's stdin protocol. Deliberately scales by
 * the MONITOR rect's own width/height, not the GUI channel raster's dims: the shape helper matches
 * its target window by monitor-rect geometry (operator-shape-overlay.py), so monitor-relative is
 * the coordinate space its rects must already be in — the channel raster and the monitor rect can
 * differ in size (e.g. a custom operator_gui video-mode vs. the physical monitor's native res).
 * @param {{x: number, y: number, w: number, h: number}} fracRect
 * @param {{w: number, h: number}} monitorRect
 * @returns {[number, number, number, number]}
 */
function fractionRectToMonitorPx(fracRect, monitorRect) {
	return [
		Math.round((Number(fracRect?.x) || 0) * monitorRect.w),
		Math.round((Number(fracRect?.y) || 0) * monitorRect.h),
		Math.round((Number(fracRect?.w) || 0) * monitorRect.w),
		Math.round((Number(fracRect?.h) || 0) * monitorRect.h),
	]
}

/**
 * WO-254 T254.1 — resolve the GUI channel's own raster dims (the coordinate space cell rects are
 * fractions OF). Returns null when there's no operator_gui destination or its dims don't resolve
 * to a positive size — callers must treat null as "keep today's stretch-fill behavior".
 * @param {object} config
 * @returns {{width: number, height: number}|null}
 */
function resolveOperatorGuiChannelDims(config) {
	const dest = operatorGuiDestination(config)
	if (!dest) return null
	const dims = operatorGuiModeDimensions(dest)
	return dims && dims.width > 0 && dims.height > 0 ? { width: dims.width, height: dims.height } : null
}

/**
 * WO-254 T254.1 — resolve a compose-cell's SOURCE channel raster dims (PGM/PRV share the same
 * physical screen's mode, keyed by mainIndex+1 — mirrors {@link resolveCellSourceChannel}'s
 * indexing and `config-compare.js`'s "Screen N preview" role reuse of `screen_N_mode`). Unlike
 * `hostChannelVideoSize` (cef-interactive-forward.js:72-83, which only resolves PGM/multiview
 * channels via reverse channel-number lookup), this resolves directly by screen index so PRV
 * cells get correct dims too.
 * @param {{ mainIndex?: number }} cell
 * @param {object} config
 * @returns {{width: number, height: number}|null}
 */
function resolveCellSourceDims(cell, config) {
	const idx = Math.max(0, parseInt(String(cell?.mainIndex ?? 0), 10) || 0)
	/* WO-327 follow-up (todos25): destinations are the modern config surface — a custom-res
	 * screen carries videoMode 'custom' + explicit width/height on its screenDestinations entry,
	 * and the legacy `screen_N_mode` keys may not exist AT ALL on such a box. Falling straight
	 * through to them resolved the 1080p default, so every custom-res screen's source was
	 * aspect-fit as 16:9 inside its compose hole ("compose preview doesn't show the correct
	 * aspect ratio when a screen is custom res"). Screen dest first, legacy keys as fallback.
	 * operator_gui/multiview/stream dests are not screen rasters — skip them (the operator_gui
	 * dest shares mainScreenIndex 0 and would otherwise shadow the real PGM screen). */
	const dest = destinationsFromConfig(config).find((d) => {
		const mode = String(d?.mode || '')
		if (mode === 'operator_gui' || mode === 'multiview' || mode === 'stream') return false
		return Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) === idx
	})
	if (dest) {
		const dd = operatorGuiModeDimensions(dest)
		if (dd && dd.width > 0 && dd.height > 0) return { width: dd.width, height: dd.height }
	}
	const dims = getModeDimensions(screenModeString(config, idx + 1), config, idx + 1)
	return dims && dims.width > 0 && dims.height > 0 ? { width: dims.width, height: dims.height } : null
}

/**
 * Pure pixel-space "contain" fit: the largest rect inside `cellPx` that preserves `srcW`/`srcH`'s
 * aspect ratio, centered. Source wider (relative) than the cell -> bars top/bottom (letterbox);
 * source narrower (relative) than the cell -> bars left/right (pillarbox). Degenerate guard:
 * zero/negative cell or source dims pass `cellPx` through unchanged (no NaN/Infinity).
 * @param {{x?: number, y?: number, w: number, h: number}} cellPx
 * @param {number} srcW
 * @param {number} srcH
 * @returns {{x: number, y: number, w: number, h: number}}
 */
function fitAspectRectPx(cellPx, srcW, srcH) {
	const cx = Number(cellPx?.x) || 0
	const cy = Number(cellPx?.y) || 0
	const cw = Number(cellPx?.w) || 0
	const ch = Number(cellPx?.h) || 0
	const sw = Number(srcW) || 0
	const sh = Number(srcH) || 0
	if (!(cw > 0) || !(ch > 0) || !(sw > 0) || !(sh > 0)) {
		return { x: cx, y: cy, w: cw, h: ch }
	}
	const cellAR = cw / ch
	const srcAR = sw / sh
	let w
	let h
	if (srcAR > cellAR) {
		// Source relatively wider than the cell -> width-constrained, bars top/bottom.
		w = cw
		h = w / srcAR
	} else {
		// Source relatively narrower than (or equal to) the cell -> height-constrained, bars left/right.
		h = ch
		w = h * srcAR
	}
	return { x: cx + (cw - w) / 2, y: cy + (ch - h) / 2, w, h }
}

/**
 * WO-254 T254.1 — cell rects are VIEWPORT-FRACTION rects (0-1) of the GUI channel's raster, not
 * of the source's. Aspect math must therefore convert to absolute pixels of the GUI raster
 * first (fraction × guiDims), fit in pixel space, then normalize back to fractions — doing the
 * fit directly in fraction space would silently conflate the GUI raster's own aspect with the
 * source's whenever the GUI raster isn't square. Pure function, no I/O.
 * @param {{x: number, y: number, w: number, h: number}} cellFrac - clamped 0-1 viewport-fraction cell rect
 * @param {{width: number, height: number}} guiDims - GUI channel raster dims
 * @param {{width: number, height: number}} srcDims - source channel raster dims
 * @returns {{x: number, y: number, w: number, h: number}} fitted 0-1 fraction rect
 */
function computeAspectFitCellRect(cellFrac, guiDims, srcDims) {
	const guiW = Number(guiDims?.width) || 0
	const guiH = Number(guiDims?.height) || 0
	if (!(guiW > 0) || !(guiH > 0)) return cellFrac
	const cellPx = {
		x: (Number(cellFrac?.x) || 0) * guiW,
		y: (Number(cellFrac?.y) || 0) * guiH,
		w: (Number(cellFrac?.w) || 0) * guiW,
		h: (Number(cellFrac?.h) || 0) * guiH,
	}
	const fittedPx = fitAspectRectPx(cellPx, srcDims?.width, srcDims?.height)
	return {
		x: clampFraction(fittedPx.x / guiW),
		y: clampFraction(fittedPx.y / guiH),
		w: clampFraction(fittedPx.w / guiW),
		h: clampFraction(fittedPx.h / guiH),
	}
}

/**
 * Pure function: cells -> per-layer route/rect plan. No I/O — fully unit-testable. Cells whose
 * channel resolves to null are skipped (per T243.2: "skip cells whose channel is null").
 *
 * WO-254 T254.1: when `config` is supplied and both the GUI channel's and the cell's source
 * channel's raster dims resolve, the emitted rect is the largest aspect-preserving fit INSIDE
 * the reported cell rect (letterbox/pillarbox, centered) instead of the raw cell rect — CasparCG
 * `MIXER FILL` stretches to whatever rect it's given, so without this a 16:9 source stretches to
 * fill non-16:9 holes. `config` is optional and defaults to today's stretch-fill behavior (kept
 * for the existing WO-243 call sites/tests that don't pass it).
 * @param {Array<{id?: string, role?: string, mainIndex?: number, rect?: {x:number,y:number,w:number,h:number}}>} cells
 * @param {ReturnType<typeof getChannelMap>} map
 * @param {object} [config] - app config; enables aspect-fit when its operator_gui dims resolve
 * @returns {Array<{layer: number, route: string, srcCh: number, x: number, y: number, w: number, h: number}>}
 */
function computeOperatorGuiCellPlan(cells, map, config) {
	const guiDims = config ? resolveOperatorGuiChannelDims(config) : null
	const out = []
	let layer = ROUTE_LAYER_START
	for (const cell of Array.isArray(cells) ? cells : []) {
		if (layer > ROUTE_LAYER_MAX) break
		const srcCh = resolveCellSourceChannel(cell, map)
		if (srcCh == null) continue
		const rect = cell?.rect || {}
		let fitted = {
			x: clampFraction(rect.x),
			y: clampFraction(rect.y),
			w: clampFraction(rect.w),
			h: clampFraction(rect.h),
		}
		// 'mvcell' skips aspect-fit: the mv editor's cell box IS the target shape (the real
		// multiview output MIXER-FILL-stretches its cells the same way), and mainIndex-keyed
		// resolveCellSourceDims would resolve the wrong screen's mode for an arbitrary channel.
		if (guiDims && cell?.role !== 'mvcell') {
			const srcDims = resolveCellSourceDims(cell, config)
			if (srcDims) fitted = computeAspectFitCellRect(fitted, guiDims, srcDims)
		}
		out.push({
			layer,
			route: `route://${srcCh}`,
			srcCh,
			x: fitted.x,
			y: fitted.y,
			w: fitted.w,
			h: fitted.h,
		})
		layer++
	}
	return out
}

module.exports = {
	ROUTE_LAYER_START,
	ROUTE_LAYER_MAX,
	DEFAULT_GUI_URL,
	operatorGuiDestination,
	resolveOperatorGuiChannel,
	resolveOperatorGuiMonitorRect,
	fractionRectToMonitorPx,
	resolveCellSourceChannel,
	resolveOperatorGuiChannelDims,
	resolveCellSourceDims,
	fitAspectRectPx,
	computeAspectFitCellRect,
	computeOperatorGuiCellPlan,
}
