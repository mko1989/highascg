/**
 * Scenes / Looks editor — deck of looks, drill-in per-scene compose with live PRV preview.
 * @see docs/scene-system-plan.md
 */

import { sceneState, defaultTransition as defaultTransitionDef } from '../lib/scene-state.js'
import { api, getApiBase } from '../lib/api-client.js'
import { initPreviewPanel, drawSceneComposeStack } from './preview-canvas.js'
import { mountLookTransitionControls, buildIncomingScenePayload, isMediaOrFileSource } from './scenes-shared.js'
import { renderSceneDeck } from './scene-list.js'
import { appendSceneLayerStripRows } from './scene-layer-row.js'
import { createScenesPreviewRuntime } from './scenes-preview-runtime.js'
import { createApplyNativeFillForSource, createComposeDragHandlers, renderComposeScene } from './scenes-compose.js'
import { mountPgmTopLayerPlaybackTimer } from './playback-timer.js'
import { UI_FONT_FAMILY } from '../lib/ui-font.js'

/** Thumbnail width for API (local ffmpeg or Caspar fallback) */
const SCENE_THUMB_MAX_W = 720

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
		if (!res || res.w <= 0 || res.h <= 0) return fallback
		const w = Math.min(16384, Math.max(160, Math.round(res.w)))
		const h = Math.min(16384, Math.max(90, Math.round(res.h)))
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

	function showToast(msg, type = 'info') {
		let container = document.getElementById('scenes-toast-container')
		if (!container) {
			container = document.createElement('div')
			container.id = 'scenes-toast-container'
			container.style.cssText =
				'position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;'
			document.body.appendChild(container)
		}
		const toast = document.createElement('div')
		toast.style.cssText = `padding:10px 16px;border-radius:6px;font-size:13px;font-family:${UI_FONT_FAMILY};max-width:360px;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,.4);background:${
			type === 'error' ? '#b91c1c' : '#1d4ed8'
		};color:#fff;`
		toast.textContent = msg
		container.appendChild(toast)
		setTimeout(() => toast.remove(), 6000)
	}

	const {
		pushSceneToPreview,
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

	let takeBusy = false
	async function takeSceneToProgram(sceneId, forceCut) {
		if (takeBusy) return
		const scene = sceneState.getScene(sceneId)
		if (!scene) return
		const hasContent = (scene.layers || []).some((l) => l?.source?.value)
		if (!hasContent) {
			showToast('Add at least one layer with a source before taking live.', 'error')
			return
		}
		takeBusy = true
		try {
			const programCh = getProgramChannel()
			const fps = getChannelMap().programResolutions?.[sceneState.activeScreenIndex]?.fps ?? 50
			const incomingJson = buildIncomingScenePayload(scene)
			await pushSceneToPreview(sceneId)
			const takeRes = await api.post('/api/scene/take', {
				channel: programCh,
				incomingScene: incomingJson,
				framerate: fps,
				forceCut,
				useServerLive: true,
			})
			sceneState.setLiveSceneId(sceneId)
			const prevLive = stateStore.getState()?.scene?.live || {}
			if (takeRes?.sceneLive && typeof takeRes.sceneLive === 'object') {
				const merged = { ...prevLive }
				for (const [k, v] of Object.entries(takeRes.sceneLive)) {
					if (v && typeof v === 'object' && v.sceneId != null && v.scene) {
						merged[k] = { sceneId: v.sceneId, scene: v.scene }
					}
				}
				stateStore.applyChange('scene.live', merged)
			} else {
				stateStore.applyChange('scene.live', {
					...prevLive,
					[String(programCh)]: { sceneId: scene.id, scene: incomingJson },
				})
			}
			const liveSnap = takeRes?.sceneLive?.[String(programCh)]
			if (liveSnap?.scene && liveSnap.sceneId === scene.id) {
				sceneState.applySceneFromTakePayload(sceneId, liveSnap.scene)
			} else {
				sceneState.applySceneFromTakePayload(sceneId, incomingJson)
			}
			primePreviewSnapshotFromScene(sceneId)
		} catch (e) {
			showToast(e?.message || String(e), 'error')
		} finally {
			takeBusy = false
		}
	}

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
	const rundownPlaybackSlot = document.createElement('div')
	rundownPlaybackSlot.id = 'scenes-rundown-playback-slot'
	rundownPlaybackSlot.className = 'scenes-rundown-playback'
	const scenesSplit = document.createElement('div')
	scenesSplit.className = 'scenes-split'
	const splitHandle = document.createElement('div')
	splitHandle.className = 'resize-handle scenes-split__handle'
	splitHandle.title = 'Drag to resize compose preview'
	const previewHost = document.createElement('div')
	previewHost.className = 'preview-host scenes-preview-host'
	const mainHost = document.createElement('div')
	mainHost.className = 'scenes-main dashboard-main scenes-split__main'

	const SPLIT_LS = 'casparcg_scenes_preview_split_px'
	let splitPx = 280
	try {
		const n = parseInt(localStorage.getItem(SPLIT_LS) || '', 10)
		if (!Number.isNaN(n) && n >= 140 && n <= 2000) splitPx = n
	} catch {}
	previewHost.style.flex = `0 0 ${splitPx}px`
	previewHost.style.minHeight = '0'

	root.appendChild(rundownPlaybackSlot)
	root.appendChild(scenesSplit)
	scenesSplit.appendChild(previewHost)
	scenesSplit.appendChild(splitHandle)
	scenesSplit.appendChild(mainHost)

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
			if (isCollapsed) {
				previewHost.style.flex = '0 0 auto'
			} else {
				previewHost.style.flex = `0 0 ${splitPx}px`
			}
		},
		draw(ctx, W, H, isLive, meta = {}) {
			const id = sceneState.editingSceneId || sceneState.previewSceneId
			const scene = id ? sceneState.getScene(id) : null
			drawSceneComposeStack(ctx, W, H, {
				scene: scene || { layers: [] },
				selectedLayerIndex,
				isLive,
				composePrvPgmLayout: meta.composePrvPgmLayout === 'tb' ? 'tb' : 'lr',
				composeDualStreamPreview: meta.composeDualStreamPreview === true,
				getThumbUrl: (src) =>
					isMediaOrFileSource(src)
						? `${getApiBase()}/api/thumbnail/${encodeURIComponent(src.value)}?w=${SCENE_THUMB_MAX_W}`
						: null,
				onThumbLoaded: () => previewPanel.scheduleDraw(),
			})
		},
	})

	splitHandle.addEventListener('mousedown', (e) => {
		if (e.button !== 0) return
		e.preventDefault()
		const splitDragStartY = e.clientY
		const splitStartH = previewHost.getBoundingClientRect().height
		const onMove = (ev) => {
			const dy = ev.clientY - splitDragStartY
			const maxH = Math.min(2000, Math.floor(window.innerHeight * 0.9))
			const nh = Math.max(140, Math.min(maxH, splitStartH + dy))
			previewHost.style.flex = `0 0 ${nh}px`
			previewPanel.scheduleDraw()
		}
		const onUp = () => {
			document.removeEventListener('mousemove', onMove)
			document.removeEventListener('mouseup', onUp)
			document.body.style.cursor = ''
			document.body.style.userSelect = ''
			splitPx = Math.round(previewHost.getBoundingClientRect().height)
			try {
				localStorage.setItem(SPLIT_LS, String(splitPx))
			} catch {}
		}
		document.body.style.cursor = 'row-resize'
		document.body.style.userSelect = 'none'
		document.addEventListener('mousemove', onMove)
		document.addEventListener('mouseup', onUp)
	})

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
			SCENE_THUMB_MAX_W,
			startDrag,
			startRotate,
			startScale,
			startEdgeResize,
		})
	}

	function thumbnailUrlForScene(sc) {
		for (const layer of sc.layers || []) {
			if (isMediaOrFileSource(layer?.source)) {
				return `${getApiBase()}/api/thumbnail/${encodeURIComponent(layer.source.value)}?w=${SCENE_THUMB_MAX_W}`
			}
		}
		return null
	}

	function globalTakeFromPreview() {
		const id = sceneState.previewSceneId
		if (!id) {
			showToast('Send a look to preview first (tap the thumbnail).', 'error')
			return
		}
		takeSceneToProgram(id, false)
	}

	function globalCutFromPreview() {
		const id = sceneState.previewSceneId
		if (!id) {
			showToast('Send a look to preview first (tap the thumbnail).', 'error')
			return
		}
		takeSceneToProgram(id, true)
	}

	function renderDeck() {
		renderSceneDeck({
			mainHost,
			sceneState,
			getScreenCount,
			getProgramChannel,
			getPreviewChannel,
			thumbnailUrlForScene,
			takeSceneToProgram,
			showToast,
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
			<button type="button" class="scenes-btn scenes-btn--take scenes-btn--icon" id="scenes-take-live" title="Take live" aria-label="Take live">▶</button>
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
			showToast,
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

	function escapeHtml(s) {
		const div = document.createElement('div')
		div.textContent = s
		return div.innerHTML
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

	document.addEventListener('scenes-tab-activated', () => {
		previewPanel.scheduleDraw()
		if (sceneState.editingSceneId) schedulePreviewPush()
	})

	render()
}
