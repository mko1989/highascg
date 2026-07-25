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
import { watchElementPosition } from '../lib/element-position-watch.js'
import { showAppToast } from '../lib/app-toast.js'
import { isOperatorGuiModeActive, subscribeSharedLayout } from '../lib/operator-gui-mode.js'
import {
	operatorLiveCanvasHasFrame,
	isOperatorLiveCanvasEnabled,
	subscribeOperatorLiveCanvasRepaint,
} from './preview-canvas-live-stream.js'
import { createOperatorComposeTileController } from './operator-compose-tiles-tile-controller.js'
import {
	MIN_BODY,
	TILE_CHROME,
	DEFAULT_TILE_ASPECT,
	minOuterSize,
	tileBodyRectFromOuter,
	tileHoleRectFromOuter,
	snapToGrid,
	clampTileRect,
	computeDefaultTileLayout,
} from './operator-compose-tiles-geometry.js'
import {
	resolveTileAspect,
	hasResolvedChannelState,
	layoutStorageKey,
	resolveTileLayout,
	loadTileLayout,
	saveTileLayout,
	resolveTileChannel,
	sourceTilesStorageKey,
	loadSourceTiles,
	saveSourceTiles,
	normalizeSourceDropItems,
	sourceTileRejection,
	resolveSourceTileChannel,
	tileSeedKey,
} from './operator-compose-tiles-state.js'

export {
	MIN_BODY,
	TILE_CHROME,
	DEFAULT_TILE_ASPECT,
	minOuterSize,
	tileBodyRectFromOuter,
	tileHoleRectFromOuter,
	snapToGrid,
	clampTileRect,
	computeDefaultTileLayout,
}
export {
	resolveTileAspect,
	hasResolvedChannelState,
	layoutStorageKey,
	resolveTileLayout,
	loadTileLayout,
	saveTileLayout,
	resolveTileChannel,
	sourceTilesStorageKey,
	loadSourceTiles,
	saveSourceTiles,
	normalizeSourceDropItems,
	sourceTileRejection,
	resolveSourceTileChannel,
	tileSeedKey,
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

	function removeSourceTile(id) {
		const before = sourceTiles.length
		sourceTiles = sourceTiles.filter((st) => st.id !== id)
		if (sourceTiles.length === before) return
		saveSourceTiles(storage, sourceStoreKey, sourceTiles)
		rebuild()
	}

	// WO-319 — CLIENT ONLY. Fill each tile body with this window's crop of the ch4 stream; no-op on
	// the host (the real X hole reveals the screen consumer). See tile-controller's drawLiveCrops.
	const isClient = !isOperatorGuiModeActive()

	const tileController = createOperatorComposeTileController({
		root, storage, tiles, getOscClient, stateStore, onCellRects, getCm, posWatch,
		getStorageKey: () => storageKey,
		getStateReady: () => stateReady,
		onPersist: persist,
		onRemoveSourceTile: removeSourceTile,
		isClient,
	})
	const {
		buildTile, relabel, layoutAll, onCanvasResize, scheduleReport, seedFromCells, drawLiveCrops,
		hasStoredLayout, canvasSize, resetCanvasSize, cancelScheduledReport, getPositionsSeeded,
	} = tileController

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
		resetCanvasSize()
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
				positionsSeeded: getPositionsSeeded(),
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
			cancelScheduledReport()
			for (const t of tiles.values()) t.timer?.destroy?.()
			tiles.clear()
			// Withdraw only if this canvas ever reported: tearing down while still provisional must
			// not send an empty set either (that DELETEs the server's restored layout).
			if (stateReady && typeof onCellRects === 'function') onCellRects([])
			root.remove()
		},
	}
}
