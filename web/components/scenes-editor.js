/**
 * Scenes / Looks editor — deck of looks, drill-in per-scene compose with live PRV preview.
 * @see docs/scene-system-plan.md
 */

import { sceneState, defaultTransition as defaultTransitionDef } from '../lib/scene-state.js'
import { getApiBase } from '../lib/api-client.js'
import { initPreviewPanel, drawSceneComposeStack } from './preview-canvas.js'
import {
	drawComposePrvPgmCellEdgeBar,
	drawDualComposeCellPreview,
	drawOutputCanvasBounds,
} from './preview-canvas-draw-base.js'
import { mountLookTransitionControls, isMediaOrFileSource } from './scenes-shared.js'
import { renderSceneDeck } from './scene-list.js'
import { appendSceneLayerStripRows } from './scene-layer-row.js'
import { createScenesPreviewRuntime } from './scenes-preview-runtime.js'
import { createApplyNativeFillForSource, createComposeDragHandlers, renderComposeScene } from './scenes-compose.js'
import { mountPgmTopLayerPlaybackTimer } from './playback-timer.js'
import {
	SCENE_THUMB_MAX_W,
	SCENE_CARD_THUMB_W,
	showScenesToast,
	escapeHtml,
	appendScenesEditorShell,
	bindScenesPreviewSplitDrag,
	createTakeSceneToProgram,
} from './scenes-editor-support.js'

/**
 * @param {HTMLElement} root - #tab-scenes
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{ getOscClient?: () => import('../lib/osc-client.js').OscClient | null }} [opts]
 */
export function initScenesEditor(root, stateStore, opts = {}) {
	const getOscClient = typeof opts.getOscClient === 'function' ? opts.getOscClient : () => null
	function getChannelMap() {
		return stateStore.getState()?.channelMap || {}
	}

	function getScreenCount() {
		return Math.max(1, getChannelMap().screenCount ?? 1)
	}

	function getPreviewChannel() {
		const s = sceneState.activeScreenIndex
		const ch = getChannelMap().previewChannels?.[s]
		return ch != null ? ch : 2
	}

	function getProgramChannel() {
		const s = sceneState.activeScreenIndex
		const ch = getChannelMap().programChannels?.[s]
		return ch != null ? ch : 1
	}

	/** Compose UI / program framing (LED wall aspect). */
	function getResolution() {
		const s = sceneState.activeScreenIndex
		const res = getChannelMap().programResolutions?.[s]
		const fallback = { w: 1920, h: 1080 }
		let rw
		let rh
		if (res && res.w > 0 && res.h > 0) {
			rw = res.w
			rh = res.h
		} else {
			const cv = sceneState.getCanvasForScreen(s)
			if (cv.width > 0 && cv.height > 0) {
				rw = cv.width
				rh = cv.height
			} else {
				return fallback
			}
		}
		const w = Math.min(16384, Math.max(160, Math.round(rw)))
		const h = Math.min(16384, Math.max(90, Math.round(rh)))
		return { w, h }
	}

	/** PRV channel output size — same mode as program per screen; used for native letterbox math on ch 2. */
	function getPreviewOutputResolution() {
		const s = sceneState.activeScreenIndex
		const cm = getChannelMap()
		return cm.previewResolutions?.[s] ?? cm.programResolutions?.[s] ?? { w: 1920, h: 1080 }
	}

	function getCanvas() {
		return sceneState.getCanvasForScreen(sceneState.activeScreenIndex)
	}

	const {
		schedulePreviewPush,
		scheduleFlushPreviewFromInspector,
		sendSceneToPreviewCard,
		clearLastPreviewLayers,
		primePreviewSnapshotFromScene,
	} = createScenesPreviewRuntime({
		sceneState,
		stateStore,
		getPreviewChannel,
		getPreviewOutputResolution,
	})

	function getTimelinePositionMsForTake() {
		const st = stateStore.getState()
		const p = st?.timeline?.playback?.position ?? st?.timeline?.tick?.position
		return typeof p === 'number' && Number.isFinite(p) ? p : 0
	}

	const takeSceneToProgram = createTakeSceneToProgram({
		stateStore,
		getChannelMap,
		getProgramChannel,
		getTimelinePositionMsForTake,
		showToast: showScenesToast,
		primePreviewSnapshotFromScene,
	})

	/** Keep compose DOM (.scenes-layer) in sync when scene state changes without full render(). */
	let composeSyncRaf = null
	function scheduleComposeDomSync() {
		if (!sceneState.editingSceneId) return
		if (composeSyncRaf != null) return
		composeSyncRaf = requestAnimationFrame(() => {
			composeSyncRaf = null
			const id = sceneState.editingSceneId
			if (!id) return
			const scene = sceneState.getScene(id)
			if (!scene) return
			const aspect = mainHost.querySelector('.scenes-compose')
			if (!aspect) return
			for (const el of aspect.querySelectorAll('.scenes-layer')) {
				const idx = parseInt(el.dataset.layerIndex, 10)
				if (Number.isNaN(idx)) continue
				const layer = scene.layers[idx]
				if (!layer) continue
				const f = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
				el.style.left = `${f.x * 100}%`
				el.style.top = `${f.y * 100}%`
				el.style.width = `${f.scaleX * 100}%`
				el.style.height = `${f.scaleY * 100}%`
				el.style.opacity = String(layer.opacity ?? 1)
				el.style.transform = `rotate(${layer.rotation ?? 0}deg)`
				el.style.zIndex = String(10 + (layer.layerNumber || 0))
				el.classList.toggle('scenes-layer--selected', selectedLayerIndex === idx)
			}
		})
	}

	const applyNativeFillForSource = createApplyNativeFillForSource({ sceneState, getCanvas, stateStore })
	const { startDrag, startRotate, startScale, startEdgeResize } = createComposeDragHandlers(
		sceneState,
		schedulePreviewPush,
	)

	root.innerHTML = ''
	const { rundownPlaybackSlot, splitHandle, previewHost, mainHost, splitPx } = appendScenesEditorShell(root)

	let rundownTimerDestroy = null
	function applyRundownPlaybackTimer() {
		if (rundownTimerDestroy) {
			rundownTimerDestroy.destroy()
			rundownTimerDestroy = null
		}
		rundownPlaybackSlot.innerHTML = ''
		const hide = !!sceneState.editingSceneId
		rundownPlaybackSlot.hidden = hide
		if (hide) return
		const oc = getOscClient()
		if (!oc) return
		rundownTimerDestroy = mountPgmTopLayerPlaybackTimer(rundownPlaybackSlot, {
			oscClient: oc,
			getChannel: getProgramChannel,
			getState: () => stateStore.getState(),
		})
	}
	sceneState.on('editingChange', () => applyRundownPlaybackTimer())
	sceneState.on('screenChange', () => rundownTimerDestroy?.refresh())
	applyRundownPlaybackTimer()

	let selectedLayerIndex = null
	const selectedLayerIndexRef = {
		get current() {
			return selectedLayerIndex
		},
		set current(v) {
			selectedLayerIndex = v
		},
	}

	const previewPanel = initPreviewPanel(previewHost, {
		title: 'Compose preview (→ preview channel)',
		storageKeyPrefix: 'casparcg_preview_scenes',
		getOutputResolution: getResolution,
		stateStore,
		streamName: 'prv_1',
		composePrvPgmLayoutToggle: true,
		fillParentHeight: true,
		hideInnerResize: true,
		onCollapsedChange: (isCollapsed) => {
			previewHost.classList.toggle('preview-host--collapsed', !!isCollapsed)
			if (isCollapsed) {
				previewHost.style.flex = '0 0 auto'
			} else {
				previewHost.style.flex = `0 0 ${splitPx.current}px`
			}
		},
		draw(ctx, W, H, isLive, meta = {}) {
			const layout = meta.composePrvPgmLayout === 'tb' ? 'tb' : 'lr'
			const isDual = meta.composePrvPgmLayoutToggle

			/* One canvas per PRV/PGM cell — same letterbox math as before, split across two surfaces. */
			if (isDual && meta.composeCell) {
				const v = meta.composeCellViewport
				const cellW = v?.w > 0 && v?.h > 0 ? v.w : layout === 'lr' ? W / 2 : W
				const cellH = v?.w > 0 && v?.h > 0 ? v.h : layout === 'tb' ? H / 2 : H
				if (isLive) {
					ctx.clearRect(0, 0, cellW, cellH)
					drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell })
					return
				}
				const prvId = sceneState.previewSceneId || sceneState.editingSceneId
				const pgmId = sceneState.liveSceneId
				const prvScene = prvId ? sceneState.getScene(prvId) : null
				const pgmScene = pgmId ? sceneState.getScene(pgmId) : null
				const scene = meta.composeCell === 'prv' ? prvScene : pgmScene
				drawDualComposeCellPreview(ctx, W, H, cellW, cellH, (c) => {
					drawSceneComposeStack(c, W, H, {
						scene: scene || { layers: [] },
						selectedLayerIndex: scene?.id === sceneState.editingSceneId ? selectedLayerIndex : null,
						isLive: false,
						skipBg: true,
						composePrvPgmLayout: layout,
						composeDualStreamPreview: true,
						getThumbUrl: (src) =>
							isMediaOrFileSource(src)
								? `${getApiBase()}/api/thumbnail/${encodeURIComponent(src.value)}?w=${SCENE_THUMB_MAX_W}`
								: null,
						onThumbLoaded: () => previewPanel.scheduleDraw(),
					})
					drawOutputCanvasBounds(c, W, H)
				})
				drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell })
				return
			}

			// Original single-view or Live WebRTC mode
			const id = sceneState.editingSceneId || sceneState.previewSceneId
			const scene = id ? sceneState.getScene(id) : null
			drawSceneComposeStack(ctx, W, H, {
				scene: scene || { layers: [] },
				selectedLayerIndex,
				isLive,
				composePrvPgmLayout: layout,
				composeDualStreamPreview: isDual,
				getThumbUrl: (src) =>
					isMediaOrFileSource(src)
						? `${getApiBase()}/api/thumbnail/${encodeURIComponent(src.value)}?w=${SCENE_THUMB_MAX_W}`
						: null,
				onThumbLoaded: () => previewPanel.scheduleDraw(),
			})
		},
	})

	bindScenesPreviewSplitDrag({ splitHandle, previewHost, previewPanel, splitPx })

	function dispatchLayerSelect(detail) {
		selectedLayerIndex = detail?.layerIndex ?? null
		window.dispatchEvent(new CustomEvent('scene-layer-select', { detail }))
		previewPanel.scheduleDraw()
	}

	function renderCompose(scene) {
		return renderComposeScene(scene, {
			sceneState,
			getResolution,
			selectedLayerIndex,
			dispatchLayerSelect,
			schedulePreviewPush,
			applyNativeFillForSource,
			SCENE_THUMB_MAX_W: SCENE_CARD_THUMB_W,
			startDrag,
			startRotate,
			startScale,
			startEdgeResize,
		})
	}

	let deckThumbRaf = null
	function scheduleDeckThumbsRedraw() {
		if (deckThumbRaf != null) return
		deckThumbRaf = requestAnimationFrame(() => {
			deckThumbRaf = null
			mainHost.querySelectorAll('.scenes-card__thumb-canvas').forEach((c) => paintDeckThumb(c))
		})
	}

	function paintDeckThumb(canvas) {
		const id = canvas.dataset.sceneId
		if (!id) return
		const scene = sceneState.getScene(id)
		if (!scene) return
		const res = getResolution()
		const rw = Math.max(1, res.w)
		const rh = Math.max(1, res.h)
		const cw = SCENE_CARD_THUMB_W
		const ch = Math.round((cw * rh) / rw)
		if (canvas.width !== cw || canvas.height !== ch) {
			canvas.width = cw
			canvas.height = ch
		}
		const ctx = canvas.getContext('2d')
		drawSceneComposeStack(ctx, cw, ch, {
			scene,
			selectedLayerIndex: null,
			getThumbUrl: (src) =>
				isMediaOrFileSource(src)
					? `${getApiBase()}/api/thumbnail/${encodeURIComponent(src.value)}?w=${SCENE_THUMB_MAX_W}`
					: null,
			onThumbLoaded: scheduleDeckThumbsRedraw,
			deckThumbnailMode: true,
		})
	}

	function globalTakeFromPreview() {
		const id = sceneState.previewSceneId
		if (!id) {
			showScenesToast('Send a look to preview first (tap the thumbnail).', 'error')
			return
		}
		takeSceneToProgram(id, false)
	}

	function globalCutFromPreview() {
		const id = sceneState.previewSceneId
		if (!id) {
			showScenesToast('Send a look to preview first (tap the thumbnail).', 'error')
			return
		}
		takeSceneToProgram(id, true)
	}

	function renderDeck() {
		const res = getResolution()
		const outputAspect = res.w / Math.max(1, res.h)
		renderSceneDeck({
			mainHost,
			sceneState,
			getScreenCount,
			outputAspect,
			paintDeckThumb,
			takeSceneToProgram,
			showToast: showScenesToast,
			dispatchLayerSelect,
			previewPanel,
			sendSceneToPreviewCard,
			selectedLayerIndexRef,
			globalTakeFromPreview,
			globalCutFromPreview,
		})
	}

	function renderEdit() {
		const id = sceneState.editingSceneId
		const scene = id ? sceneState.getScene(id) : null
		if (!scene) {
			sceneState.setEditingScene(null)
			return
		}

		mainHost.innerHTML = ''
		const bar = document.createElement('div')
		bar.className = 'scenes-edit-bar'
		bar.innerHTML = `
			<button type="button" class="scenes-btn scenes-btn--icon" id="scenes-back" title="Back to looks" aria-label="Back to looks">←</button>
			<input type="text" class="scenes-edit-name" id="scenes-name" value="${escapeHtml(scene.name)}" placeholder="Look name" />
			<button type="button" class="scenes-btn scenes-btn--take scenes-btn--icon" id="scenes-take-live" title="Take live (LOADBG + transition + PLAY)" aria-label="Take live">▶</button>
			<button type="button" class="scenes-btn scenes-btn--icon" id="scenes-take-cut" title="Hard cut (no transition fades)" aria-label="Hard cut">✂</button>
			<button type="button" class="scenes-btn scenes-btn--primary scenes-btn--icon" id="scenes-add-layer" title="Add layer" aria-label="Add layer">＋</button>
			<span class="scenes-edit-bar__hint">PGM ${getProgramChannel()}</span>
		`
		mainHost.appendChild(bar)

		bar.querySelector('#scenes-take-live').addEventListener('click', () => takeSceneToProgram(scene.id, false))
		bar.querySelector('#scenes-take-cut').addEventListener('click', () => takeSceneToProgram(scene.id, true))

		bar.querySelector('#scenes-back').addEventListener('click', () => {
			sceneState.setEditingScene(null)
			selectedLayerIndex = null
			dispatchLayerSelect(null)
			clearLastPreviewLayers()
		})
		bar.querySelector('#scenes-name').addEventListener('change', (e) => {
			sceneState.setSceneName(scene.id, e.target.value)
		})
		bar.querySelector('#scenes-add-layer').addEventListener('click', () => {
			sceneState.addLayer(scene.id)
		})

		const body = document.createElement('div')
		body.className = 'scenes-edit-body scenes-edit-body--stacked'

		const mainRow = document.createElement('div')
		mainRow.className = 'scenes-edit-main'

		const layerStrip = document.createElement('div')
		layerStrip.className = 'scenes-layer-strip'
		layerStrip.innerHTML =
			'<div class="scenes-layer-strip__title">Layers (bottom → top) — drag ⋮⋮ to change Z-order</div>'

		appendSceneLayerStripRows(layerStrip, {
			scene,
			dispatchLayerSelect,
			render,
			showToast: showScenesToast,
			schedulePreviewPush,
			selectedLayerIndexRef,
			sceneState,
			escapeHtml,
		})

		mainRow.appendChild(layerStrip)
		mainRow.appendChild(renderCompose(scene))
		mountLookTransitionControls(
			body,
			scene.defaultTransition || defaultTransitionDef(),
			(t) => sceneState.setDefaultTransition(scene.id, t),
			'scenes-edit-dt',
			{
				label: 'Look transition (this look)',
				hint: 'Applies when layers enter or change; identical layers skip. Set the deck default for all looks.',
			}
		)
		body.appendChild(mainRow)
		mainHost.appendChild(body)

		previewPanel.scheduleDraw()
		schedulePreviewPush()
	}

	function render() {
		if (sceneState.editingSceneId) renderEdit()
		else renderDeck()
	}

	sceneState.on('softChange', () => {
		previewPanel.scheduleDraw()
		if (!sceneState.editingSceneId) render()
		else {
			schedulePreviewPush()
			scheduleComposeDomSync()
		}
	})
	sceneState.on('previewScene', () => {
		previewPanel.scheduleDraw()
		if (!sceneState.editingSceneId) render()
	})
	sceneState.on('change', () => {
		previewPanel.scheduleDraw()
		render()
	})

	document.addEventListener('scenes-refresh-preview', () => {
		scheduleFlushPreviewFromInspector()
		scheduleComposeDomSync()
	})

	document.addEventListener('click', (e) => {
		if (!document.getElementById('tab-scenes')?.classList.contains('active')) return
		if (e.target.closest('.scenes-layer') || e.target.closest('.scenes-layer-row')) return
		if (e.target.closest('#panel-inspector') || e.target.closest('#panel-sources')) return
		if (sceneState.editingSceneId && e.target.closest('.scenes-main')) {
			/* allow background click to deselect only when hitting compose wrap empty area */
		}
	})

	window.addEventListener('scene-layer-select', (e) => {
		if (e.detail?.layerIndex != null) selectedLayerIndex = e.detail.layerIndex
		else selectedLayerIndex = null
		previewPanel.scheduleDraw()
	})

	sceneState.on('editingChange', () => render())

	sceneState.on('screenChange', () => {
		previewPanel.scheduleDraw()
		if (!sceneState.editingSceneId) render()
	})

	document.addEventListener('scenes-tab-activated', () => {
		previewPanel.scheduleDraw()
		if (sceneState.editingSceneId) schedulePreviewPush()
	})

	render()
}
