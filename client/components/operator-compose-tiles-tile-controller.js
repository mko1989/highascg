/**
 * Tile DOM construction, drag/resize interaction, rect reporting, and the WO-319 client-side live
 * crop sync for operator-compose-tiles.js's initOperatorComposeTiles.
 */
import { screenLabel } from '../lib/screen-label.js'
import { mountPgmTopLayerPlaybackTimer } from './playback-timer.js'
import { api } from '../lib/api-client.js'
import { showAppToast } from '../lib/app-toast.js'
import { isOperatorGuiModeActive } from '../lib/operator-gui-mode.js'
import {
	drawOperatorLiveCanvasCrop,
	operatorLiveCanvasHasFrame,
	isOperatorLiveCanvasEnabled,
} from './preview-canvas-live-stream.js'
import { TILE_CHROME, minOuterSize, tileHoleRectFromOuter, snapToGrid, clampTileRect } from './operator-compose-tiles-geometry.js'
import { resolveTileAspect, resolveTileChannel, loadTileLayout, tileSeedKey } from './operator-compose-tiles-state.js'

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
 * @param {{
 *   root: HTMLElement,
 *   storage: { getItem: (k: string) => string | null } | null,
 *   tiles: Map<string, object>,
 *   getOscClient: (() => any) | null,
 *   stateStore: { getState: () => any },
 *   onCellRects: ((cellRects: Array<object>, viewport?: object) => void) | null,
 *   getCm: () => object,  posWatch: { update: () => void },  getStorageKey: () => string,
 *   getStateReady: () => boolean,  onPersist: () => void,
 *   onRemoveSourceTile: (id: string) => void,
 *   isClient: boolean,
 * }} env
 */
export function createOperatorComposeTileController(env) {
	const {
		root, storage, tiles, getOscClient, stateStore, onCellRects, getCm, posWatch,
		getStorageKey, getStateReady, onPersist, onRemoveSourceTile, isClient,
	} = env

	let rafReport = null
	let drag = null
	let lastCanvasSize = { w: 0, h: 0 }
	// True once this client has a layout it saved itself (a drag/resize persisted to localStorage) —
	// after that its window POSITIONS are the user's, never re-seeded from the shared layout.
	// Guards the one-time position seed per session (the initial GET). Broadcasts never flip it.
	let positionsSeeded = false

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
		if (!getStateReady()) return
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

	function hasStoredLayout() {
		const stored = loadTileLayout(storage, getStorageKey())
		return !!stored && Object.keys(stored).length > 0
	}

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

	/* Owner request 2026-07-26 — HOST: restore the project/persisted compose layout (boot GET or a
	 * 'project_load' broadcast). Same outer-rect math as seedFromCells, but it writes the REAL
	 * hole tiles' fracs and persists them locally so the localStorage copy tracks the project.
	 * layoutAll() re-reports the seeded rects — the report dedupe makes that echo a no-op. */
	function seedHostLayoutFromCells(cells) {
		if (isClient) return
		// Degenerate guard (regression 2026-07-26): transient shrunken reports can end up
		// persisted — seeding from cells below ~3% of the canvas would shrink every tile to
		// "smallest possible". Such cells are noise, never an intentional layout.
		const byKey = new Map(
			(Array.isArray(cells) ? cells : [])
				.map((c) => [tileSeedKey(c), c.rect])
				.filter(([, r]) => r && r.w > 0.03 && r.h > 0.03),
		)
		if (!byKey.size) return
		const { w: cw, h: ch } = canvasSize()
		// A mid-boot canvas (not laid out yet) produces garbage outer rects — skip, the next
		// authoritative broadcast re-seeds once the canvas is real.
		if (!(cw > 200 && ch > 120)) return
		const { borderW, footerH } = TILE_CHROME
		let changed = false
		for (const t of tiles.values()) {
			if (drag && drag.t === t) continue
			const fill = byKey.get(tileSeedKey(t.def))
			if (!fill) continue
			t.frac = {
				x: (fill.x * cw - borderW) / cw,
				y: (fill.y * ch - borderW) / ch,
				w: (fill.w * cw + borderW * 2) / cw,
				h: (fill.h * ch + borderW * 2 + footerH) / ch,
			}
			t.px = null
			t.pxDesired = null
			changed = true
		}
		if (changed) {
			onPersist?.()
			layoutAll()
		}
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
		// WO-346: PRT button per tile — capture this tile's channel via AMCP PRINT
		const prtBtn = document.createElement('button')
		prtBtn.type = 'button'
		prtBtn.className = 'operator-tile__prt-btn'
		prtBtn.textContent = 'PRT'
		prtBtn.title = 'Capture this channel (Caspar PRINT)'
		prtBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
		prtBtn.addEventListener('click', async (e) => {
			e.stopPropagation()
			const ch = resolveTileChannel(def, getCm())
			if (ch == null) return
			if (prtBtn.disabled) return
			prtBtn.disabled = true
			try {
				await api.post('/api/amcp/print', { channel: ch })
				showAppToast(`Channel ${ch} captured (PNG in Caspar media folder)`, 'success')
			} catch (err) {
				showAppToast(`Capture failed: ${err?.message || err}`, 'error')
			} finally {
				prtBtn.disabled = false
			}
		})
		labelRowEl.appendChild(prtBtn)
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
				onRemoveSourceTile(def.id)
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
		onPersist()
		// Final settle report (the live drag reports were throttled/rAF; guarantee the last rect).
		reportRectsNow()
	}

	function resetCanvasSize() {
		lastCanvasSize = { w: 0, h: 0 }
	}

	function cancelScheduledReport() {
		if (rafReport != null) cancelAnimationFrame(rafReport)
		rafReport = null
	}

	return {
		buildTile,
		relabel,
		layoutAll,
		onCanvasResize,
		scheduleReport,
		seedFromCells,
		seedHostLayoutFromCells,
		drawLiveCrops,
		hasStoredLayout,
		canvasSize,
		resetCanvasSize,
		cancelScheduledReport,
		getPositionsSeeded: () => positionsSeeded,
	}
}
