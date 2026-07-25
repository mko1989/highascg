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
import { parseRouteValue, resolveMvCellSourceChannel } from '../lib/input-channels.js'
import { holeRectFromOuter, chromeInsets } from '../lib/hole-rect.js'
import { watchElementPosition } from '../lib/element-position-watch.js'
import { mountPgmTopLayerPlaybackTimer } from './playback-timer.js'
import { api } from '../lib/api-client.js'
import { showAppToast } from '../lib/app-toast.js'
import { isOperatorGuiModeActive, subscribeSharedLayout } from '../lib/operator-gui-mode.js'
import {
	drawOperatorLiveCanvasCrop,
	operatorLiveCanvasHasFrame,
	isOperatorLiveCanvasEnabled,
	subscribeOperatorLiveCanvasRepaint,
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

export function resolveTileChannel(d, cm) {
	// WO-323 user source tile: explicit channel, resolved from the tile's route value at def-build
	// time (resolveSourceTileChannel) — never mainIndex-addressable.
	if (d.role === 'mvcell') {
		const ch = Number(d.srcCh)
		return Number.isFinite(ch) && ch > 0 ? Math.floor(ch) : null
	}
	if (d.role === 'prv') return cm.previewChannels?.[d.mainIndex] ?? null
	return cm.playbackChannels?.[d.mainIndex] ?? cm.programChannels?.[d.mainIndex] ?? null
}

/*
 * WO-323 — user-added live-source tiles (Decklink/NDI/… from the Sources panel Live tab, dropped
 * onto this canvas like the multiview editor). Persisted SEPARATELY from the pgm/prv layout map so
 * {@link resolveTileLayout}'s "re-default wholesale on role-set change" rule never wipes them.
 * Each stored tile keeps its original drag payload identity ({ type, value, label }) so the
 * channel is re-resolved against the CURRENT channel map on every rebuild (WO-271 route-heal via
 * resolveMvCellSourceChannel — a channel-map shift must not leave the tile on a stale number).
 */

/** localStorage key for the user source tiles (shared across screen counts — they are user content). */
export function sourceTilesStorageKey(storageKeyPrefix) {
	return `${storageKeyPrefix || 'casparcg_preview'}_operator_source_tiles`
}

/** @returns {Array<{ id: string, type: string, value: string, label: string, frac: object }>} */
export function loadSourceTiles(storage, key) {
	try {
		const raw = storage?.getItem?.(key)
		if (!raw) return []
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter((t) => t && typeof t === 'object' && typeof t.value === 'string' && t.id)
	} catch (_) {
		return []
	}
}

export function saveSourceTiles(storage, key, list) {
	try {
		storage?.setItem?.(key, JSON.stringify(Array.isArray(list) ? list : []))
	} catch (_) {
		// Best-effort — a full/unavailable localStorage must not break the canvas.
	}
}

/**
 * Normalize a Sources-panel drag payload (sources-panel-helpers.js makeDraggable: single
 * `{ type, value, label, … }` or `{ type: 'multi', items: [...] }`) to a flat item list.
 * @returns {Array<{ type: string, value: string, label: string }>}
 */
export function normalizeSourceDropItems(data) {
	if (!data || typeof data !== 'object') return []
	const items = data.type === 'multi' && Array.isArray(data.items) ? data.items : [data]
	return items
		.filter((it) => it && typeof it.value === 'string' && it.value)
		.map((it) => ({ type: String(it.type || ''), value: it.value, label: String(it.label || it.value), resolution: it.resolution }))
}

/**
 * Rejection message for dropping a source onto the compose tiles, or null when allowed.
 * Blocks: non-route values (a source with no Caspar channel cannot be composed — e.g. direct NDI
 * without a host channel), the multiview outputs (WO-156 — routing a multiview into a cell wedges
 * it) and the operator-GUI compose channel itself (self-route would wedge the compose mosaic the
 * same way).
 * @param {string} value - drag payload value
 * @param {object} cm - state.channelMap
 * @returns {string|null}
 */
export function sourceTileRejection(value, cm) {
	const parsed = parseRouteValue(value)
	if (!parsed) {
		return `"${value}" has no playout channel to compose — only route:// live sources (configured inputs) can be added.`
	}
	const map = cm || {}
	const mvChs = Array.isArray(map.multiviewChannels) && map.multiviewChannels.length
		? map.multiviewChannels.map(Number)
		: (map.multiviewCh != null ? [Number(map.multiviewCh)] : [])
	if (mvChs.includes(parsed.channel)) {
		return `Cannot compose route://${parsed.channel} — channel ${parsed.channel} is a multiview output (routing it into a cell would freeze it).`
	}
	if (map.operatorGuiCh != null && parsed.channel === Number(map.operatorGuiCh)) {
		return `Cannot compose route://${parsed.channel} — channel ${parsed.channel} is the compose output itself.`
	}
	return null
}

/**
 * Resolve a stored source tile's CURRENT channel: identity-first heal against the live channel
 * map (WO-271, same resolver the multiview editor uses), so a Decklink tile follows its slot
 * across channel-map shifts. Null when the route is stale and unresolvable.
 * @param {{ id?: string, type?: string, value?: string, label?: string }} tile
 * @param {object} cm - state.channelMap
 * @returns {number|null}
 */
export function resolveSourceTileChannel(tile, cm) {
	const parsed = parseRouteValue(tile?.value)
	if (!parsed) return null
	return resolveMvCellSourceChannel({ id: tile.id, type: tile.type, label: tile.label }, parsed, cm)
}

/** seedFromCells identity: source tiles are keyed by their routed channel, never mainIndex (all 0). */
export function tileSeedKey(c) {
	return c.role === 'mvcell' ? `mvcell:${c.srcCh}` : `${c.role}:${c.mainIndex}`
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

	// WO-323 — user-dropped live-source tiles, persisted separately from the pgm/prv layout map
	// (their own store; the wholesale re-default rule must never wipe them).
	const sourceStoreKey = sourceTilesStorageKey(storageKeyPrefix)
	let sourceTiles = loadSourceTiles(storage, sourceStoreKey)

	/** pgm/prv defs from the caller — the role-set the layout store is keyed on. */
	function baseDefs() {
		return Array.isArray(getComposeCellDefs?.()) ? getComposeCellDefs() : []
	}

	/** base defs + the user source tiles as mvcell defs (channel re-healed on every call). */
	function currentDefs() {
		const cm = getCm()
		const srcDefs = sourceTiles.map((st) => ({
			id: st.id,
			role: 'mvcell',
			srcCh: resolveSourceTileChannel(st, cm),
			mainIndex: 0,
			label: st.label || st.value,
			sourceTile: st,
		}))
		return [...baseDefs(), ...srcDefs]
	}

	function persist() {
		const map = {}
		let sourceChanged = false
		for (const [id, t] of tiles) {
			if (t.def.role === 'mvcell' && t.def.sourceTile) {
				if (JSON.stringify(t.def.sourceTile.frac) !== JSON.stringify(t.frac)) {
					t.def.sourceTile.frac = { ...t.frac }
					sourceChanged = true
				}
			} else {
				map[id] = t.frac
			}
		}
		saveTileLayout(storage, storageKey, map)
		if (sourceChanged) saveSourceTiles(storage, sourceStoreKey, sourceTiles)
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
		// WO-319 coordinate basis: the host operator kiosk punches monitor-relative X holes, so it
		// reports rects in VIEWPORT space (defaultViewport = window). A client showing the stream in a
		// windowed compose area displays ch4 filling the TILES MOUNT and must report relative to that
		// same region, so the reported FILL fractions match where the stream draws each route.
		const composeAreaBasis = !isOperatorGuiModeActive()
		const rootRect = composeAreaBasis ? root.getBoundingClientRect() : null
		const cellRects = []
		for (const t of tiles.values()) {
			// bodyEl IS the aspect-locked hole — report the INNER rect, never the outlined/frame box,
			// so the X SHAPE hole and the visible border keep the just-outside relationship (WO-263).
			const b = t.bodyEl.getBoundingClientRect()
			const rect = composeAreaBasis
				? { left: b.left - rootRect.left, top: b.top - rootRect.top, width: b.width, height: b.height }
				: b
			// WO-323: an unresolved source tile (stale route after a map shift) reports nothing —
			// a hole with no routable channel would just show the raw consumer behind it.
			if (t.def.role === 'mvcell' && resolveTileChannel(t.def, getCm()) == null) continue
			const cell = { id: t.def.id, role: t.def.role, mainIndex: t.def.mainIndex, rect }
			if (t.def.role === 'mvcell') cell.srcCh = t.def.srcCh
			cellRects.push(cell)
		}
		onCellRects(cellRects, composeAreaBasis ? { width: rootRect.width, height: rootRect.height } : undefined)
		// Re-hug the freshest canvas position so the next pure MOVE (no resize/scroll) re-reports.
		posWatch.update()
	}

	function scheduleReport() {
		if (rafReport != null) return
		rafReport = requestAnimationFrame(() => { rafReport = null; reportRectsNow() })
	}

	// WO-319 — CLIENT ONLY. Fill each tile body with this window's crop of the ch4 stream. The route
	// sits at its FILL fraction of the mosaic; the body is at that same fraction of the tiles-mount
	// (root), so cropping ch4 at the body's fraction-of-root shows exactly this window's content. On
	// the host this is a no-op (the real X hole reveals the screen consumer). Frame-rate driven.
	const isClient = !isOperatorGuiModeActive()
	function drawLiveCrops() {
		if (!isClient) return
		const on = isOperatorLiveCanvasEnabled() && operatorLiveCanvasHasFrame()
		for (const t of tiles.values()) {
			const cv = t.liveCanvas
			if (!cv) continue
			// The crop SOURCE is this window's FILL fraction of the ch4 raster (its route region in the
			// mosaic), NOT the body's position on screen. Display and content are decoupled: the body can
			// be dragged anywhere, but always shows the same route. Using fraction-of-root here was the
			// bug — root is the compose area, a different aspect/letterbox than ch4, so crops were skewed.
			const fill = t.fill
			if (!on || !fill) { if (cv.style.display !== 'none') cv.style.display = 'none'; continue }
			const b = t.bodyEl.getBoundingClientRect()
			if (b.width < 2 || b.height < 2) { cv.style.display = 'none'; continue }
			const w = Math.round(b.width)
			const h = Math.round(b.height)
			if (cv.width !== w) cv.width = w
			if (cv.height !== h) cv.height = h
			const cx = cv.getContext('2d')
			if (!cx) continue
			const ok = drawOperatorLiveCanvasCrop(cx, fill.x, fill.y, fill.w, fill.h, 0, 0, w, h)
			cv.style.display = ok ? 'block' : 'none'
		}
	}

	// True once this client has a layout it saved itself (a drag/resize persisted to localStorage) —
	// after that its window POSITIONS are the user's, never re-seeded from the shared layout.
	function hasStoredLayout() {
		const stored = loadTileLayout(storage, storageKey)
		return !!stored && Object.keys(stored).length > 0
	}
	// Guards the one-time position seed per session (the initial GET). Broadcasts never flip it.
	let positionsSeeded = false

	// WO-319 — CLIENT ONLY. A shared-layout update carries TWO things, and they are decoupled:
	//   1. The CROP SOURCE — each route's real region in the ch4 mosaic. ALWAYS applied, so a window
	//      keeps showing the right route even after the host rearranges the mosaic.
	//   2. The DISPLAY POSITION — where the framed window sits on THIS client. Seeded from the shared
	//      layout only ONCE, and only when the user has no layout of their own yet; thereafter it is
	//      local and must NOT be stomped by a later broadcast (that stomp — including a transient
	//      tiny-hole report from the host mid-transition — was what "refreshed to tiny by itself").
	// @param {{ positions?: boolean }} [opts] positions:true only for the initial seed.
	function seedFromCells(cells, opts = {}) {
		if (!isClient) return
		// WO-323: source tiles all carry mainIndex 0 — key them by their routed channel instead
		// (tileSeedKey), so two source tiles never collide with each other or with PGM/PRV cells.
		const byKey = new Map((Array.isArray(cells) ? cells : []).map((c) => [tileSeedKey(c), c.rect]).filter(([, r]) => r && r.w > 0 && r.h > 0))
		if (!byKey.size) return
		// (1) Crop source — always.
		for (const t of tiles.values()) {
			const fill = byKey.get(tileSeedKey(t.def))
			if (fill) t.fill = { x: fill.x, y: fill.y, w: fill.w, h: fill.h }
		}
		// (2) Display position — once, first run only.
		if (opts.positions && !positionsSeeded && !hasStoredLayout()) {
			positionsSeeded = true
			const { w: cw, h: ch } = canvasSize()
			const { borderW, footerH } = TILE_CHROME
			let changed = false
			for (const t of tiles.values()) {
				if (drag && drag.t === t) continue
				const fill = byKey.get(tileSeedKey(t.def))
				if (!fill) continue
				const outer = {
					x: (fill.x * cw - borderW) / cw,
					y: (fill.y * ch - borderW) / ch,
					w: (fill.w * cw + borderW * 2) / cw,
					h: (fill.h * ch + borderW * 2 + footerH) / ch,
				}
				t.frac = outer
				t.px = null
				t.pxDesired = null
				changed = true
			}
			if (changed) { layoutAll(); return }
		}
		drawLiveCrops()
	}

	function layoutAll() {
		for (const t of tiles.values()) layoutTileDom(t)
		scheduleReport()
		drawLiveCrops()
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
		// WO-319: on a CLIENT (no screen consumer behind an X hole) the body is filled by a canvas that
		// shows this window's crop of the ch4 stream. On the host this canvas stays empty/hidden — the
		// real X hole reveals the screen consumer. See drawLiveCrops.
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
		labelEl.textContent = tileLabelText(def, getCm())
		labelRowEl.appendChild(labelEl)
		if (def.role === 'pgm') labelRowEl.appendChild(buildPgmTileActions(def.mainIndex))
		// WO-323 source tile: ✕ remove — real chrome in the footer row (hole body is click-dead by
		// design, X SHAPE input∩bounding).
		if (def.role === 'mvcell') {
			const removeBtn = document.createElement('button')
			removeBtn.type = 'button'
			removeBtn.className = 'operator-tile__btn operator-tile__btn--remove'
			removeBtn.textContent = '✕'
			removeBtn.title = `Remove ${def.label} from the compose preview`
			removeBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation()
				removeSourceTile(def.id)
			})
			labelRowEl.appendChild(removeBtn)
		}
		footerEl.appendChild(labelRowEl)

		const resizeEl = document.createElement('div')
		resizeEl.className = 'operator-tile__resize'

		el.append(bodyEl, footerEl, resizeEl)
		root.appendChild(el)

		const t = { def, frac, px: null, pxDesired: null, el, bodyEl, footerEl, labelEl, liveCanvas: liveCanvasEl, timer: null }

		footerEl.addEventListener('pointerdown', (e) => startDrag(e, t, 'move'))
		resizeEl.addEventListener('pointerdown', (e) => startDrag(e, t, 'resize'))

		// Source tiles are live inputs — no clip playback timer (the timer scans look layers by
		// mainIndex, meaningless for an input channel).
		const osc = def.role !== 'mvcell' && typeof getOscClient === 'function' ? getOscClient() : null
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
		t.labelEl.textContent = tileLabelText(t.def, getCm())
	}

	function tileLabelText(def, cm) {
		if (def.role === 'mvcell') {
			const ch = resolveTileChannel(def, cm)
			return ch != null ? `LIVE ch${ch} / ${def.label}` : `LIVE (source unavailable) / ${def.label}`
		}
		return `${def.role.toUpperCase()} ${def.mainIndex + 1} / ${screenLabel(cm, def.mainIndex)}`
	}

	function removeSourceTile(id) {
		const before = sourceTiles.length
		sourceTiles = sourceTiles.filter((st) => st.id !== id)
		if (sourceTiles.length === before) return
		saveSourceTiles(storage, sourceStoreKey, sourceTiles)
		rebuild()
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
		// srcCh is part of the identity: a route-heal (channel-map shift) must rebuild the tile so
		// its reported cell and hole aspect follow the new channel.
		const key = JSON.stringify(defs.map((d) => ({ id: d.id, role: d.role, mainIndex: d.mainIndex, srcCh: d.srcCh ?? null })))
		// Layout store stays keyed on the pgm/prv role set only — source tiles are user content
		// with their own store and must not shift the storage key.
		const base = defs.filter((d) => d.role !== 'mvcell')
		const screenCount = new Set(base.map((d) => d.mainIndex)).size || 1
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
		const resolved = resolveTileLayout(base, stored)
		for (const d of defs) {
			const frac = d.role === 'mvcell'
				? (d.sourceTile?.frac || { x: 0.6, y: 0.6, w: 0.3, h: 0.3 })
				: resolved[d.id]
			tiles.set(d.id, buildTile(d, frac))
		}
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

	// WO-323 — accept Sources-panel Live-tab drags (same payload the multiview editor consumes).
	// The drop must land on real DOM (canvas background / tile chrome) — hole bodies are input-dead
	// on the host kiosk by design (X SHAPE input∩bounding), which is fine: the canvas background
	// between tiles is the natural drop target.
	function addSourceTileFromDrop(item, dropFrac) {
		const cm = getCm()
		const rejection = sourceTileRejection(item.value, cm)
		if (rejection) { showAppToast(rejection, 'warn'); return }
		const id = `src_${String(item.value).replace(/[^a-z0-9]+/gi, '_')}`
		if (sourceTiles.some((st) => st.id === id)) {
			showAppToast(`${item.label} is already on the compose preview.`, 'info')
			return
		}
		// Default size: ~30% of the canvas wide, height from the source aspect + footer chrome.
		const { w: cw, h: ch } = canvasSize()
		const minOuter = minOuterSize()
		let aspect = DEFAULT_TILE_ASPECT
		const m = String(item.resolution || '').match(/(\d+)[×x](\d+)/i)
		if (m && Number(m[2]) > 0) aspect = Number(m[1]) / Number(m[2])
		const w = Math.max(minOuter.width, Math.round(cw * 0.3))
		const h = Math.max(minOuter.height, Math.round((w - TILE_CHROME.borderW * 2) / aspect) + TILE_CHROME.borderW * 2 + TILE_CHROME.footerH)
		const px = clampTileRect({ x: dropFrac.x * cw - w / 2, y: dropFrac.y * ch - h / 2, w, h }, cw, ch, minOuter.width, minOuter.height)
		sourceTiles.push({
			id,
			type: item.type,
			value: item.value,
			label: item.label,
			frac: { x: px.x / cw, y: px.y / ch, w: px.w / cw, h: px.h / ch },
		})
		saveSourceTiles(storage, sourceStoreKey, sourceTiles)
		rebuild()
		showAppToast(`${item.label} added to the compose preview.`, 'success')
	}

	root.addEventListener('dragover', (e) => {
		e.preventDefault()
		root.classList.add('operator-compose-tiles--drophover')
	})
	root.addEventListener('dragleave', () => root.classList.remove('operator-compose-tiles--drophover'))
	root.addEventListener('drop', (e) => {
		e.preventDefault()
		root.classList.remove('operator-compose-tiles--drophover')
		let data = null
		try { data = JSON.parse(e.dataTransfer.getData('application/json')) } catch (_) {
			const v = e.dataTransfer.getData('text/plain')
			if (v) data = { type: 'route', value: v.split('\n')[0], label: v.split('\n')[0] }
		}
		const items = normalizeSourceDropItems(data)
		if (!items.length) return
		const r = root.getBoundingClientRect()
		const dropFrac = {
			x: Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))),
			y: Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height))),
		}
		for (const item of items) addSourceTileFromDrop(item, dropFrac)
	})

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

	// WO-319 client: fill bodies from the stream each frame, seed positions from the shared layout,
	// and re-sync whenever any client edits it. No-ops on the host (isClient false).
	let unsubLiveFrame = null
	let unsubShared = null
	if (isClient) {
		unsubLiveFrame = subscribeOperatorLiveCanvasRepaint(drawLiveCrops)
		// Broadcasts refresh crop sources only — they never move this client's windows.
		unsubShared = subscribeSharedLayout((cells) => seedFromCells(cells))
		void (async () => {
			try {
				const res = await fetch('/api/operator-gui/layout', { cache: 'no-store' })
				// Initial seed MAY place windows on their routes (first run, no local layout yet).
				if (res.ok) { const j = await res.json(); seedFromCells(Array.isArray(j?.cells) ? j.cells : [], { positions: true }) }
			} catch { /* keep local/default until a broadcast arrives */ }
		})()
		// Diagnostic (client only): one call from the laptop console pinpoints where the chain breaks —
		// tiles not mounting (defs/state), FILL not seeded (no shared layout), or no video (decoder).
		try {
			window.__composeTiles = () => ({
				isClient,
				stateReady,
				positionsSeeded,
				hasStoredLayout: hasStoredLayout(),
				tileCount: tiles.size,
				defsCount: currentDefs().length,
				enabled: isOperatorLiveCanvasEnabled(),
				hasFrame: operatorLiveCanvasHasFrame(),
				tiles: [...tiles.values()].map((t) => ({
					id: t.def.id,
					fill: t.fill || null,
					body: (() => { const b = t.bodyEl.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } })(),
					canvasShown: t.liveCanvas ? t.liveCanvas.style.display !== 'none' : false,
				})),
			})
		} catch { /* no window */ }
	}

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
			unsubShared?.()
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
