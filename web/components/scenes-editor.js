/**
 * Scenes / Looks editor — deck of looks, drill-in per-scene compose with live PRV preview.
 */
import { sceneState } from '../lib/scene-state.js'
import { api } from '../lib/api-client.js'
import { getLiveThumbnailUrl, getThumbnailUrl } from '../lib/thumbnail-url.js'
import { initPreviewPanel, drawSceneComposeStack } from './preview-canvas.js'
import { drawComposePrvPgmCellEdgeBar, drawDualComposeCellPreview, drawOutputCanvasBounds } from './preview-canvas-draw-base.js'
import { isMediaOrFileSource } from './scenes-shared.js'
import { renderSceneDeck } from './scene-list.js'
import { createScenesPreviewRuntime } from './scenes-preview-runtime.js'
import { createApplyNativeFillForSource, createComposeDragHandlers, renderComposeScene } from './scenes-compose.js'
import { mountPgmTopLayerPlaybackTimer } from './playback-timer.js'
import { SCENE_THUMB_MAX_W, SCENE_CARD_THUMB_W, showScenesToast, appendScenesEditorShell, bindScenesPreviewSplitDrag, createTakeSceneToProgram } from './scenes-editor-support.js'
import { LOOK_PRESET_RECALL_PGM, LOOK_PRESET_RECALL_PRV } from '../lib/look-preset-events.js'

import * as Logic from './scenes-editor-logic.js'
import { renderEdit } from './scenes-editor-edit.js'

export function initScenesEditor(root, stateStore, opts = {}) {
	const getOscClient = opts.getOscClient || (() => null)
	const getChannelMap = () => stateStore.getState()?.channelMap || {}
	const getScreenCount = () => Math.max(1, getChannelMap().screenCount ?? 1)
	const getProgramChannel = () => getChannelMap().programChannels?.[sceneState.activeScreenIndex] ?? 1
	const getPlaybackChannel = () => getChannelMap().playbackChannels?.[sceneState.activeScreenIndex] ?? getProgramChannel()
	const getPreviewChannel = () => getChannelMap().previewChannels?.[sceneState.activeScreenIndex] ?? null
	const getThumbForSource = (source, channelForLive) => {
		if (!source || !source.value) return null
		if (isMediaOrFileSource(source)) return getThumbnailUrl(source.value, SCENE_THUMB_MAX_W, 0)
		return getLiveThumbnailUrl(channelForLive)
	}
	const getComposeStreamNames = () => {
		const pgmCh = getPlaybackChannel()
		const prvCh = getPreviewChannel()
		return {
			pgm: `pgm_${Math.max(1, pgmCh)}`,
			// No PRV for pgm_only destinations -> use same bus so compose panel never appears "dead".
			prv: `prv_${Math.max(1, prvCh || pgmCh)}`,
		}
	}
	const getResolution = () => Logic.getResolutionForScreen(sceneState.activeScreenIndex, sceneState, stateStore)
	const getPreviewOutputResolution = () => { const cm = getChannelMap(); return cm.previewResolutions?.[sceneState.activeScreenIndex] ?? cm.programResolutions?.[sceneState.activeScreenIndex] ?? { w: 1920, h: 1080 } }

	const previewRuntime = createScenesPreviewRuntime({
		sceneState, stateStore, getPreviewOutputResolution, getChannelMap,
		getPreviewChannel,
	})

	async function captureOnDemandForDroppedSource(data) {
		if (!data || !data.type) return
		const cm = getChannelMap() || {}
		const mainIdx = sceneState.activeScreenIndex
		const previewCh = Number(cm.previewChannels?.[mainIdx] ?? getPreviewChannel() ?? 0)
		const programCh = Number(cm.programChannels?.[mainIdx] ?? getProgramChannel() ?? 0)
		if (String(data.type) === 'timeline' && data.value) {
			const timelineId = encodeURIComponent(String(data.value))
			// One-shot PRV thumb at 5s marker for timeline cards.
			await api.post(`/api/timelines/${timelineId}/sendto`, { preview: true, program: false, screenIdx: mainIdx }).catch(() => {})
			await api.post(`/api/timelines/${timelineId}/seek`, { ms: 5000 }).catch(() => {})
			await api.post(`/api/timelines/${timelineId}/play`, { from: 5000 }).catch(() => {})
			await new Promise((r) => setTimeout(r, 160))
			if (previewCh > 0) await api.post('/api/thumbnail/live/capture', { channel: previewCh }).catch(() => {})
			await api.post(`/api/timelines/${timelineId}/pause`).catch(() => {})
			previewPanel.scheduleDraw()
			return
		}
		if (String(data.type) === 'route') {
			const ch = previewCh > 0 ? previewCh : programCh
			if (ch > 0) await api.post('/api/thumbnail/live/capture', { channel: ch }).catch(() => {})
			previewPanel.scheduleDraw()
		}
	}

	const takeSceneToProgram = createTakeSceneToProgram({
		stateStore, getChannelMap, getProgramChannel, showToast: showScenesToast,
		getTimelinePositionMsForTake: () => { const st = stateStore.getState(); return st?.timeline?.playback?.position ?? st?.timeline?.tick?.position ?? 0 },
		primePreviewSnapshotFromScene: previewRuntime.primePreviewSnapshotFromScene,
	})

	let selectedLayerIndex = null
	const selectedLayerIndexRef = { get current() { return selectedLayerIndex }, set current(v) { selectedLayerIndex = v } }
	const dispatchLayerSelect = detail => { selectedLayerIndex = detail?.layerIndex ?? null; window.dispatchEvent(new CustomEvent('scene-layer-select', { detail })); previewPanel.scheduleDraw(); scheduleRender() }

	const applyNativeFillForSource = createApplyNativeFillForSource({ sceneState, getCanvas: () => sceneState.getCanvasForScreen(sceneState.activeScreenIndex), stateStore })
	const { startDrag, startRotate, startScale, startEdgeResize } = createComposeDragHandlers(sceneState, previewRuntime.schedulePreviewPush)

	root.innerHTML = ''
	const { rundownPlaybackSlot, splitHandle, previewHost, mainHost, tabsHost, splitPx } = appendScenesEditorShell(root)

	let rundownTimerDestroy = null
	const applyRundownTimer = () => {
		if (rundownTimerDestroy) rundownTimerDestroy.destroy()
		rundownPlaybackSlot.innerHTML = ''; const hide = !!sceneState.editingSceneId; rundownPlaybackSlot.hidden = hide
		if (!hide && getOscClient()) rundownTimerDestroy = mountPgmTopLayerPlaybackTimer(rundownPlaybackSlot, { oscClient: getOscClient(), getChannel: getPlaybackChannel, getState: () => stateStore.getState() })
	}
	sceneState.on('editingChange', applyRundownTimer); sceneState.on('screenChange', () => rundownTimerDestroy?.refresh()); applyRundownTimer()

	const previewPanel = initPreviewPanel(previewHost, {
		title: 'Compose preview', storageKeyPrefix: 'casparcg_preview_scenes', getOutputResolution: getResolution, stateStore, streamName: 'prv_1', composePrvPgmLayoutToggle: true, fillParentHeight: true, hideInnerResize: true, getProgramChannel,
		getDualStreamNames: getComposeStreamNames,
		showDestinationVisualOverlay: false,
		onCollapsedChange: c => { previewHost.classList.toggle('preview-host--collapsed', !!c); previewHost.style.flex = c ? '0 0 auto' : `0 0 ${splitPx.current}px` },
		draw: (ctx, W, H, isLive, meta = {}) => {
			const layout = meta.composePrvPgmLayout === 'tb' ? 'tb' : 'lr'; const isDual = meta.composePrvPgmLayoutToggle
			if (isDual && meta.composeCell) {
				const v = meta.composeCellViewport; const cellW = v?.w || (layout === 'lr' ? W / 2 : W); const cellH = v?.h || (layout === 'tb' ? H / 2 : H)
				if (isLive) { ctx.clearRect(0, 0, cellW, cellH); drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell }); return }
				const mainIdx = Number.isFinite(Number(meta.composeScreenIdx)) ? Number(meta.composeScreenIdx) : sceneState.activeScreenIndex
				const editingScene = sceneState.editingSceneId ? sceneState.getScene(sceneState.editingSceneId) : null
				const canUseEditingForMain = !!(editingScene && sceneState.sceneMatchesMain(editingScene, mainIdx))
				const fallbackEditingId = canUseEditingForMain ? sceneState.editingSceneId : null
				const id = meta.composeCell === 'prv'
					? (sceneState.getPreviewSceneIdForMain(mainIdx) || fallbackEditingId)
					: (sceneState.getLiveSceneIdForMain(mainIdx) || sceneState.getPreviewSceneIdForMain(mainIdx) || fallbackEditingId)
				const scene = meta.composeCell === 'pgm' ? (sceneState.getLiveSceneSnapshot(mainIdx) || (id ? sceneState.getScene(id) : null)) : (id ? sceneState.getScene(id) : null)
				drawDualComposeCellPreview(ctx, W, H, cellW, cellH, c => {
					const r = Logic.getResolutionForScreen(mainIdx, sceneState, stateStore)
					drawOutputCanvasBounds(c, r.w, r.h); drawSceneComposeStack(c, r.w, r.h, { scene: scene || { layers: [] }, selectedLayerIndex: scene?.id === sceneState.editingSceneId ? selectedLayerIndex : null, isLive: false, skipBg: true, composePrvPgmLayout: layout, composeDualStreamPreview: true, getThumbUrl: s => getThumbForSource(s, meta.composeCell === 'prv' ? (getPreviewChannel() || getPlaybackChannel()) : getPlaybackChannel()), onThumbLoaded: () => previewPanel.scheduleDraw() })
				}); drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell }); return
			}
			const id = sceneState.editingSceneId || sceneState.previewSceneId; const scene = id ? sceneState.getScene(id) : null
			drawSceneComposeStack(ctx, W, H, { scene: scene || { layers: [] }, selectedLayerIndex, isLive, composePrvPgmLayout: layout, composeDualStreamPreview: isDual, getThumbUrl: s => getThumbForSource(s, getPreviewChannel() || getPlaybackChannel()), onThumbLoaded: () => previewPanel.scheduleDraw() })
		}
	})
	bindScenesPreviewSplitDrag({ splitHandle, previewHost, previewPanel, splitPx })

	const render = () => {
		const preserveDeckScroll = !sceneState.editingSceneId
		const prevScrollTop = preserveDeckScroll ? mainHost.scrollTop : 0
		const prevScrollLeft = preserveDeckScroll ? mainHost.scrollLeft : 0
		tabsHost.innerHTML = ''
		if (sceneState.editingSceneId) renderEdit({ mainHost, sceneState, stateStore, takeSceneToProgram, getProgramChannel, getScreenCount, getChannelMap, clearLastPreviewLayers: previewRuntime.clearLastPreviewLayers, dispatchLayerSelect, schedulePreviewPush: previewRuntime.schedulePreviewPush, applyNativeFillForSource, renderCompose: s => renderComposeScene(s, { sceneState, getResolution, selectedLayerIndex, dispatchLayerSelect, schedulePreviewPush: previewRuntime.schedulePreviewPush, applyNativeFillForSource, SCENE_THUMB_MAX_W: SCENE_THUMB_MAX_W, startDrag, startRotate, startScale, startEdgeResize, onSourceDropped: captureOnDemandForDroppedSource }), selectedLayerIndexRef, showScenesToast })
		else renderSceneDeck({ mainHost, sceneState, getScreenCount, getChannelMap, outputAspect: getResolution().w / getResolution().h, paintDeckThumb: c => {
			const id = c.dataset.sceneId; const scene = id ? sceneState.getScene(id) : null; if (!scene) return
			const res = c.dataset.deckMain ? Logic.getResolutionForScreen(parseInt(c.dataset.deckMain, 10), sceneState, stateStore) : getResolution()
			const cw = SCENE_CARD_THUMB_W; const ch = Math.round((cw * res.h) / res.w)
			if (c.width !== cw) { c.width = cw; c.height = ch }
			drawSceneComposeStack(c.getContext('2d'), cw, ch, {
				scene,
				selectedLayerIndex: null,
				getThumbUrl: s => {
					const main = Number.isFinite(Number(c.dataset.deckMain)) ? parseInt(c.dataset.deckMain, 10) : sceneState.activeScreenIndex
					const ch = getChannelMap().programChannels?.[main] ?? getProgramChannel()
					return getThumbForSource(s, ch)
				},
				onThumbLoaded: () => {
					previewPanel.scheduleDraw()
					if (!c.isConnected) return
					requestAnimationFrame(() => {
						if (!c.isConnected) return
						const sid = c.dataset.sceneId
						const scn = sid ? sceneState.getScene(sid) : null
						if (!scn) return
						drawSceneComposeStack(c.getContext('2d'), cw, ch, {
							scene: scn,
							selectedLayerIndex: null,
							getThumbUrl: s => {
								const main = Number.isFinite(Number(c.dataset.deckMain)) ? parseInt(c.dataset.deckMain, 10) : sceneState.activeScreenIndex
								const ch = getChannelMap().programChannels?.[main] ?? getProgramChannel()
								return getThumbForSource(s, ch)
							},
							onThumbLoaded: () => previewPanel.scheduleDraw(),
							deckThumbnailMode: true,
						})
					})
				},
				deckThumbnailMode: true,
			})
		}, takeSceneToProgram, showToast: showScenesToast, dispatchLayerSelect, previewPanel, sendSceneToPreviewCard: previewRuntime.sendSceneToPreviewCard, selectedLayerIndexRef, globalTakeFromPreview: () => { if (sceneState.previewSceneId) takeSceneToProgram(sceneState.previewSceneId, false) }, globalCutFromPreview: () => { if (sceneState.previewSceneId) takeSceneToProgram(sceneState.previewSceneId, true) } })
		if (preserveDeckScroll) {
			mainHost.scrollTop = prevScrollTop
			mainHost.scrollLeft = prevScrollLeft
		}
	}

	let renderRaf = null
	const scheduleRender = () => {
		if (renderRaf) return
		renderRaf = requestAnimationFrame(() => {
			renderRaf = null
			render()
		})
	}

	stateStore.on('*', path => { if (['channelMap', '*'].includes(path)) scheduleRender() })
	sceneState.on('softChange', () => {
		previewPanel.scheduleDraw()
		if (!sceneState.editingSceneId) {
			scheduleRender()
			return
		}
		previewRuntime.schedulePreviewPush()
		// Keep the compose thumbnail/edit surface in sync while dragging/resizing layers.
		// BUT: Avoid full re-renders (DOM clearing) while the user is actively dragging.
		if (sceneState.isInteracting) {
			const id = sceneState.editingSceneId; const scene = id ? sceneState.getScene(id) : null
			if (scene) {
				// Fast-path: Update existing DOM styles without rebuilding.
				const layers = mainHost.querySelectorAll('.scenes-layer')
				layers.forEach(el => {
					const idx = parseInt(el.dataset.layerIndex, 10)
					const layer = scene.layers[idx]
					if (layer) {
						const f = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
						el.style.left = `${f.x * 100}%`
						el.style.top = `${f.y * 100}%`
						el.style.width = `${f.scaleX * 100}%`
						el.style.height = `${f.scaleY * 100}%`
						el.style.opacity = String(layer.opacity ?? 1)
						el.style.transform = `rotate(${layer.rotation ?? 0}deg)`
					}
				})
			}
		} else {
			scheduleRender()
		}
	})
	sceneState.on('previewScene', () => { previewPanel.scheduleDraw(); if (!sceneState.editingSceneId) scheduleRender() })
	sceneState.on('change', () => { 
		previewPanel.scheduleDraw()
		scheduleRender() 
	})
	sceneState.on('editingChange', scheduleRender); sceneState.on('screenChange', () => { previewPanel.scheduleDraw(); scheduleRender() })
	document.addEventListener('scenes-refresh-preview', () => { previewRuntime.scheduleFlushPreviewFromInspector(); previewPanel.scheduleDraw() })
	document.addEventListener('scenes-tab-activated', () => { previewPanel.scheduleDraw(); if (sceneState.editingSceneId) previewRuntime.schedulePreviewPush() })
	document.addEventListener(LOOK_PRESET_RECALL_PRV, e => { if (e.detail?.sceneId) Logic.runLookRecall(e.detail.sceneId, e.detail.lookPreset, 'prv', { ...previewRuntime, takeSceneToProgram, showScenesToast }) })
	document.addEventListener(LOOK_PRESET_RECALL_PGM, e => { if (e.detail?.sceneId) Logic.runLookRecall(e.detail.sceneId, e.detail.lookPreset, 'pgm', { ...previewRuntime, takeSceneToProgram, showScenesToast }) })
	scheduleRender()
}
