/**
 * WO-256 — Operator-GUI compose canvas: the compose preview panel body becomes a free-tile
 * canvas, multiviewer-style movable/resizable windows whose BODY rects feed the existing shaped-
 * video pipeline (client/lib/operator-gui-mode.js's 'compose' surface, unchanged wire format —
 * `{ id, role, mainIndex, rect }` per tile, same shape client/components/preview-canvas-panel.js
 * already emitted for the old canvas-pair). Only ever constructed by preview-canvas-panel.js when
 * `isOperatorGuiModeActive()` is true (see its `operatorTilesActive` gate) — this module itself
 * has no gate of its own, callers own that.
 *
 * Each tile = header strip (drag handle + `${ROLE} ${screen} / ${label}`, screen-label.js WO-222)
 * + body (the reported video rect — literally empty, the shaped Caspar window renders ABOVE this
 * page, see client/lib/operator-gui-mode.js's header doc) + footer strip (single running-layer
 * progress bar, `mountPgmTopLayerPlaybackTimer` from playback-timer.js — WO-250's bank-aware
 * `pickTopLayerStateForPlayback`, imported/reused there, never copied here).
 *
 * Chrome (border/header/footer) is laid out by explicit pixel math (`tileBodyRectFromOuter`), not
 * flexbox — the border-box CSS in client/styles/10b-operator-compose-tiles.css already keeps the
 * border off the body by construction, but sizing the body from the same pure function this file
 * unit-tests keeps "what runs" and "what's tested" identical.
 */
import { screenLabel } from '../lib/screen-label.js'
import { mountPgmTopLayerPlaybackTimer } from './playback-timer.js'

/** Body minimum (video rect) — chrome (border/header/footer) is additional, see {@link minOuterSize}. */
export const MIN_BODY = { width: 160, height: 90 }
/** Header/footer/border pixel sizes — kept in lockstep with client/styles/10b-operator-compose-tiles.css. */
export const TILE_CHROME = { headerH: 20, footerH: 24, borderW: 2 }
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
	const { headerH, footerH, borderW } = chrome
	return {
		left: outer.left + borderW,
		top: outer.top + borderW + headerH,
		width: Math.max(0, outer.width - borderW * 2),
		height: Math.max(0, outer.height - borderW * 2 - headerH - footerH),
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
 * Default layout math (T256.5): mirrors "today's arrangement" — one ROW per screen (mainIndex),
 * stacked top-to-bottom in screen order, each row split evenly left-to-right among that screen's
 * cells (PRV left / PGM right, matching the existing compose-pair's default 'lr' PRV-first order).
 * Pure fractions (0-1 of the canvas), independent of actual canvas pixel size.
 * @param {Array<{ id: string, role: 'pgm'|'prv', mainIndex: number }>} defs
 * @returns {Record<string, { x: number, y: number, w: number, h: number }>}
 */
export function computeDefaultTileLayout(defs) {
	/** @type {Map<number, Array<{ id: string, role: string, mainIndex: number }>>} */
	const byMain = new Map()
	const order = []
	for (const d of Array.isArray(defs) ? defs : []) {
		if (!byMain.has(d.mainIndex)) { byMain.set(d.mainIndex, []); order.push(d.mainIndex) }
		byMain.get(d.mainIndex).push(d)
	}
	order.sort((a, b) => a - b)
	const numRows = Math.max(1, order.length)
	const rowH = 1 / numRows
	/** @type {Record<string, { x: number, y: number, w: number, h: number }>} */
	const out = {}
	order.forEach((mainIndex, rowIdx) => {
		const rowCells = byMain.get(mainIndex).slice().sort((a, b) => (a.role === 'prv' ? 0 : 1) - (b.role === 'prv' ? 0 : 1))
		const n = Math.max(1, rowCells.length)
		const cellW = 1 / n
		rowCells.forEach((d, colIdx) => {
			out[d.id] = { x: colIdx * cellW, y: rowIdx * rowH, w: cellW, h: rowH }
		})
	})
	return out
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

	const getCm = () => stateStore?.getState?.()?.channelMap || {}

	/** @type {Map<string, { def: object, frac: { x: number, y: number, w: number, h: number }, el: HTMLElement, bodyEl: HTMLElement, headerEl: HTMLElement, footerEl: HTMLElement, timer: { destroy: () => void, refresh: () => void } | null }>} */
	const tiles = new Map()
	let defsKey = ''
	let storageKey = layoutStorageKey(storageKeyPrefix, 1)
	let rafReport = null
	let drag = null

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
		const outer = { left: t.frac.x * cw, top: t.frac.y * ch, width: t.frac.w * cw, height: t.frac.h * ch }
		t.el.style.left = `${outer.left}px`
		t.el.style.top = `${outer.top}px`
		t.el.style.width = `${outer.width}px`
		t.el.style.height = `${outer.height}px`
		const body = tileBodyRectFromOuter({ left: 0, top: 0, width: outer.width, height: outer.height })
		t.bodyEl.style.left = `${body.left}px`
		t.bodyEl.style.top = `${body.top}px`
		t.bodyEl.style.width = `${body.width}px`
		t.bodyEl.style.height = `${body.height}px`
		t.headerEl.style.height = `${TILE_CHROME.headerH}px`
		t.footerEl.style.height = `${TILE_CHROME.footerH}px`
	}

	function reportRectsNow() {
		if (typeof onCellRects !== 'function') return
		const cellRects = []
		for (const t of tiles.values()) {
			const rect = t.bodyEl.getBoundingClientRect()
			cellRects.push({ id: t.def.id, role: t.def.role, mainIndex: t.def.mainIndex, rect })
		}
		onCellRects(cellRects)
	}

	function scheduleReport() {
		if (rafReport != null) return
		rafReport = requestAnimationFrame(() => { rafReport = null; reportRectsNow() })
	}

	function layoutAll() {
		for (const t of tiles.values()) layoutTileDom(t)
		scheduleReport()
	}

	function buildTile(def, frac) {
		const el = document.createElement('div')
		el.className = 'operator-tile'
		el.dataset.role = def.role
		el.dataset.tileId = def.id

		const headerEl = document.createElement('div')
		headerEl.className = 'operator-tile__header'
		headerEl.textContent = `${def.role.toUpperCase()} ${def.mainIndex + 1} / ${screenLabel(getCm(), def.mainIndex)}`

		const bodyEl = document.createElement('div')
		bodyEl.className = 'operator-tile__body'

		const footerEl = document.createElement('div')
		footerEl.className = 'operator-tile__footer'

		const resizeEl = document.createElement('div')
		resizeEl.className = 'operator-tile__resize'

		el.append(headerEl, bodyEl, footerEl, resizeEl)
		root.appendChild(el)

		const t = { def, frac, el, bodyEl, headerEl, footerEl, timer: null }

		headerEl.addEventListener('pointerdown', (e) => startDrag(e, t, 'move'))
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
		t.headerEl.textContent = `${t.def.role.toUpperCase()} ${t.def.mainIndex + 1} / ${screenLabel(getCm(), t.def.mainIndex)}`
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
		t.frac = { x: clamped.x / cw, y: clamped.y / ch, w: clamped.w / cw, h: clamped.h / ch }
		layoutTileDom(t)
	}

	function onDragEnd() {
		document.removeEventListener('pointermove', onDragMove)
		document.removeEventListener('pointerup', onDragEnd)
		document.removeEventListener('pointercancel', onDragEnd)
		if (drag) drag.t.el.classList.remove('operator-tile--dragging')
		drag = null
		persist()
		// WO-256: rects report only on release — matches the suppression contract (video hidden
		// mid-drag, tile outline is the only feedback; the new body rect reports once settled).
		reportRectsNow()
	}

	function rebuild() {
		const defs = currentDefs()
		const key = JSON.stringify(defs.map((d) => ({ id: d.id, role: d.role, mainIndex: d.mainIndex })))
		const screenCount = new Set(defs.map((d) => d.mainIndex)).size || 1
		storageKey = layoutStorageKey(storageKeyPrefix, screenCount)
		if (key === defsKey) { for (const t of tiles.values()) relabel(t); return }
		defsKey = key
		for (const t of tiles.values()) { t.timer?.destroy?.(); t.el.remove() }
		tiles.clear()
		const stored = loadTileLayout(storage, storageKey)
		const resolved = resolveTileLayout(defs, stored)
		for (const d of defs) tiles.set(d.id, buildTile(d, resolved[d.id]))
		layoutAll()
	}

	function resetLayout() {
		saveTileLayout(storage, storageKey, {})
		const defs = currentDefs()
		const fresh = computeDefaultTileLayout(defs)
		for (const [id, t] of tiles) if (fresh[id]) t.frac = fresh[id]
		persist()
		layoutAll()
	}
	resetBtn.addEventListener('click', (e) => { e.stopPropagation(); resetLayout() })

	const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layoutAll) : null
	ro?.observe(root)
	const onWinResize = () => layoutAll()
	const onWinScroll = () => scheduleReport()
	window.addEventListener('resize', onWinResize)
	window.addEventListener('scroll', onWinScroll, true)
	const unsubCm = stateStore?.on?.('channelMap', () => rebuild())

	rebuild()

	return {
		refreshDefs: rebuild,
		destroy() {
			ro?.disconnect()
			window.removeEventListener('resize', onWinResize)
			window.removeEventListener('scroll', onWinScroll, true)
			unsubCm?.()
			if (rafReport != null) cancelAnimationFrame(rafReport)
			for (const t of tiles.values()) t.timer?.destroy?.()
			tiles.clear()
			if (typeof onCellRects === 'function') onCellRects([])
			root.remove()
		},
	}
}
