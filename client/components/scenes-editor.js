/**
 * Scenes / Looks editor — deck of looks, drill-in per-scene compose with live PRV preview.
 */
import { settingsState } from '../lib/settings-state.js'
import { sceneState } from '../lib/scene-state.js'
import { api, getApiBase } from '../lib/api-client.js'
import { resolveSourceThumbnailUrl } from '../lib/thumbnail-url.js'
import { clearTemplateThumbCache } from '../lib/template-thumb.js'
import { initPreviewPanel, drawSceneComposeStack } from './preview-canvas.js'
import { drawComposePrvPgmCellEdgeBar, drawDualComposeCellPreview, drawOutputCanvasBounds } from './preview-canvas-draw-base.js'
import {
	drawComposeSnapshotCell,
	isSnapshotComposePreview,
	resolveComposeChannelForCell,
	subscribeComposePreviewRefresh,
	syncComposePreviewFromChannelMap,
} from './preview-canvas-compose-snapshot.js'
import { resolveComposeChannelForEditingScene, resolveComposePreviewMode } from '../lib/compose-preview-url.js'
import { dataTransferOffersDeckMedia } from './scenes-shared.js'
import { renderSceneDeck } from './scene-list.js'
import { createScenesPreviewRuntime } from './scenes-preview-runtime.js'
import { createApplyNativeFillForSource, createComposeDragHandlers, renderComposeScene } from './scenes-compose.js'
import { mountPgmTopLayerPlaybackTimer } from './playback-timer.js'
import { SCENE_THUMB_MAX_W, showScenesToast, appendScenesEditorShell, bindScenesPreviewSplitDrag, createTakeSceneToProgram } from './scenes-editor-support.js'
import { LOOK_PRESET_RECALL_PGM, LOOK_PRESET_RECALL_PRV } from '../lib/look-preset-events.js'
import * as Logic from './scenes-editor-logic.js'
import { renderEdit } from './scenes-editor-edit.js'
import { attachScenesEditorKeyboard } from './scenes-editor-keyboard.js'
import { resolveLookStackChannelForBus, resolveMainIndexForScene } from '../lib/look-stack-amcp-channel.js'
import { isPreviewBusAvailable } from '../lib/scenes-preview-look-stack.js'
import { reportComposeCellRects } from '../lib/operator-gui-mode.js'
import { refreshSceneLiveFromServer, syncPreviewLiveToServer } from '../lib/scene-live-sync.js'
import { commitPendingLookNameEdits } from '../lib/scene-look-name-commit.js'
import { createBuildLayerRouteDescriptor } from './scenes-editor-layer-route.js'
import { createDeckMediaDropHandler } from './scenes-editor-deck-drop.js'
import { createDeckThumbPainter } from './scenes-editor-deck-thumb.js'
import { createPreviewActions } from './scenes-editor-preview-actions.js'
import { ingestDeckDroppedFiles } from './scenes-editor-deck-ingest.js'

export function initScenesEditor(root, stateStore, opts = {}) {
	const getOscClient = opts.getOscClient || (() => null)
	const getChannelMap = () => stateStore.getState()?.channelMap || {}
	const getScreenCount = () => Math.max(1, getChannelMap().screenCount ?? 1)
	const getProgramChannel = () => getChannelMap().programChannels?.[sceneState.activeScreenIndex] ?? 1
	const getPlaybackChannel = () => getChannelMap().playbackChannels?.[sceneState.activeScreenIndex] ?? getProgramChannel()
	const getPreviewChannel = () => getChannelMap().previewChannels?.[sceneState.activeScreenIndex] ?? null

	const buildLayerRouteDescriptor = createBuildLayerRouteDescriptor({ sceneState, getChannelMap })
	const getThumbForSource = (source, channelForLive) =>
		resolveSourceThumbnailUrl(source, { maxWidth: SCENE_THUMB_MAX_W, seekSec: 0, channelForLive })
	const getComposeStreamNames = () => {
		const pgmCh = getPlaybackChannel()
		const prvCh = getPreviewChannel()
		return {
			pgm: `pgm_${Math.max(1, pgmCh)}`,
			// No PRV for pgm_only destinations -> use same bus so compose panel never appears "dead".
			prv: `prv_${Math.max(1, prvCh || pgmCh)}`,
		}
	}
	const resolveComposeScene = () => {
		const id = sceneState.editingSceneId || sceneState.previewSceneId
		return id ? sceneState.getScene(id) : null
	}
	const getResolution = () => {
		const scene = resolveComposeScene()
		const mainIdx = scene ? resolveMainIndexForScene(scene, sceneState) : sceneState.activeScreenIndex
		return Logic.getResolutionForScreen(mainIdx, sceneState, stateStore)
	}
	const getEditBusChannelForComposeScene = () => {
		const scene = resolveComposeScene()
		const cm = getChannelMap()
		return (
			resolveLookStackChannelForBus(cm, sceneState, scene, 'edit') ??
			getPreviewChannel() ??
			getPlaybackChannel()
		)
	}
	const getPreviewOutputResolution = () => { const cm = getChannelMap(); return cm.previewResolutions?.[sceneState.activeScreenIndex] ?? cm.programResolutions?.[sceneState.activeScreenIndex] ?? { w: 1920, h: 1080 } }

	const previewRuntime = createScenesPreviewRuntime({
		sceneState,
		stateStore,
		getPreviewOutputResolution,
		getChannelMap,
		getPreviewChannel,
		flushSceneDeckSync: opts.flushSceneDeckSync,
	})

	async function exitLookEditor() {
		commitPendingLookNameEdits(mainHost, sceneState)
		const id = sceneState.editingSceneId
		// WO-272: read before setEditingScene(null) resets it — an edit-on-PGM session never staged
		// anything on PRV, so registering the look as PRV-live on exit would be a lie.
		const wasEditOnPgm = sceneState.editOnPgm === true
		await previewRuntime.waitForPreviewPushComplete()
		if (id) {
			const scene = sceneState.getScene(id)
			if (scene) {
				const mainIdx = resolveMainIndexForScene(scene, sceneState)
				const cm = getChannelMap()
				// Skip preview live sync for PGM-only mains (no separate preview bus)
				if (!wasEditOnPgm && isPreviewBusAvailable(cm, mainIdx)) {
					try {
						await syncPreviewLiveToServer(id, mainIdx, { sceneState, stateStore })
					} catch (e) {
						console.warn('Exit edit: preview live sync failed:', e?.message || e)
					}
				}
			}
			try {
				await refreshSceneLiveFromServer(sceneState, stateStore)
			} catch (e) {
				console.warn('Exit edit: scene.live refresh failed:', e?.message || e)
			}
		}
		sceneState.setEditingScene(null)
		selectedLayerIndexRef.current = null
		dispatchLayerSelect(null)
		previewRuntime.clearLastPreviewLayers()
	}

	window.addEventListener('highascg-border-preset-recall', (ev) => {
		const d = ev?.detail
		if (d == null || d.screenIndex == null || d.slot == null) return
		void previewRuntime.recallGlobalBorderPreset(Number(d.screenIndex), Number(d.slot))
	})

	window.addEventListener('highascg-global-border-push', () => previewRuntime.pushBorderOnly())

	async function captureOnDemandForDroppedSource(data) {
		if (!data || !data.type) return
		const mainIdx = sceneState.activeScreenIndex
		if (String(data.type) === 'timeline' && data.value) {
			const timelineId = encodeURIComponent(String(data.value))
			// One-shot PRV thumb at 5s marker for timeline cards.
			await api.post(`/api/timelines/${timelineId}/sendto`, { preview: true, program: false, screenIdx: mainIdx }).catch(() => {})
			await api.post(`/api/timelines/${timelineId}/seek`, { ms: 5000 }).catch(() => {})
			await api.post(`/api/timelines/${timelineId}/play`, { from: 5000 }).catch(() => {})
			await new Promise((r) => setTimeout(r, 160))
			await api.post(`/api/timelines/${timelineId}/pause`).catch(() => {})
			previewPanel.scheduleDraw()
			return
		}
		if (String(data.type) === 'route') {
			previewPanel.scheduleDraw()
		}
	}

	const { stopActiveTimelineOnServer, sendSceneToPreviewWithTimelineClear } = createPreviewActions({
		api,
		previewRuntime,
	})

	// All armed screens take TOGETHER (WO-150 B150.6) — one batched dispatch instead of
	// awaiting each screen's full transition before starting the next.
	const collectArmedPreviewEntries = () => {
		const armed = sceneState.armedScreenIndices?.length ? sceneState.armedScreenIndices : [sceneState.activeScreenIndex]
		const entries = []
		for (const mIdx of armed) {
			const sid = sceneState.getPreviewSceneIdForMain(mIdx)
			if (sid) entries.push({ sceneId: sid, mainIdx: mIdx })
		}
		return entries
	}

	const globalTakeFromPreview = async () => {
		// WO-185 T185.1: If editing a scene with a specific mainScope, take the edited scene to its main
		if (sceneState.editingSceneId) {
			const scene = sceneState.getScene(sceneState.editingSceneId)
			if (scene) {
				const scope = String(scene.mainScope || 'all')
				// Only override if scope is NOT 'all' - 'all' scope uses armed-preview logic
				if (scope !== 'all') {
					const mainIdx = resolveMainIndexForScene(scene, sceneState)
					await takeSceneToProgram(sceneState.editingSceneId, false, { targetMains: [mainIdx] })
					return
				}
			}
		}

		// Otherwise use armed-preview logic
		const entries = collectArmedPreviewEntries()
		if (!entries.length) {
			showScenesToast('No look on preview. Click a look thumbnail (canvas) first.', 'error')
			return
		}
		await takeSceneToProgram.batch(entries, false, {})
	}

	const globalCutFromPreview = async () => {
		// WO-185 T185.1: If editing a scene with a specific mainScope, cut the edited scene to its main
		if (sceneState.editingSceneId) {
			const scene = sceneState.getScene(sceneState.editingSceneId)
			if (scene) {
				const scope = String(scene.mainScope || 'all')
				// Only override if scope is NOT 'all' - 'all' scope uses armed-preview logic
				if (scope !== 'all') {
					const mainIdx = resolveMainIndexForScene(scene, sceneState)
					await takeSceneToProgram(sceneState.editingSceneId, true, { targetMains: [mainIdx] })
					return
				}
			}
		}

		// Otherwise use armed-preview logic
		const entries = collectArmedPreviewEntries()
		if (!entries.length) {
			showScenesToast('No look on preview. Click a look thumbnail first.', 'error')
			return
		}
		await takeSceneToProgram.batch(entries, true, {})
	}

	const takeSceneToProgram = createTakeSceneToProgram({
		api,
		stateStore,
		getChannelMap,
		getProgramChannel,
		showToast: showScenesToast,
		stopActiveTimelineOnServer,
		flushSceneDeckSync: opts.flushSceneDeckSync,
		primePreviewSnapshotFromScene: previewRuntime.primePreviewSnapshotFromScene,
		getOscClient,
		getVariableStore: opts.getVariableStore || (() => null),
	})

	let selectedLayerIndex = null
	const selectedLayerIndexRef = { get current() { return selectedLayerIndex }, set current(v) { selectedLayerIndex = v } }
	const dispatchLayerSelect = detail => { selectedLayerIndex = detail?.layerIndex ?? null; window.dispatchEvent(new CustomEvent('scene-layer-select', { detail })); previewPanel.scheduleDraw(); scheduleRender() }

	const applyNativeFillForSource = createApplyNativeFillForSource({
		sceneState,
		stateStore,
		getResolution: () => {
			const scene = resolveComposeScene()
			const mainIdx = scene ? resolveMainIndexForScene(scene, sceneState) : sceneState.activeScreenIndex
			return Logic.getResolutionForScreen(mainIdx, sceneState, stateStore)
		},
	})
	const { startDrag, startRotate, startScale, startEdgeResize } = createComposeDragHandlers(sceneState, previewRuntime.schedulePreviewPush)

	/** @type {(mainCol: number, e: DragEvent) => Promise<void>} */
	let onDeckMediaDrop

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
		// WO-256: threaded through to the operator-GUI free-tile canvas's per-tile progress bars
		// (mountPgmTopLayerPlaybackTimer) — unused/no-op on the normal (non-operator-tiles) path.
		getOscClient,
		// WO-243/255: no-op unless operator-GUI mode is active (reportComposeCellRects hard-gates
		// itself) — this is the main operator output preview, so its compose cells are the
		// 'compose' surface merged into the operator-GUI channel's route holes (10-49).
		onComposeCellRects: (cellRects) => reportComposeCellRects(cellRects),
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
				let id, scene
				if (meta.composeCell === 'pgm') {
					if (sceneState.editOnPgm && sceneState.editingSceneId) {
						id = sceneState.editingSceneId
						scene = sceneState.getScene(id)
					} else {
						id = sceneState.getLiveSceneIdForMain(mainIdx)
						scene = sceneState.getLiveSceneSnapshot(mainIdx) || (id ? sceneState.getScene(id) : null)
					}
				} else {
					id = sceneState.getPreviewSceneIdForMain(mainIdx) || (sceneState.editOnPgm ? null : fallbackEditingId)
					scene = id ? sceneState.getScene(id) : null
				}
				const r = Logic.getResolutionForScreen(mainIdx, sceneState, stateStore)
				const cellZoom = meta.composeCellZoom || 1.0
				if (isSnapshotComposePreview()) {
					const cm = getChannelMap()
					const ch = resolveComposeChannelForCell(meta, cm, mainIdx)
					if (ch) {
						drawComposeSnapshotCell(ctx, cellW, cellH, ch, { onLoaded: () => previewPanel.scheduleDraw() })
						drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell })
						return
					}
				}
				// --- legacy canvas compose (WO-57) ---
				drawDualComposeCellPreview(ctx, r.w, r.h, cellW, cellH, cellZoom, c => {
					const cm = getChannelMap()
					const prvForMain = cm.previewChannels?.[mainIdx]
					const pgmForMain = cm.playbackChannels?.[mainIdx] ?? cm.programChannels?.[mainIdx] ?? getPlaybackChannel()
					const thumbCh =
						meta.composeCell === 'prv'
							? prvForMain != null && prvForMain > 0
								? prvForMain
								: null
							: pgmForMain
					drawOutputCanvasBounds(c, r.w, r.h); drawSceneComposeStack(c, r.w, r.h, { scene: scene || { layers: [] }, selectedLayerIndex: scene?.id === sceneState.editingSceneId ? selectedLayerIndex : null, isLive: false, skipBg: true, composePrvPgmLayout: layout, composeDualStreamPreview: true, getThumbUrl: s => getThumbForSource(s, thumbCh), onThumbLoaded: () => previewPanel.scheduleDraw() })
				}); drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell }); return
			}
			const scene = resolveComposeScene()
			if (isSnapshotComposePreview()) {
				const { channel: ch } = resolveComposeChannelForEditingScene(scene, sceneState, getChannelMap())
				if (ch) {
					drawComposeSnapshotCell(ctx, W, H, ch, { onLoaded: () => previewPanel.scheduleDraw() })
					return
				}
			}
			drawSceneComposeStack(ctx, W, H, { scene: scene || { layers: [] }, selectedLayerIndex, isLive, composePrvPgmLayout: layout, composeDualStreamPreview: isDual, getThumbUrl: s => getThumbForSource(s, getEditBusChannelForComposeScene()), onThumbLoaded: () => previewPanel.scheduleDraw() })
		}
	})
	bindScenesPreviewSplitDrag({ splitHandle, previewHost, previewPanel, splitPx })

	const { paintDeckThumb, repaintDeckThumbs } = createDeckThumbPainter({
		sceneState,
		stateStore,
		getChannelMap,
		getProgramChannel,
		previewPanel,
		mainHost,
	})

	const render = () => {
		commitPendingLookNameEdits(mainHost, sceneState)
		const preserveDeckScroll = !sceneState.editingSceneId
		const prevScrollTop = preserveDeckScroll ? mainHost.scrollTop : 0
		const prevScrollLeft = preserveDeckScroll ? mainHost.scrollLeft : 0
		tabsHost.innerHTML = ''
		if (sceneState.editingSceneId) renderEdit({ mainHost, sceneState, stateStore, takeSceneToProgram, getProgramChannel, getScreenCount, getChannelMap, clearLastPreviewLayers: previewRuntime.clearLastPreviewLayers, onExitEdit: exitLookEditor, dispatchLayerSelect, schedulePreviewPush: previewRuntime.schedulePreviewPush, applyNativeFillForSource, buildLayerRouteDescriptor, renderCompose: s => renderComposeScene(s, { sceneState, stateStore, getResolution, selectedLayerIndex, dispatchLayerSelect, schedulePreviewPush: previewRuntime.schedulePreviewPush, applyNativeFillForSource, SCENE_THUMB_MAX_W: SCENE_THUMB_MAX_W, startDrag, startRotate, startScale, startEdgeResize, onSourceDropped: captureOnDemandForDroppedSource, getThumbUrlForLayerSource: (src) => getThumbForSource(src, getEditBusChannelForComposeScene()), getPreviewChannelForLiveThumb: getEditBusChannelForComposeScene }), selectedLayerIndexRef, showScenesToast })
		else renderSceneDeck({ mainHost, sceneState, getScreenCount, getChannelMap, getSceneLive: () => stateStore.getState()?.scene?.live || {}, outputAspect: getResolution().w / getResolution().h, paintDeckThumb, takeSceneToProgram, showToast: showScenesToast, dispatchLayerSelect, previewPanel, sendSceneToPreviewCard: sendSceneToPreviewWithTimelineClear, clearPreviewBusForMain: previewRuntime.clearPreviewBusForMain, selectedLayerIndexRef,
		onDeckMediaDropAccept: dataTransferOffersDeckMedia,
		onDeckMediaDrop,
		globalTakeFromPreview,
		globalCutFromPreview,
	})
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

	subscribeComposePreviewRefresh(() => {
		previewPanel?.scheduleDraw?.()
		repaintDeckThumbs()
	})

	let composePreviewMode = resolveComposePreviewMode()
	function refreshComposePreviewAfterSettings() {
		syncComposePreviewFromChannelMap(getChannelMap())
		previewPanel?.scheduleDraw?.()
		repaintDeckThumbs()
	}
	settingsState.subscribe(() => {
		const next = resolveComposePreviewMode()
		if (next === composePreviewMode) return
		composePreviewMode = next
		refreshComposePreviewAfterSettings()
	})
	document.addEventListener('highascg-settings-applied', refreshComposePreviewAfterSettings)
	syncComposePreviewFromChannelMap(getChannelMap())

	onDeckMediaDrop = createDeckMediaDropHandler({
		sceneState,
		getChannelMap,
		getScreenCount,
		ingestDeckDroppedFiles,
		dispatchLayerSelect,
		selectedLayerIndexRef,
		applyNativeFillForSource,
		captureOnDemandForDroppedSource,
		previewRuntime,
		scheduleRender,
	})

	// Including `scene.live`: take-to-PGM updates `sceneState` silently and applies `scene.live` only — deck PRV/PGM borders read live IDs from sceneState.
	stateStore.on('*', path => { if (['channelMap', 'scene.live', '*'].includes(path)) scheduleRender() })
	sceneState.on('softChange', () => {
		previewPanel.scheduleDraw()
		if (sceneState.borderChanged) {
			sceneState.borderChanged = false
			previewRuntime.pushBorderOnly()
		} else if (!sceneState.editingSceneId) {
			scheduleRender()
			return
		} else {
			previewRuntime.schedulePreviewPush()
		}
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
	document.addEventListener('scenes-refresh-preview', () => {
		/* WO-187 T187.4: Invalidate template thumb cache on cgData/countdownConfig changes */
		clearTemplateThumbCache()
		previewRuntime.scheduleFlushPreviewFromInspector()
		previewPanel.scheduleDraw()
	})
	document.addEventListener('scenes-tab-activated', async () => {
		const cm = getChannelMap()
		const screenCount = Math.max(1, cm.screenCount ?? sceneState._canvasResolutions?.length ?? 1)
		sceneState.syncMainEditorVisibleToScreenCount(screenCount)
		// Do not STOP timeline here — that clears PGM/PRV AMCP layers. Timeline is stopped only when
		// previewing a look (sendSceneToPreviewWithTimelineClear) or when taking a look to program.
		previewPanel.scheduleDraw()
		if (sceneState.editingSceneId) previewRuntime.schedulePreviewPush()
	})
	document.addEventListener('scenes-edit-live-on-pgm', (e) => {
		console.log('Received scenes-edit-live-on-pgm event, detail:', e.detail)
		const mainIdx = e.detail?.mainIndex
		if (mainIdx == null) return
		const sceneId = sceneState.getLiveSceneIdForMain(mainIdx)
		console.log('Live scene ID for main', mainIdx, 'is', sceneId)
		if (sceneId) {
			sceneState.setEditOnPgm(true)
			sceneState.setEditingScene(sceneId)
			// WO-272: prime the content snapshot from the look being edited so the first geometry
			// drag rides the PGM nudge instead of tripping the content-change cut-take path
			// (pushEditsToPgmLive in scenes-preview-runtime.js — a cut restarts clips on AIR).
			previewRuntime.primePreviewSnapshotFromScene(sceneId)
			if (typeof window.highascgActivateWorkspaceTab === 'function') {
				window.highascgActivateWorkspaceTab('scenes')
			}
		} else {
			showScenesToast('No active look on this PGM channel to edit.', 'error')
		}
	})
	document.addEventListener('timeline-tab-activated', () => {
		const mIdx = sceneState.activeScreenIndex
		previewRuntime.clearPreviewBusForMain(mIdx).catch(() => {})
	})
	document.addEventListener(LOOK_PRESET_RECALL_PRV, (e) => {
		const d = e.detail || {}
		if (!d.sceneId && !(d.lookPreset && Array.isArray(d.lookPreset.items) && d.lookPreset.items.length)) return
		Logic.runLookRecall(d.sceneId, d.lookPreset, 'prv', {
			...previewRuntime,
			sendSceneToPreviewCard: sendSceneToPreviewWithTimelineClear,
			takeSceneToProgram,
			showScenesToast,
		})
	})
	document.addEventListener(LOOK_PRESET_RECALL_PGM, (e) => {
		const d = e.detail || {}
		if (!d.sceneId && !(d.lookPreset && Array.isArray(d.lookPreset.items) && d.lookPreset.items.length)) return
		Logic.runLookRecall(d.sceneId, d.lookPreset, 'pgm', {
			...previewRuntime,
			takeSceneToProgram,
			showScenesToast,
			forceCut: !!d.forceCut,
			useGlobalTransition: !!d.useGlobalTransition,
		})
	})
	attachScenesEditorKeyboard({ globalTakeFromPreview })

	scheduleRender()
}
