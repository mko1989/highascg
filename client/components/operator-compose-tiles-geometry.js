/**
 * Pure tile geometry for operator-compose-tiles.js: chrome/body/hole rect math and the default
 * grid-layout optimizer (T256.5). No DOM, no state — every function here is a pure function of its
 * arguments.
 */
import { holeRectFromOuter, chromeInsets } from '../lib/hole-rect.js'

/** Content-area minimum (max video rect) — chrome (border/header/footer) is additional, see {@link minOuterSize}. */
export const MIN_BODY = { width: 160, height: 90 }
/** Header/footer/border pixel sizes — kept in lockstep with client/styles/10b-operator-compose-tiles.css.
 * `borderW` is the ring reserved INSIDE the tile for the body outline, which itself draws just
 * OUTSIDE the hole (inner outline edge = hole edge — no border pixel over the video). */
export const TILE_CHROME = { headerH: 0, footerH: 34, borderW: 2 }
/** Fallback hole aspect when the channel map has no resolution for a tile's source channel. */
export const DEFAULT_TILE_ASPECT = 16 / 9
const GRID = 8

/** @returns {{ width: number, height: number }} smallest OUTER (tile) size whose body still meets {@link MIN_BODY}. */
export function minOuterSize(chrome = TILE_CHROME) {
	return {
		width: MIN_BODY.width + chrome.borderW * 2,
		height: MIN_BODY.height + chrome.borderW * 2 + chrome.headerH + chrome.footerH,
	}
}

/**
 * Pure geometry: the video-rect (body) carved out of a tile's own OUTER px rect. Chrome sits
 * strictly outside on all 4 sides — border-box border consumes the left/right border width,
 * header/footer consume top/bottom — so the returned rect never overlaps border/header/footer.
 * @param {{ left: number, top: number, width: number, height: number }} outer
 * @param {{ headerH: number, footerH: number, borderW: number }} [chrome]
 */
export function tileBodyRectFromOuter(outer, chrome = TILE_CHROME) {
	return holeRectFromOuter(outer, chromeInsets(chrome))
}

/**
 * The punched-hole (video) rect: the largest `aspect`-preserving rect centered inside the tile's
 * content area ({@link tileBodyRectFromOuter}). The frame letterboxes/pillarboxes around it — the
 * hole never distorts the source mapping, and it stays >= `chrome.borderW` inside the tile on
 * every side so the body outline (drawn just outside the hole) never leaves the tile box.
 * @param {{ left: number, top: number, width: number, height: number }} outer - tile OUTER px rect
 * @param {number} aspect - source width/height ratio; invalid values fall back to {@link DEFAULT_TILE_ASPECT}
 * @param {{ headerH: number, footerH: number, borderW: number }} [chrome]
 */
export function tileHoleRectFromOuter(outer, aspect, chrome = TILE_CHROME) {
	const content = tileBodyRectFromOuter(outer, chrome)
	if (!(content.width > 0) || !(content.height > 0)) return content
	const ar = Number.isFinite(Number(aspect)) && Number(aspect) > 0 ? Number(aspect) : DEFAULT_TILE_ASPECT
	let width = content.width
	let height = width / ar
	if (height > content.height) {
		// Content relatively wider than the source -> pillarbox (bars left/right).
		height = content.height
		width = height * ar
	}
	return {
		left: content.left + (content.width - width) / 2,
		top: content.top + (content.height - height) / 2,
		width,
		height,
	}
}

/** @param {number} value @param {number} [grid] */
export function snapToGrid(value, grid = GRID) {
	return Math.round(value / grid) * grid
}

/**
 * Clamp a px rect to stay fully inside `[0,0,canvasW,canvasH]` and never shrink below `minW/minH`.
 * @param {{ x: number, y: number, w: number, h: number }} rect
 */
export function clampTileRect(rect, canvasW, canvasH, minW, minH) {
	let w = Math.max(minW, Math.min(rect.w, Math.max(minW, canvasW)))
	let h = Math.max(minH, Math.min(rect.h, Math.max(minH, canvasH)))
	let x = Math.max(0, Math.min(rect.x, Math.max(0, canvasW - w)))
	let y = Math.max(0, Math.min(rect.y, Math.max(0, canvasH - h)))
	return { x, y, w, h }
}

/**
 * Compute hole area for a given tile in a cell, accounting for chrome and aspect ratio.
 * Used by computeDefaultTileLayout to evaluate grid configurations.
 * @param {number} cellWidth - outer (tile) cell width in pixels
 * @param {number} cellHeight - outer (tile) cell height in pixels
 * @param {number} aspect - source aspect ratio (width/height); must be finite and > 0
 * @returns {number} hole area (pixels²)
 */
function tileHoleAreaInCell(cellWidth, cellHeight, aspect) {
	const content = tileBodyRectFromOuter({ left: 0, top: 0, width: cellWidth, height: cellHeight })
	if (content.width <= 0 || content.height <= 0) return 0
	const ar = aspect > 0 ? aspect : DEFAULT_TILE_ASPECT
	let holeW = content.width
	let holeH = holeW / ar
	if (holeH > content.height) {
		holeH = content.height
		holeW = holeH * ar
	}
	return holeW * holeH
}

/**
 * Default layout math (T256.5): optimized grid arrangement that maximises hole area. Evaluates
 * different grid configurations (1..N rows) and picks the one that yields the best total hole area,
 * accounting for actual tile aspect ratios (or 16:9 default) and canvas shape. Tiles are laid out
 * row-by-row in reading order (left-to-right, top-to-bottom), with PRV before PGM within each
 * mainIndex to preserve the existing compose-pair's PRV-first convention.
 *
 * Pure fractions (0-1 of the canvas). Optional canvasW/canvasH (default 1920x1080, 16:9) allow
 * canvas-aspect-aware optimization; when omitted, a balanced grid is computed on the default aspect.
 *
 * @param {Array<{ id: string, role: 'pgm'|'prv', mainIndex: number }>} defs
 * @param {number} [canvasW=1920] - canvas width in pixels (for grid optimization)
 * @param {number} [canvasH=1080] - canvas height in pixels (for grid optimization)
 * @returns {Record<string, { x: number, y: number, w: number, h: number }>}
 */
export function computeDefaultTileLayout(defs, canvasW = 1920, canvasH = 1080) {
	const n = Array.isArray(defs) ? defs.length : 0
	if (n === 0) return {}

	const minOuter = minOuterSize()
	let bestRows = 1
	let bestHoleArea = 0

	// Evaluate candidate row counts 1..N, pick the one that maximises total hole area.
	for (let rows = 1; rows <= n; rows++) {
		const cols = Math.ceil(n / rows)

		// Check if this grid configuration can fit every tile at its minimum size.
		const cellW = canvasW / cols
		const cellH = canvasH / rows
		if (cellW < minOuter.width || cellH < minOuter.height) continue

		// Compute total hole area: assume all tiles have 16:9 (worst-case common case).
		// The real aspect ratios will be applied later during actual layout.
		let totalHoleArea = 0
		for (let i = 0; i < n; i++) {
			totalHoleArea += tileHoleAreaInCell(cellW, cellH, DEFAULT_TILE_ASPECT)
		}

		if (totalHoleArea > bestHoleArea) {
			bestHoleArea = totalHoleArea
			bestRows = rows
		}
	}

	const cols = Math.ceil(n / bestRows)
	const cellW = 1 / cols
	const cellH = 1 / bestRows

	// Sort defs: by mainIndex first, then role (PRV before PGM) to maintain reading order convention.
	const sorted = defs.slice().sort((a, b) => {
		const mainDiff = a.mainIndex - b.mainIndex
		if (mainDiff !== 0) return mainDiff
		return (a.role === 'prv' ? 0 : 1) - (b.role === 'prv' ? 0 : 1)
	})

	// Fill the grid row-by-row, left-to-right.
	/** @type {Record<string, { x: number, y: number, w: number, h: number }>} */
	const out = {}
	let idx = 0
	for (let row = 0; row < bestRows; row++) {
		for (let col = 0; col < cols && idx < n; col++) {
			const d = sorted[idx++]
			out[d.id] = { x: col * cellW, y: row * cellH, w: cellW, h: cellH }
		}
	}

	return out
}
