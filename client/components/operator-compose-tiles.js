/**
 * WO-256 — Operator-GUI compose canvas: the compose preview panel body becomes a free-tile
 * canvas, multiviewer-style movable/resizable windows whose BODY rects feed the existing shaped-
 * video pipeline (client/lib/operator-gui-mode.js's 'compose' surface, unchanged wire format —
 * `{ id, role, mainIndex, rect }` per tile, same shape client/components/preview-canvas-panel.js
 * already emitted for the old canvas-pair). Only ever constructed by preview-canvas-panel.js when
 * `isOperatorGuiModeActive()` is true (see its `operatorTilesActive` gate) — this module itself
 * has no gate of its own, callers own that.
 *
 * Each tile = body (the reported video rect — literally empty; the Caspar consumer shows through a
 * HOLE punched in Firefox at this rect, WO-263) + a footer strip BELOW the body (owner: chrome must
 * never overlay the video) holding a screen-label row (drag handle, `${ROLE} ${screen} / ${label}`,
 * screen-label.js WO-222) above the playback timer (clip file name + single running-layer progress
 * bar, `mountPgmTopLayerPlaybackTimer` from playback-timer.js — WO-250's bank-aware
 * `pickTopLayerStateForPlayback`, imported/reused there, never copied here). When NO source is
 * running, that same strip shows the topmost layer's content label with the timer/progress bar
 * hidden (WO-297, `pickTopLayerContentForIdle` — same scan, no second top-layer implementation);
 * a channel with nothing on any layer shows nothing. The footer height is unchanged either way —
 * TILE_CHROME.footerH is what the hole geometry is derived from. headerH is 0.
 *
 * Chrome (border/footer) is laid out by explicit pixel math (`tileBodyRectFromOuter` ->
 * `tileHoleRectFromOuter`), not flexbox. Geometry rules (todos19.07.26):
 *  - The HOLE (body) keeps the SOURCE channel's aspect ratio ({@link resolveTileAspect}: INFO-
 *    derived `channelMap.channelResolutionsByChannel` per resolved channel, else
 *    `programResolutions[mainIndex]`, else 16:9) — the largest aspect-fit rect centered inside the
 *    tile's content area, letterboxing the tile frame as needed so the punched rect never distorts.
 *  - The border is an `outline` on the body element itself (10b-operator-compose-tiles.css): an
 *    outline draws OUTSIDE the element box, so its inner edge is exactly the hole edge and no
 *    border pixel ever covers the video. `TILE_CHROME.borderW` reserves that ring inside the tile.
 *  - The rect reported to operator-gui-mode is the body/hole rect (bodyEl's own
 *    getBoundingClientRect), so the X SHAPE hole and the visible border keep the just-outside
 *    relationship live during drags/resizes too (WO-263).
 */
import { screenLabel } from '../lib/screen-label.js'
import { holeRectFromOuter, chromeInsets } from '../lib/hole-rect.js'
import { watchElementPosition } from '../lib/element-position-watch.js'
import { mountPgmTopLayerPlaybackTimer } from './playback-timer.js'
import { api } from '../lib/api-client.js'
import { showAppToast } from '../lib/app-toast.js'
import { setOperatorComposeHolesSuppressed } from '../lib/operator-gui-mode.js'
import {
	isOperatorLiveCanvasEnabled,
	operatorLiveCanvasHasFrame,
	drawOperatorLiveCanvasCrop,
	subscribeOperatorLiveCanvasRepaint,
	subscribeOperatorLiveCanvasState,
} from './preview-canvas-live-stream.js'

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

/**
 * Source aspect ratio (w/h) for a tile: the resolved source channel's INFO-derived resolution
 * (`channelMap.channelResolutionsByChannel`) wins; `programResolutions[mainIndex]` is the
 * pre-INFO fallback (PGM/PRV share the physical screen's mode); default {@link DEFAULT_TILE_ASPECT}.
 * Pure — mirrors the server's own contain-fit source dims (operator-gui-channel.js
 * `resolveCellSourceDims`) so the server's aspect-fit inside the reported hole is a no-op.
 * @param {{ role?: string, mainIndex?: number }} def
 * @param {object} cm - `stateStore.getState().channelMap`
 * @returns {number}
 */
export function resolveTileAspect(def, cm) {
	const map = cm || {}
	const ch = resolveTileChannel(def || {}, map)
	const byCh = map.channelResolutionsByChannel || {}
	const res = ch != null ? byCh[ch] ?? byCh[String(ch)] : null
	if (res && Number(res.w) > 0 && Number(res.h) > 0) return Number(res.w) / Number(res.h)
	const pr = map.programResolutions?.[def?.mainIndex ?? -1]
	if (pr && Number(pr.w) > 0 && Number(pr.h) > 0) return Number(pr.w) / Number(pr.h)
	return DEFAULT_TILE_ASPECT
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

/**
 * Has the real channel state arrived yet? (2026-07-19 bug: "after highascg restart the operator gui
 * starts with a stale compose preview layout".)
 *
 * The kiosk client renders this canvas BEFORE the WS `state` message lands, so
 * `stateStore.getState().channelMap` is still `{}` — preview-canvas-panel.js's `getComposeCellDefs`
 * then reads `Math.max(1, cm.screenCount || 1)` and produces ONE provisional `pgm_1` def, whose
 * layout {@link resolveTileLayout} legitimately defaults to a single full-canvas tile (the saved
 * multi-screen map is stored under a different {@link layoutStorageKey}, keyed by screen count, and
 * would not cover `pgm_1` anyway). Reporting that provisional rect CLOBBERS the multi-cell layout
 * the server just re-applied from `operatorGuiLayout` persistence. So: report nothing until this
 * returns true. `screenCount` is always present on a server-built channelMap
 * (src/config/channel-map-from-ctx.js), so its absence is an unambiguous "not booted yet".
 * @param {object|null|undefined} cm - `stateStore.getState().channelMap`
 * @returns {boolean}
 */
export function hasResolvedChannelState(cm) {
	const map = cm || {}
	const n = Number(map.screenCount)
	if (Number.isFinite(n) && n >= 1) return true
	return Array.isArray(map.programChannels) && map.programChannels.length > 0
}

/** localStorage key for a screen-count-keyed tile layout, following preview-canvas-panel.js's `storageKeyPrefix` convention. */
export function layoutStorageKey(storageKeyPrefix, screenCount) {
	return `${storageKeyPrefix || 'casparcg_preview'}_operator_tiles_${Math.max(1, parseInt(screenCount, 10) || 1)}`
}

/**
 * Resolve the layout to render: the stored map wins ONLY when it covers every current def id
 * (a screen-count/role-set change re-defaults wholesale, matching the "Reset layout" mental model
 * rather than producing a half-migrated mix). Pure — no localStorage access.
 * @param {Array<{ id: string, role: string, mainIndex: number }>} defs
 * @param {Record<string, { x: number, y: number, w: number, h: number }> | null | undefined} storedMap
 */
export function resolveTileLayout(defs, storedMap) {
	const ids = Array.isArray(defs) ? defs.map((d) => d.id) : []
	const hasAll = storedMap && ids.length > 0 && ids.every((id) => storedMap[id])
	if (hasAll) {
		const out = {}
		for (const id of ids) out[id] = storedMap[id]
		return out
	}
	return computeDefaultTileLayout(defs)
}

/** @param {{ getItem: (k: string) => string | null }} storage */
export function loadTileLayout(storage, key) {
	try {
		const raw = storage?.getItem?.(key)
		if (!raw) return null
		const parsed = JSON.parse(raw)
		return parsed && typeof parsed === 'object' ? parsed : null
	} catch (_) {
		return null
	}
}

/** @param {{ setItem: (k: string, v: string) => void }} storage */
export function saveTileLayout(storage, key, layoutMap) {
	try {
		storage?.setItem?.(key, JSON.stringify(layoutMap))
	} catch (_) {
		// Best-effort — a full/unavailable localStorage must not break the canvas.
	}
}

function resolveTileChannel(d, cm) {
	if (d.role === 'prv') return cm.previewChannels?.[d.mainIndex] ?? null
	return cm.playbackChannels?.[d.mainIndex] ?? cm.programChannels?.[d.mainIndex] ?? null
}

/**
 * WO-272 (todos19.07.26): PGM-tile action buttons — real chrome only (the footer label row; hole
 * rects are click-dead by design, X SHAPE input∩bounding).
 *  - EDIT PGM: dispatches the existing 'scenes-edit-live-on-pgm' event (same as the compose-pair
 *    badge in preview-canvas-compose-cell-chrome.js) — the scenes editor opens the look live on
 *    this main's PGM channel with edits applying straight to air (edit-on-PGM mode).
 *  - CAPTURE: POST /api/pgm/capture — Caspar PRINT of the resolved PGM channel; PNG lands in the
 *    Caspar media folder. Toast confirms (decklink-input-toast.js conventions).
 * pointerdown must not bubble: the footer is the tile drag handle.
 * @param {number} mainIndex
 * @returns {HTMLElement}
 */
function buildPgmTileActions(mainIndex) {
	const wrap = document.createElement('div')
	wrap.className = 'operator-tile__actions'
	const stopDrag = (e) => e.stopPropagation()

	const editBtn = document.createElement('button')
	editBtn.type = 'button'
	editBtn.className = 'operator-tile__btn operator-tile__btn--edit'
	editBtn.textContent = 'EDIT PGM'
	editBtn.title = 'Open the on-air look in the looks editor — edits apply straight to PGM'
	editBtn.addEventListener('pointerdown', stopDrag)
	editBtn.addEventListener('click', (e) => {
		e.stopPropagation()
		document.dispatchEvent(new CustomEvent('scenes-edit-live-on-pgm', { detail: { mainIndex } }))
	})

	const captureBtn = document.createElement('button')
	captureBtn.type = 'button'
	captureBtn.className = 'operator-tile__btn operator-tile__btn--capture'
	captureBtn.textContent = 'CAPTURE'
	captureBtn.title = 'Snapshot this PGM channel (Caspar PRINT → PNG in the media folder)'
	captureBtn.addEventListener('pointerdown', stopDrag)
	captureBtn.addEventListener('click', async (e) => {
		e.stopPropagation()
		if (captureBtn.disabled) return
		captureBtn.disabled = true
		try {
			const res = await api.post('/api/pgm/capture', { mainIndex })
			showAppToast(
				res?.file
					? `PGM ${mainIndex + 1} captured → ${res.file}`
					: `PGM ${mainIndex + 1} captured (PNG in Caspar media folder)`,
				'success',
			)
		} catch (err) {
			showAppToast(`Capture failed: ${err?.message || err}`, 'error')
		} finally {
			captureBtn.disabled = false
		}
	})

	wrap.append(editBtn, captureBtn)
	return wrap
}

/**
 * @param {HTMLElement} container - mount point (preview-canvas-panel.js's `tilesMountEl`)
 * @param {{
 *   getComposeCellDefs: () => Array<{ id: string, role: 'pgm'|'prv', mainIndex: number }>,
 *   stateStore: { getState: () => any, on?: (path: string, fn: Function) => (() => void) },
 *   storageKeyPrefix?: string,
 *   getOscClient?: (() => any) | null,
 *   onCellRects?: ((cellRects: Array<{ id: string, role: string, mainIndex: number, rect: { left: number, top: number, width: number, height: number } }>) => void) | null,
 * }} options
 */
export function initOperatorComposeTiles(container, options) {
	const { getComposeCellDefs, stateStore, storageKeyPrefix = 'casparcg_preview', getOscClient = null, onCellRects = null } = options || {}
	const storage = typeof localStorage !== 'undefined' ? localStorage : null

	const root = document.createElement('div')
	root.className = 'operator-compose-tiles'
	const resetBtn = document.createElement('button')
	resetBtn.type = 'button'
	resetBtn.className = 'operator-compose-tiles__reset-btn'
	resetBtn.textContent = 'Reset layout'
	root.appendChild(resetBtn)
	container.appendChild(root)

	// 2026-07-19 bug: switching looks list <-> looks editor shifts the whole canvas vertically at
	// the SAME size (the rundown slot above the preview host toggles), so ResizeObserver/scroll
	// never fire and the reported rects — the punched holes + route video — stayed at the old Y
	// while the DOM tile borders moved. Watch the root's viewport POSITION too (idle-free
	// IntersectionObserver hug-box, see element-position-watch.js) and re-report on any move.
	// `scheduleReport` is a hoisted function declaration, safe to hand over here.
	const posWatch = watchElementPosition(root, () => scheduleReport())

	const getCm = () => stateStore?.getState?.()?.channelMap || {}

	/** @type {Map<string, { def: object, frac: { x: number, y: number, w: number, h: number }, px: { x: number, y: number, w: number, h: number } | null, pxDesired: { x: number, y: number, w: number, h: number } | null, el: HTMLElement, bodyEl: HTMLElement, footerEl: HTMLElement, labelEl: HTMLElement, timer: { destroy: () => void, refresh: () => void } | null }>} */
	const tiles = new Map()
	let defsKey = ''
	let storageKey = layoutStorageKey(storageKeyPrefix, 1)
	let rafReport = null
	let drag = null
	let lastCanvasSize = { w: 0, h: 0 }
	/** See {@link hasResolvedChannelState}: false until the WS `state`/`channelMap` payload has
	 * landed. While false the tiles still BUILD and lay out (so the operator sees a frame) but
	 * NOTHING is reported — a provisional single-tile rect would overwrite the server's persisted
	 * multi-cell layout ~0.7s after a highascg restart. Latches true the moment real state arrives;
	 * every later report (drag, resize, position watch) is completely unaffected. */
	let stateReady = false

	function currentDefs() {
		return Array.isArray(getComposeCellDefs?.()) ? getComposeCellDefs() : []
	}

	function persist() {
		const map = {}
		for (const [id, t] of tiles) map[id] = t.frac
		saveTileLayout(storage, storageKey, map)
	}

	function canvasSize() {
		const r = root.getBoundingClientRect()
		return { w: Math.max(1, r.width), h: Math.max(1, r.height) }
	}

	function layoutTileDom(t) {
		const { w: cw, h: ch } = canvasSize()
		// On first layout, initialize px and pxDesired from frac. Subsequent layouts preserve px (clamped to canvas bounds).
		if (!t.px) {
			t.px = { x: t.frac.x * cw, y: t.frac.y * ch, w: t.frac.w * cw, h: t.frac.h * ch }
			t.pxDesired = { ...t.px }
		}
		const outer = { left: t.px.x, top: t.px.y, width: t.px.w, height: t.px.h }
		t.el.style.left = `${outer.left}px`
		t.el.style.top = `${outer.top}px`
		t.el.style.width = `${outer.width}px`
		t.el.style.height = `${outer.height}px`
		// The body IS the punched hole: aspect-locked to the source channel (todos19.07.26), so the
		// visible outline (drawn just outside bodyEl) hugs the video with no overlap and no distortion.
		const hole = tileHoleRectFromOuter(
			{ left: 0, top: 0, width: outer.width, height: outer.height },
			resolveTileAspect(t.def, getCm()),
		)
		t.bodyEl.style.left = `${hole.left}px`
		t.bodyEl.style.top = `${hole.top}px`
		t.bodyEl.style.width = `${hole.width}px`
		t.bodyEl.style.height = `${hole.height}px`
		t.footerEl.style.height = `${TILE_CHROME.footerH}px`
	}

	function reportRectsNow() {
		if (typeof onCellRects !== 'function') return
		// Provisional (pre-state) render: never report. Prefer not-reporting over
		// reporting-then-correcting — the server's re-applied layout is the better truth until the
		// real channelMap lands and `rebuild()` re-derives the tiles from it.
		if (!stateReady) return
		const cellRects = []
		for (const t of tiles.values()) {
			// bodyEl IS the aspect-locked hole — report the INNER rect, never the outlined/frame box,
			// so the X SHAPE hole and the visible border keep the just-outside relationship (WO-263).
			const rect = t.bodyEl.getBoundingClientRect()
			cellRects.push({ id: t.def.id, role: t.def.role, mainIndex: t.def.mainIndex, rect })
		}
		onCellRects(cellRects)
		// Re-hug the freshest canvas position so the next pure MOVE (no resize/scroll) re-reports.
		posWatch.update()
	}

	function scheduleReport() {
		if (rafReport != null) return
		rafReport = requestAnimationFrame(() => { rafReport = null; reportRectsNow() })
	}

	// WO-319 — draw each tile's crop of the operator live canvas into its body canvas. The operator
	// channel is a mosaic of routed feeds laid out to the tile rects, so each tile shows the frame
	// region at its OWN viewport fraction — exactly what its punch-hole revealed of the screen
	// consumer. Driven at frame rate by the live-canvas repaint, so drags/resizes track for free.
	let liveActive = false
	function drawLiveCrops() {
		const on = liveActive && isOperatorLiveCanvasEnabled() && operatorLiveCanvasHasFrame()
		const vw = window.innerWidth || 1
		const vh = window.innerHeight || 1
		for (const t of tiles.values()) {
			const cv = t.liveCanvas
			if (!cv) continue
			if (!on) {
				if (cv.style.display !== 'none') cv.style.display = 'none'
				continue
			}
			const r = t.bodyEl.getBoundingClientRect()
			if (r.width < 2 || r.height < 2) {
				cv.style.display = 'none'
				continue
			}
			const w = Math.round(r.width)
			const h = Math.round(r.height)
			if (cv.width !== w) cv.width = w
			if (cv.height !== h) cv.height = h
			const cx = cv.getContext('2d')
			if (!cx) continue
			const ok = drawOperatorLiveCanvasCrop(cx, r.left / vw, r.top / vh, r.width / vw, r.height / vh, 0, 0, w, h)
			cv.style.display = ok ? 'block' : 'none'
		}
	}

	// Suppress the punch-holes (server keeps the mosaic) while streaming, so the browser draws the
	// crops; restore them when it stops. Redraw on every decoded frame and on any state flip.
	function onLiveState(state) {
		liveActive = !!(state && state.streaming)
		setOperatorComposeHolesSuppressed(liveActive)
		// Force a re-report so the shape overlay flips holes off/on immediately for the new state.
		scheduleReport()
		drawLiveCrops()
	}
	const unsubLiveFrame = subscribeOperatorLiveCanvasRepaint(drawLiveCrops)
	const unsubLiveState = subscribeOperatorLiveCanvasState(onLiveState)

	function layoutAll() {
		for (const t of tiles.values()) layoutTileDom(t)
		scheduleReport()
	}

	function onCanvasResize() {
		const newSize = canvasSize()
		// Canvas size changed: preserve px sizes (clamped to new bounds), update fractions
		if ((newSize.w !== lastCanvasSize.w || newSize.h !== lastCanvasSize.h) && lastCanvasSize.w > 0) {
			const minOuter = minOuterSize()
			for (const t of tiles.values()) {
				if (!t.px) continue // Not yet laid out
				// Try to restore pxDesired (the size the user set), then clamp if needed to fit new canvas
				t.px = clampTileRect(t.pxDesired, newSize.w, newSize.h, minOuter.width, minOuter.height)
				// Update fractions to match new px in new canvas size
				t.frac = { x: t.px.x / newSize.w, y: t.px.y / newSize.h, w: t.px.w / newSize.w, h: t.px.h / newSize.h }
			}
		}
		lastCanvasSize = newSize
		layoutAll()
	}

	function buildTile(def, frac) {
		const el = document.createElement('div')
		el.className = 'operator-tile'
		el.dataset.role = def.role
		el.dataset.tileId = def.id

		const bodyEl = document.createElement('div')
		bodyEl.className = 'operator-tile__body'
		// WO-319: the live-canvas crop for this tile. Hidden by default; while the operator live canvas
		// is streaming it fills the body with this tile's sub-region of the operator mosaic, replacing
		// the punch-hole (which is withheld server-side via suppressHoles). pointer-events:none so the
		// footer/resize chrome keeps working; the visible border/label/timer stay ON TOP as before.
		const liveCanvasEl = document.createElement('canvas')
		liveCanvasEl.className = 'operator-tile__live'
		liveCanvasEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:none;'
		bodyEl.appendChild(liveCanvasEl)

		// All chrome sits BELOW the video body (owner: label + progress bar must not overlay any
		// actual content). The footer holds a screen-label row (also the drag handle) above the
		// playback timer (which itself shows the clip file name + progress bar).
		const footerEl = document.createElement('div')
		footerEl.className = 'operator-tile__footer'
		// Label ROW: label text (relabel() rewrites only labelEl.textContent) + WO-272 PGM action
		// buttons on the right — still inside the footer chrome, never over the video hole.
		const labelRowEl = document.createElement('div')
		labelRowEl.className = 'operator-tile__labelrow'
		const labelEl = document.createElement('div')
		labelEl.className = 'operator-tile__label'
		labelEl.textContent = `${def.role.toUpperCase()} ${def.mainIndex + 1} / ${screenLabel(getCm(), def.mainIndex)}`
		labelRowEl.appendChild(labelEl)
		if (def.role === 'pgm') labelRowEl.appendChild(buildPgmTileActions(def.mainIndex))
		footerEl.appendChild(labelRowEl)

		const resizeEl = document.createElement('div')
		resizeEl.className = 'operator-tile__resize'

		el.append(bodyEl, footerEl, resizeEl)
		root.appendChild(el)

		const t = { def, frac, px: null, pxDesired: null, el, bodyEl, footerEl, labelEl, liveCanvas: liveCanvasEl, timer: null }

		footerEl.addEventListener('pointerdown', (e) => startDrag(e, t, 'move'))
		resizeEl.addEventListener('pointerdown', (e) => startDrag(e, t, 'resize'))

		const osc = typeof getOscClient === 'function' ? getOscClient() : null
		if (osc) {
			// mountPgmTopLayerPlaybackTimer replaces its container's className wholesale
			// ('playback-timer ...') — mount into an inner child so footerEl keeps its own
			// 'operator-tile__footer' positioning class (the chrome/body-rect invariant).
			const timerHost = document.createElement('div')
			footerEl.appendChild(timerHost)
			t.timer = mountPgmTopLayerPlaybackTimer(timerHost, {
				oscClient: osc,
				getChannel: () => resolveTileChannel(def, getCm()) ?? 1,
				getState: () => stateStore?.getState?.() || null,
			})
		}
		return t
	}

	function relabel(t) {
		t.labelEl.textContent = `${t.def.role.toUpperCase()} ${t.def.mainIndex + 1} / ${screenLabel(getCm(), t.def.mainIndex)}`
	}

	function startDrag(e, t, mode) {
		if (e.button != null && e.button !== 0) return
		e.preventDefault()
		e.stopPropagation()
		const { w: cw, h: ch } = canvasSize()
		drag = {
			t, mode, startX: e.clientX, startY: e.clientY,
			startFrac: { ...t.frac }, cw, ch,
		}
		t.el.classList.add('operator-tile--dragging')
		try { e.target.setPointerCapture?.(e.pointerId) } catch (_) { /* best-effort */ }
		document.addEventListener('pointermove', onDragMove)
		document.addEventListener('pointerup', onDragEnd)
		document.addEventListener('pointercancel', onDragEnd)
	}

	function onDragMove(e) {
		if (!drag) return
		const { t, mode, startX, startY, startFrac, cw, ch } = drag
		const dx = e.clientX - startX
		const dy = e.clientY - startY
		const minOuter = minOuterSize()
		const startPx = { x: startFrac.x * cw, y: startFrac.y * ch, w: startFrac.w * cw, h: startFrac.h * ch }
		let nextPx
		if (mode === 'move') {
			nextPx = { x: snapToGrid(startPx.x + dx), y: snapToGrid(startPx.y + dy), w: startPx.w, h: startPx.h }
		} else {
			nextPx = { x: startPx.x, y: startPx.y, w: snapToGrid(startPx.w + dx), h: snapToGrid(startPx.h + dy) }
		}
		const clamped = clampTileRect(nextPx, cw, ch, minOuter.width, minOuter.height)
		t.px = clamped
		t.pxDesired = { ...clamped }
		t.frac = { x: clamped.x / cw, y: clamped.y / ch, w: clamped.w / cw, h: clamped.h / ch }
		layoutTileDom(t)
		// WO-263: report the new body rect LIVE during the drag so the Firefox hole tracks the box
		// in real time (the video follows the resize). The old model suppressed here because the
		// video sat ABOVE the DOM and couldn't show the drag; holes-in-Firefox can.
		scheduleReport()
	}

	function onDragEnd() {
		document.removeEventListener('pointermove', onDragMove)
		document.removeEventListener('pointerup', onDragEnd)
		document.removeEventListener('pointercancel', onDragEnd)
		if (drag) drag.t.el.classList.remove('operator-tile--dragging')
		drag = null
		persist()
		// Final settle report (the live drag reports were throttled/rAF; guarantee the last rect).
		reportRectsNow()
	}

	function rebuild() {
		// Latch readiness here (not only in the channelMap listener) so EVERY rebuild path —
		// refreshDefs() from preview-canvas-panel, the channelMap subscription, the one-shot
		// full-state subscription below — flips the gate as soon as real state is visible.
		if (!stateReady && hasResolvedChannelState(getCm())) stateReady = true
		const defs = currentDefs()
		const key = JSON.stringify(defs.map((d) => ({ id: d.id, role: d.role, mainIndex: d.mainIndex })))
		const screenCount = new Set(defs.map((d) => d.mainIndex)).size || 1
		storageKey = layoutStorageKey(storageKeyPrefix, screenCount)
		// Same defs: labels AND hole aspects may still have changed (INFO-derived
		// channelResolutionsByChannel arrives after the first channelMap snapshot) — re-layout so
		// the holes snap to the real source aspect and the new rects get reported.
		if (key === defsKey) { for (const t of tiles.values()) relabel(t); layoutAll(); return }
		defsKey = key
		for (const t of tiles.values()) { t.timer?.destroy?.(); t.el.remove() }
		tiles.clear()
		lastCanvasSize = { w: 0, h: 0 }
		const stored = loadTileLayout(storage, storageKey)
		const resolved = resolveTileLayout(defs, stored)
		for (const d of defs) tiles.set(d.id, buildTile(d, resolved[d.id]))
		layoutAll()
	}

	function resetLayout() {
		saveTileLayout(storage, storageKey, {})
		const defs = currentDefs()
		const { w: cw, h: ch } = canvasSize()
		const fresh = computeDefaultTileLayout(defs, cw, ch)
		for (const [id, t] of tiles) {
			if (fresh[id]) {
				t.frac = fresh[id]
				// Reset px and pxDesired so they're re-derived on next layoutTileDom
				t.px = null
				t.pxDesired = null
			}
		}
		persist()
		layoutAll()
	}
	resetBtn.addEventListener('click', (e) => { e.stopPropagation(); resetLayout() })

	const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onCanvasResize) : null
	ro?.observe(root)
	const onWinResize = () => layoutAll()
	const onWinScroll = () => scheduleReport()
	// Workspace tab switches reflow the whole page — re-layout + re-report deterministically
	// (belt-and-suspenders next to posWatch; also covers environments without IntersectionObserver).
	const onTabActivated = () => layoutAll()
	window.addEventListener('resize', onWinResize)
	window.addEventListener('scroll', onWinScroll, true)
	window.addEventListener('highascg-workspace-tab-activated', onTabActivated)
	const unsubCm = stateStore?.on?.('channelMap', () => rebuild())
	// The WS full-`state` message goes through StateStore.setState(), which emits ONLY '*' — it
	// never emits 'channelMap' (client/lib/state-store.js) — so the subscription above alone can
	// leave this canvas parked on its provisional defs until some later incremental change (in
	// practice: the first look take). Watch '*' too, but only until real state has landed, then
	// unsubscribe so the hot per-change path stays untouched.
	let unsubAnyState = null
	const onAnyState = () => {
		if (stateReady) return
		rebuild()
		if (stateReady) {
			unsubAnyState?.()
			unsubAnyState = null
		}
	}

	rebuild()
	if (!stateReady) unsubAnyState = stateStore?.on?.('*', onAnyState) || null

	return {
		refreshDefs: rebuild,
		destroy() {
			ro?.disconnect()
			posWatch.destroy()
			window.removeEventListener('resize', onWinResize)
			window.removeEventListener('scroll', onWinScroll, true)
			window.removeEventListener('highascg-workspace-tab-activated', onTabActivated)
			unsubCm?.()
			unsubAnyState?.()
			unsubLiveFrame?.()
			unsubLiveState?.()
			// WO-319: restore the holes if we were suppressing them, so a torn-down tiles surface never
			// leaves the compose region hole-less (which would hide the screen consumer with nothing on top).
			setOperatorComposeHolesSuppressed(false)
			if (rafReport != null) cancelAnimationFrame(rafReport)
			for (const t of tiles.values()) t.timer?.destroy?.()
			tiles.clear()
			// Withdraw only if this canvas ever reported: tearing down while still provisional must
			// not send an empty set either (that DELETEs the server's restored layout).
			if (stateReady && typeof onCellRects === 'function') onCellRects([])
			root.remove()
		},
	}
}
