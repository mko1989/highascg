/**
 * Scenes / Looks editor — deck of looks, drill-in per-scene compose with live PRV preview.
 */
import { sceneState } from '../lib/scene-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { api, getApiBase } from '../lib/api-client.js'
import { getLiveThumbnailUrl, getThumbnailUrl, getLiveThumbnailChannelForSource } from '../lib/thumbnail-url.js'
import { initPreviewPanel, drawSceneComposeStack } from './preview-canvas.js'
import { drawComposePrvPgmCellEdgeBar, drawDualComposeCellPreview, drawOutputCanvasBounds } from './preview-canvas-draw-base.js'
import { postFormDataWithProgress } from '../lib/form-upload.js'
import { isMediaOrFileSource, dataTransferOffersDeckMedia, parseDraggableSourcesPayload } from './scenes-shared.js'
import { renderSceneDeck } from './scene-list.js'
import { createScenesPreviewRuntime } from './scenes-preview-runtime.js'
import { createApplyNativeFillForSource, createComposeDragHandlers, renderComposeScene } from './scenes-compose.js'
import { mountPgmTopLayerPlaybackTimer } from './playback-timer.js'
import { SCENE_THUMB_MAX_W, SCENE_CARD_THUMB_W, showScenesToast, appendScenesEditorShell, bindScenesPreviewSplitDrag, createTakeSceneToProgram } from './scenes-editor-support.js'
import { LOOK_PRESET_RECALL_PGM, LOOK_PRESET_RECALL_PRV } from '../lib/look-preset-events.js'

import * as Logic from './scenes-editor-logic.js'
import { renderEdit } from './scenes-editor-edit.js'
import { formatFps } from './sources-panel-helpers.js'
import { resolveLookStackChannelForBus } from '../lib/look-stack-amcp-channel.js'

export function initScenesEditor(root, stateStore, opts = {}) {
	const getOscClient = opts.getOscClient || (() => null)
	const getChannelMap = () => stateStore.getState()?.channelMap || {}
	const getScreenCount = () => Math.max(1, getChannelMap().screenCount ?? 1)
	const getProgramChannel = () => getChannelMap().programChannels?.[sceneState.activeScreenIndex] ?? 1
	const getPlaybackChannel = () => getChannelMap().playbackChannels?.[sceneState.activeScreenIndex] ?? getProgramChannel()
	const getPreviewChannel = () => getChannelMap().previewChannels?.[sceneState.activeScreenIndex] ?? null

	/**
	 * Caspar channel where look-stack layers are played for {@link scene} (matches preview AMCP target).
	 * @param {import('../lib/scene-state.js').Scene} scene
	 * @param {number} layerNumber
	 * @param {{ forceBus?: 'edit' | 'pgm' | 'prv' }} [opts]
	 * @returns {{ item: object } | { error: string }}
	 */
	function buildLayerRouteLiveSourceItem(scene, layerNumber, opts = {}) {
		const cm = getChannelMap()
		const forceBus = opts.forceBus || 'edit'
		const ch = resolveLookStackChannelForBus(cm, sceneState, scene, forceBus)
		if (!Number.isFinite(ch) || ch <= 0) {
			return { error: 'No Caspar preview/program channel for this screen. Check routing in Settings.' }
		}
		const ln = Number(layerNumber)
		if (!Number.isFinite(ln) || ln < 1) return { error: 'Invalid layer number.' }
		const screenCount = Math.max(1, cm.screenCount ?? 1)
		const scope = String(scene?.mainScope || 'all')
		const mIdx =
			scope === 'all'
				? (sceneState.activeScreenIndex ?? 0)
				: Math.min(Math.max(parseInt(scope, 10) || 0, 0), screenCount - 1)
		const res = cm.previewResolutions?.[mIdx] || cm.programResolutions?.[mIdx]
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		const value = `route://${ch}-${ln}`
		const busTag = forceBus === 'pgm' ? ' PGM' : forceBus === 'prv' ? ' PRV' : ''
		return {
			item: {
				type: 'route',
				routeType: 'layer',
				value,
				label: `Route: Ch${ch} L${ln}${busTag}`,
				resolution,
				fps,
				thumbnailChannel: ch,
			},
		}
	}
	const getThumbForSource = (source, channelForLive) => {
		if (!source || !source.value) return null
		if (isMediaOrFileSource(source)) return getThumbnailUrl(source.value, SCENE_THUMB_MAX_W, 0)
		const ch = getLiveThumbnailChannelForSource(source, channelForLive)
		// No PRV bus and source does not encode a route:// or thumbnailChannel: avoid wrong-channel stills.
		if (ch == null || ch <= 0) return null
		return getLiveThumbnailUrl(ch)
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
		sceneState,
		stateStore,
		getPreviewOutputResolution,
		getChannelMap,
		getPreviewChannel,
	})

	window.addEventListener('highascg-border-preset-recall', (ev) => {
		const d = ev?.detail
		if (d == null || d.screenIndex == null || d.slot == null) return
		void previewRuntime.recallGlobalBorderPreset(Number(d.screenIndex), Number(d.slot))
	})

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

	async function stopActiveTimelineOnServer() {
		const tl = timelineState.getActive()
		if (!tl?.id) return
		await api.post(`/api/timelines/${encodeURIComponent(tl.id)}/stop`).catch(() => {})
	}

	/** Stops timeline AMCP on PRV/PGM targets, then queues look preview (avoids timeline composited under looks). */
	async function sendSceneToPreviewWithTimelineClear(sceneId, opts) {
		await stopActiveTimelineOnServer()
		previewRuntime.sendSceneToPreviewCard(sceneId, opts)
	}

	const takeSceneToProgram = createTakeSceneToProgram({
		api,
		stateStore, getChannelMap, getProgramChannel, showToast: showScenesToast,
		getTimelinePositionMsForTake: () => { const st = stateStore.getState(); return st?.timeline?.playback?.position ?? st?.timeline?.tick?.position ?? 0 },
		primePreviewSnapshotFromScene: previewRuntime.primePreviewSnapshotFromScene,
	})

	let selectedLayerIndex = null
	const selectedLayerIndexRef = { get current() { return selectedLayerIndex }, set current(v) { selectedLayerIndex = v } }
	const dispatchLayerSelect = detail => { selectedLayerIndex = detail?.layerIndex ?? null; window.dispatchEvent(new CustomEvent('scene-layer-select', { detail })); previewPanel.scheduleDraw(); scheduleRender() }

	const applyNativeFillForSource = createApplyNativeFillForSource({ sceneState, getCanvas: () => sceneState.getCanvasForScreen(sceneState.activeScreenIndex), stateStore })
	const { startDrag, startRotate, startScale, startEdgeResize } = createComposeDragHandlers(sceneState, previewRuntime.schedulePreviewPush)

	const DECK_DROP_EXT = /\.(mp4|mpe?g|m4v|mov|mxf|mkv|webm|avi|wmv|ts|mts|m2t|m2v|png|jpe?g|gif|webp|bmp|tiff?|dpx|exr|wav|mp3|aac|flac|ogg|m4a)$/i

	async function ingestDeckDroppedFiles(fileList) {
		const files = Array.from(fileList || []).filter((f) => DECK_DROP_EXT.test(f.name))
		if (!files.length) {
			showScenesToast('No supported media files in that drop.', 'error')
			return null
		}
		const fd = new FormData()
		for (const f of files) fd.append('file', f, f.name)
		try {
			await postFormDataWithProgress(getApiBase() + '/api/ingest/upload', fd, () => {})
		} catch (err) {
			showScenesToast(String(err?.message || err), 'error')
			return null
		}
		await api.post('/api/media/refresh', { ensureHqThumbs: false }).catch(() => {})
		let list = []
		for (let attempt = 0; attempt < 10; attempt++) {
			await new Promise((r) => setTimeout(r, attempt === 0 ? 100 : 220))
			try {
				const data = await api.get('/api/media')
				list = data.media || data
			} catch {
				continue
			}
			if (!Array.isArray(list)) continue
			const payloads = []
			for (const f of files) {
				const base = f.name
				const hit = list.find((m) => {
					const id = String(m.id ?? m ?? '')
					return id === base || id.endsWith(`/${base}`) || String(m.label) === base
				})
				if (hit) {
					const idVal = hit.id ?? hit
					payloads.push({
						type: 'media',
						value: idVal,
						label: hit.label || String(idVal),
						resolution: hit.resolution,
					})
				}
			}
			if (payloads.length === files.length) return payloads
		}
		showScenesToast('Could not match uploaded file(s) in the media list. Try ↻ Refresh in Sources.', 'error')
		return null
	}

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
				drawDualComposeCellPreview(ctx, W, H, cellW, cellH, c => {
					const r = Logic.getResolutionForScreen(mainIdx, sceneState, stateStore)
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
		if (sceneState.editingSceneId) renderEdit({ mainHost, sceneState, stateStore, takeSceneToProgram, getProgramChannel, getScreenCount, getChannelMap, clearLastPreviewLayers: previewRuntime.clearLastPreviewLayers, dispatchLayerSelect, schedulePreviewPush: previewRuntime.schedulePreviewPush, applyNativeFillForSource, buildLayerRouteLiveSourceItem, renderCompose: s => renderComposeScene(s, { sceneState, stateStore, getResolution, selectedLayerIndex, dispatchLayerSelect, schedulePreviewPush: previewRuntime.schedulePreviewPush, applyNativeFillForSource, SCENE_THUMB_MAX_W: SCENE_THUMB_MAX_W, startDrag, startRotate, startScale, startEdgeResize, onSourceDropped: captureOnDemandForDroppedSource, getThumbUrlForLayerSource: (src) => getThumbForSource(src, getPreviewChannel()), getPreviewChannelForLiveThumb: getPreviewChannel }), selectedLayerIndexRef, showScenesToast })
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
					const cm = getChannelMap()
					const prv = cm.previewChannels?.[main]
					const fallback = cm.programChannels?.[main] ?? cm.playbackChannels?.[main] ?? getProgramChannel()
					const thumbCh =
						prv != null && Number.isFinite(Number(prv)) && Number(prv) > 0 ? Number(prv) : Number(fallback)
					return getThumbForSource(s, thumbCh)
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
								const cm = getChannelMap()
								const prv = cm.previewChannels?.[main]
								const fallback = cm.programChannels?.[main] ?? cm.playbackChannels?.[main] ?? getProgramChannel()
								const thumbCh =
									prv != null && Number.isFinite(Number(prv)) && Number(prv) > 0 ? Number(prv) : Number(fallback)
								return getThumbForSource(s, thumbCh)
							},
							onThumbLoaded: () => previewPanel.scheduleDraw(),
							deckThumbnailMode: true,
						})
					})
				},
				deckThumbnailMode: true,
			})
		}, takeSceneToProgram, showToast: showScenesToast, dispatchLayerSelect, previewPanel, sendSceneToPreviewCard: sendSceneToPreviewWithTimelineClear, clearPreviewBusForMain: previewRuntime.clearPreviewBusForMain, selectedLayerIndexRef,
		onDeckMediaDropAccept: dataTransferOffersDeckMedia,
		onDeckMediaDrop,
		globalTakeFromPreview: async () => {
			const armed = sceneState.armedScreenIndices?.length ? sceneState.armedScreenIndices : [sceneState.activeScreenIndex]
			let any = false
			for (const mIdx of armed) {
				const sid = sceneState.getPreviewSceneIdForMain(mIdx)
				if (sid) {
					any = true
					await takeSceneToProgram(sid, false, { targetMains: [mIdx] })
				}
			}
			if (!any) showScenesToast('No look on preview. Click a look’s thumbnail (canvas) first.', 'error')
		},
		globalCutFromPreview: async () => {
			const armed = sceneState.armedScreenIndices?.length ? sceneState.armedScreenIndices : [sceneState.activeScreenIndex]
			let any = false
			for (const mIdx of armed) {
				const sid = sceneState.getPreviewSceneIdForMain(mIdx)
				if (sid) {
					any = true
					await takeSceneToProgram(sid, true, { targetMains: [mIdx] })
				}
			}
			if (!any) showScenesToast('No look on preview. Click a look’s thumbnail first.', 'error')
		}
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

	onDeckMediaDrop = async (mainCol, e) => {
		const dt = e.dataTransfer
		let payloads = []
		if (dt?.files?.length) {
			payloads = (await ingestDeckDroppedFiles(dt.files)) || []
		} else {
			payloads = parseDraggableSourcesPayload(dt)
		}
		if (!payloads.length) return

		if (mainCol !== sceneState.activeScreenIndex) sceneState.switchScreen(mainCol)

		const nScreens = Math.max(1, getScreenCount())
		const mainScope = nScreens < 2 ? String(0) : String(mainCol)
		const id = sceneState.addScene(undefined, { mainScope })
		sceneState.setEditingScene(id)
		selectedLayerIndexRef.current = null
		dispatchLayerSelect(null)

		for (const data of payloads) {
			const idx = sceneState.addLayer(id)
			const src = {
				...data,
				type: data.type || 'media',
				value: data.value,
				label: data.label || data.value,
			}
			const th = Number(data.thumbnailChannel)
			if (Number.isFinite(th) && th > 0) src.thumbnailChannel = th
			if (data.useDirect != null) src.useDirect = data.useDirect === true || data.useDirect === 'true'
			sceneState.setLayerSource(id, idx, src)
			await applyNativeFillForSource(idx, {
				type: data.type || 'media',
				value: data.value,
				label: data.label,
				resolution: data.resolution,
			})
			try {
				await captureOnDemandForDroppedSource(data)
			} catch {
				/* noop */
			}
		}

		const scene = sceneState.getScene(id)
		const lastIdx = (scene?.layers?.length ?? 1) - 1
		const lastLayer = scene?.layers?.[lastIdx]
		if (lastLayer) {
			dispatchLayerSelect({ sceneId: id, layerIndex: lastIdx, layer: lastLayer })
		}
		previewRuntime.schedulePreviewPush()
		scheduleRender()
	}

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
	document.addEventListener('scenes-refresh-preview', () => { previewRuntime.scheduleFlushPreviewFromInspector(); previewPanel.scheduleDraw() })
	document.addEventListener('scenes-tab-activated', async () => {
		await stopActiveTimelineOnServer()
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
		})
	})
	scheduleRender()
}
