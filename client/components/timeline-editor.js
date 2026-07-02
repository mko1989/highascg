/**
 * Timeline editor — transport bar, keyboard shortcuts (I/O fades), canvas orchestration.
 * Transport bar above the ruler with timecode, play controls, zoom, send-to, follow toggle.
 * I key = fade in (opacity 0→1 over first 500ms of selected clip).
 * O key = fade out (opacity 1→0 over last 500ms of selected clip).
 * Seek on every ruler drag event (CALL SEEK sent to server each move).
 * @see main_plan.md Prompt 17
 */

import { timelineState } from '../lib/timeline-state.js'
import { sceneState } from '../lib/scene-state.js'
import { api } from '../lib/api-client.js'
import { getThumbnailUrl } from '../lib/thumbnail-url.js'
import { initTimelineCanvas } from './timeline-canvas.js'
import { initPreviewPanel, drawTimelineStack } from './preview-canvas.js'
import {
	drawComposeSnapshotCell,
	isSnapshotComposePreview,
	resolveComposeChannelForCell,
	subscribeComposePreviewRefresh,
} from './preview-canvas-compose-snapshot.js'
import { drawComposePrvPgmCellEdgeBar } from './preview-canvas-draw-base.js'
import { createTimelineTransport } from './timeline-transport.js'
import { streamState } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'
import { getDefaultTransitionFromEditor } from '../lib/editor-defaults.js'
import {
	createNotifyTimelineSeekFailed,
	createTimelineCanvasHandlers,
	createShowLayerContextMenu,
	attachTimelineEditorInput,
} from './timeline-editor-handlers.js'

export function initTimelineEditor(root, stateStore) {
	let redrawTimelineView = () => {}
	/** @type {Map<string, { playing: boolean, position: number, timelineId: string, loop: boolean }>} */
	const playbackById = new Map()
	/** @type {Map<string, { serverTickPos: number, serverTickAt: number }>} */
	const clockById = new Map()

	function defaultPlayback(tlId) {
		return { playing: false, position: 0, timelineId: tlId, loop: false }
	}

	function ensurePlayback(tlId) {
		if (!tlId) return defaultPlayback(null)
		let pb = playbackById.get(tlId)
		if (!pb) {
			pb = defaultPlayback(tlId)
			playbackById.set(tlId, pb)
		}
		return pb
	}

	function getPlayback() {
		const tl = timelineState.getActive()
		return tl?.id ? ensurePlayback(tl.id) : defaultPlayback(null)
	}

	function getClock(tlId) {
		if (!clockById.has(tlId)) clockById.set(tlId, { serverTickPos: 0, serverTickAt: 0 })
		return clockById.get(tlId)
	}

	let selectedClip = null  // { layerIdx, clipId, timelineId, clip }
	let selectedFlagDetail = null // { timelineId, flagId, flag }
	/** @type {{ layerIdx: number, clip: object } | null} */
	let _clipBoard = null
	/** @type {object | null} */
	let _flagBoard = null
	let previewPanel = null
	// sendTo.screenIdx: 0-based screen index, null = all screens
	// Default PRV only — avoid sending timeline to program until the user enables PGM or uses Take / scene take.
	const view = {
		sendTo: { preview: true, program: false, screenIdx: 0 },
		follow: true,
		takeTransition: { ...getDefaultTransitionFromEditor(sceneState.getCanvasForScreen(0).framerate) },
	}

	// Playhead clock — uses Date.now() to match server timeline-playback (_p0 + Date.now() - _t0).
	// Extrapolate between WS ticks (~165 ms); never pull the UI playhead backward during play.
	let playLoopRaf = null
	/** Server more than this ahead of client → snap (seek / tab resume). */
	const TICK_AHEAD_SNAP_MS = 80
	/** Ignore server reports this far behind extrapolated time (network latency). */
	const TICK_LATENCY_MS = 35

	function clientPlayheadMs(tlId) {
		const id = tlId ?? timelineState.getActive()?.id
		if (!id) return 0
		const c = getClock(id)
		return c.serverTickPos + (Date.now() - c.serverTickAt)
	}

	function anchorPlayhead(ms, tlId) {
		const id = tlId ?? timelineState.getActive()?.id
		if (!id) return
		const c = getClock(id)
		c.serverTickPos = ms
		c.serverTickAt = Date.now()
	}

	/** Re-anchor from a server tick without backward jumps during playback. */
	function applyServerTick(serverMs, tlId) {
		const id = tlId ?? timelineState.getActive()?.id
		if (!id) return
		const c = getClock(id)
		const now = Date.now()
		const extrapolated = c.serverTickPos + (now - c.serverTickAt)
		if (serverMs - extrapolated > TICK_AHEAD_SNAP_MS) {
			c.serverTickPos = serverMs
		} else if (serverMs >= extrapolated - TICK_LATENCY_MS) {
			c.serverTickPos = serverMs
		} else {
			c.serverTickPos = extrapolated
		}
		c.serverTickAt = now
	}

	function maybeFollowPlayhead() {
		if (!view.follow) return
		const playback = getPlayback()
		canvas.followPlayhead(playback.position, { playing: playback.playing })
	}

	function startPlaybackLoop() {
		if (playLoopRaf) return
		const loop = () => {
			const playback = getPlayback()
			if (!playback.playing) {
				playLoopRaf = null
				return
			}
			const tl = timelineState.getActive()
			const pos = clientPlayheadMs(tl?.id)
			playback.position = tl ? Math.min(pos, tl.duration) : pos
			maybeFollowPlayhead()
			updateTimecode()
			redrawTimelineView()
			playLoopRaf = requestAnimationFrame(loop)
		}
		playLoopRaf = requestAnimationFrame(loop)
	}

	function stopPlaybackLoop() {
		if (playLoopRaf) {
			cancelAnimationFrame(playLoopRaf)
			playLoopRaf = null
		}
		canvas.resetFollowScroll?.()
	}

	root.innerHTML = `
		<div class="tl-editor-root">
			<div id="tl-preview-host" class="tl-preview-host"></div>
			<div class="tl-split-handle" id="tl-split-handle" title="Drag to resize preview" aria-hidden="true"></div>
			<div class="tl-editor">
				<div class="tl-transport" id="tl-transport"></div>
				<div class="tl-body" id="tl-body"></div>
			</div>
		</div>
	`
	const previewHost = root.querySelector('#tl-preview-host')
	const tlSplitHandle = root.querySelector('#tl-split-handle')
	const transportEl = root.querySelector('#tl-transport')
	const bodyEl = root.querySelector('#tl-body')

	const TL_SPLIT_LS = 'casparcg_timeline_preview_split_px'
	let tlSplitPx = 220
	try {
		const n = parseInt(localStorage.getItem(TL_SPLIT_LS) || '', 10)
		if (!Number.isNaN(n) && n >= 120 && n <= 1200) tlSplitPx = n
	} catch {
		/* ignore */
	}
	previewHost.style.flex = `0 0 ${tlSplitPx}px`
	previewHost.style.minHeight = '0'

	if (tlSplitHandle) {
		tlSplitHandle.addEventListener('mousedown', (e) => {
			if (e.button !== 0) return
			e.preventDefault()
			const startY = e.clientY
			const startH = previewHost.getBoundingClientRect().height
			const onMove = (ev) => {
				const dy = ev.clientY - startY
				const nh = Math.max(120, Math.min(1000, startH + dy))
				previewHost.style.flex = `0 0 ${nh}px`
				previewPanel?.scheduleDraw?.()
			}
			const onUp = () => {
				document.removeEventListener('mousemove', onMove)
				document.removeEventListener('mouseup', onUp)
				document.body.style.cursor = ''
				document.body.style.userSelect = ''
				const h = previewHost.getBoundingClientRect().height
				tlSplitPx = Math.round(h)
				try {
					localStorage.setItem(TL_SPLIT_LS, String(tlSplitPx))
				} catch {
					/* ignore */
				}
			}
			document.body.style.cursor = 'row-resize'
			document.body.style.userSelect = 'none'
			document.addEventListener('mousemove', onMove)
			document.addEventListener('mouseup', onUp)
		})
	}

	bodyEl.tabIndex = -1
	bodyEl.addEventListener('mousedown', () => bodyEl.focus())

	const notifyTimelineSeekFailed = createNotifyTimelineSeekFailed()

	const syncToServerRef = { fn: /** @type {(tl: any) => Promise<void>} */ (async () => {}) }

	const showLayerContextMenu = createShowLayerContextMenu({
		redrawTimelineView: () => redrawTimelineView(),
		getSyncToServer: () => syncToServerRef.fn,
		getSelectedClip: () => selectedClip,
		setSelectedClip: (v) => { selectedClip = v },
	})

	// ── Canvas ────────────────────────────────────────────────────────────────

	const canvas = initTimelineCanvas(bodyEl, createTimelineCanvasHandlers({
		stateStore,
		sceneState,
		getPlayback,
		getView: () => view,
		maybeFollowPlayhead: () => maybeFollowPlayhead(),
		getSelectedClip: () => selectedClip,
		setSelectedClip: (v) => { selectedClip = v },
		getSelectedFlagDetail: () => selectedFlagDetail,
		setSelectedFlagDetail: (v) => { selectedFlagDetail = v },
		redrawTimelineView: () => redrawTimelineView(),
		updateTimecode: () => updateTimecode(),
		getSyncToServer: () => syncToServerRef.fn,
		syncPlayheadClock: (ms) => anchorPlayhead(ms),
		notifyTimelineSeekFailed,
		getPreviewPanel: () => previewPanel,
		showLayerContextMenu,
	}))

	redrawTimelineView = () => {
		canvas.redraw()
		previewPanel?.scheduleDraw?.()
	}

	const transportApi = createTimelineTransport({
		transportEl,
		stateStore,
		getPlayback,
		view,
		canvas,
		redrawTimelineView,
		stopPlaybackLoop,
		startPlaybackLoop,
		setServerTick: (pos) => anchorPlayhead(pos, timelineState.getActive()?.id),
		maybeFollowPlayhead: () => maybeFollowPlayhead(),
		setSelectedClip: (v) => { selectedClip = v },
		setSelectedFlagDetail: (v) => { selectedFlagDetail = v },
		onTimelineSwitch: async () => {
			const tl = timelineState.getActive()
			if (!tl?.id) return
			const pb = ensurePlayback(tl.id)
			anchorPlayhead(pb.position, tl.id)
			canvas.setPlayheadPosition(pb.position)
			if (pb.playing) startPlaybackLoop()
			else stopPlaybackLoop()
			await syncPlaybackFromServer()
		},
	})
	const { buildTransport, updateTimecode, syncToServer, updateSendTo, togglePlay } = transportApi
	syncToServerRef.fn = syncToServer

	function applyPersistedSendTo(tl) {
		if (!tl?.id) return
		Object.assign(view.sendTo, timelineState.getSendTo(tl.id))
	}

	/** Align Dest PRV/PGM with server playback state. */
	async function syncPlaybackFromServer() {
		const tl = timelineState.getActive()
		if (!tl?.id) return
		applyPersistedSendTo(tl)
		try {
			const pb = await api.get(`/api/timelines/${encodeURIComponent(tl.id)}/state`)
			if (!pb || typeof pb !== 'object') {
				await syncToServer(tl)
				await updateSendTo()
				buildTransport()
				return
			}
			// While playing, server routing is authoritative (may differ from saved project).
			if (pb.playing && pb.sendTo && typeof pb.sendTo === 'object') {
				Object.assign(view.sendTo, pb.sendTo)
				timelineState.setSendTo(tl.id, view.sendTo)
			} else {
				await updateSendTo()
			}
			if (typeof pb.loop === 'boolean') ensurePlayback(tl.id).loop = pb.loop
			const local = ensurePlayback(tl.id)
			if (pb.timelineId != null) local.timelineId = pb.timelineId
			if (typeof pb.position === 'number') {
				local.position = pb.position
				anchorPlayhead(pb.position, tl.id)
				canvas.setPlayheadPosition(pb.position)
			}
			if (typeof pb.playing === 'boolean') {
				local.playing = pb.playing
				if (pb.playing) {
					startPlaybackLoop()
				} else {
					stopPlaybackLoop()
				}
			}
			buildTransport()
			redrawTimelineView()
		} catch {
			/* timeline may not exist on server until first save/play */
			await syncToServer(tl).catch(() => {})
			await updateSendTo()
			buildTransport()
			redrawTimelineView()
		}
	}

	previewPanel = initPreviewPanel(previewHost, {
		title: 'Timeline output',
		storageKeyPrefix: 'casparcg_preview_timeline',
		fillParentHeight: true,
		hideInnerResize: true,
		onCollapsedChange: (isCollapsed) => {
			previewHost.classList.toggle('tl-preview-host--collapsed', !!isCollapsed)
			if (isCollapsed) {
				previewHost.style.flex = '0 0 auto'
			} else {
				previewHost.style.flex = `0 0 ${tlSplitPx}px`
			}
		},
		getOutputResolution: () => {
			const s = view.sendTo.screenIdx ?? 0
			const pr = stateStore.getState()?.channelMap?.programResolutions?.[s]
			if (pr?.w > 0 && pr?.h > 0) return pr
			const cv = sceneState.getCanvasForScreen(s)
			if (cv.width > 0 && cv.height > 0) return { w: cv.width, h: cv.height }
			return { w: 1920, h: 1080 }
		},
		stateStore,
		getComposeCellDefs: () => {
			const s = Math.max(0, view.sendTo.screenIdx ?? 0)
			const cm = stateStore.getState()?.channelMap || {}
			const pgmCh = cm.programChannels?.[s] ?? null
			const prvCh = cm.previewChannels?.[s] ?? null
			const labelBase = cm.virtualMainChannels?.[s]?.name || `Screen ${s + 1}`
			const defs = [{
				id: `pgm_${s + 1}`,
				role: 'pgm',
				mainIndex: s,
				label: `PGM · ${labelBase}${pgmCh != null ? ` (ch ${pgmCh})` : ''}`,
			}]
			if (prvCh != null) {
				defs.push({
					id: `prv_${s + 1}`,
					role: 'prv',
					mainIndex: s,
					label: `PRV · ${labelBase} (ch ${prvCh})`,
				})
			}
			return defs
		},
		getDualStreamNames: () => {
			const s = Math.max(0, view.sendTo.screenIdx ?? 0)
			const cm = stateStore.getState()?.channelMap || {}
			const pgmCh = cm.programChannels?.[s] ?? 1
			const prvCh = cm.previewChannels?.[s] ?? null
			return { pgm: `pgm_${Math.max(1, pgmCh)}`, prv: `prv_${Math.max(1, prvCh || pgmCh)}` }
		},
		showDestinationVisualOverlay: false,
		composePrvPgmLayoutToggle: true,
		draw(ctx, W, H, isLive, meta = {}) {
			if (isSnapshotComposePreview() && meta.composeCell) {
				const layout = meta.composePrvPgmLayout === 'tb' ? 'tb' : 'lr'
				const v = meta.composeCellViewport
				const cellW = v?.w || W
				const cellH = v?.h || H
				if (isLive) {
					ctx.clearRect(0, 0, cellW, cellH)
					drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell })
					return
				}
				const cm = stateStore.getState()?.channelMap || {}
				const ch = resolveComposeChannelForCell(meta, cm, view.sendTo.screenIdx ?? 0)
				if (ch) {
					drawComposeSnapshotCell(ctx, cellW, cellH, ch, { onLoaded: () => previewPanel.scheduleDraw() })
					drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell })
					return
				}
			}
			// --- legacy canvas compose (WO-57: keep until caspar_image sign-off) ---
			drawTimelineStack(ctx, W, H, {
				timelineState,
				getPlayback,
				isLive,
				composePrvPgmLayout: meta.composePrvPgmLayout === 'tb' ? 'tb' : 'lr',
				composeDualStreamPreview: meta.composeDualStreamPreview === true,
				composeCell: meta.composeCell,
				composeCellViewport: meta.composeCellViewport,
				getThumbUrl: (src) =>
					src?.type === 'media' && src?.value
						? getThumbnailUrl(src.value, 320, 2)
						: null,
				onThumbLoaded: () => previewPanel.scheduleDraw(),
				stateStore,
				screenIdx: meta.composeScreenIdx ?? (view.sendTo.screenIdx ?? 0),
			})
		},
	})

	function syncTimelinePreviewVisibility() {
		previewHost.style.display = ''
		if (tlSplitHandle) tlSplitHandle.style.display = ''
		root.classList.remove('tl-editor-root--no-preview')
		previewPanel?.scheduleDraw?.()
	}
	streamState.subscribe(syncTimelinePreviewVisibility)
	settingsState.subscribe(syncTimelinePreviewVisibility)
	subscribeComposePreviewRefresh(() => previewPanel?.scheduleDraw?.())
	syncTimelinePreviewVisibility()

	// ── Keyboard shortcuts ────────────────────────────────────────────────────

	attachTimelineEditorInput(root, bodyEl, {
		stateStore,
		sceneState,
		getPlayback,
		getSelectedClip: () => selectedClip,
		setSelectedClip: (v) => { selectedClip = v },
		getSelectedFlagDetail: () => selectedFlagDetail,
		setSelectedFlagDetail: (v) => { selectedFlagDetail = v },
		getClipBoard: () => _clipBoard,
		setClipBoard: (v) => { _clipBoard = v },
		getFlagBoard: () => _flagBoard,
		setFlagBoard: (v) => { _flagBoard = v },
		redrawTimelineView: () => redrawTimelineView(),
		togglePlay,
		getSyncToServer: () => syncToServerRef.fn,
	})

	// ── WebSocket tick / playback updates ─────────────────────────────────────

	function onTick(data) {
		if (!data?.timelineId) return
		const local = ensurePlayback(data.timelineId)
		if (typeof data.position === 'number') applyServerTick(data.position, data.timelineId)
		const active = timelineState.getActive()
		const isActive = active?.id === data.timelineId
		if (local.playing || isActive) {
			const tl = isActive ? active : timelineState.timelines.find((t) => t.id === data.timelineId)
			const pos = clientPlayheadMs(data.timelineId)
			local.position = tl ? Math.min(pos, tl.duration) : pos
		}
		if (!isActive) return
		if (!local.playing) {
			local.playing = true
			canvas.resetFollowScroll?.()
			buildTransport()
			startPlaybackLoop()
		}
		updateTimecode()
	}

	function onPlayback(pb) {
		if (!pb?.timelineId) return
		const local = ensurePlayback(pb.timelineId)
		if (pb.sendTo && typeof pb.sendTo === 'object') {
			timelineState.setSendTo(pb.timelineId, pb.sendTo)
			const active = timelineState.getActive()
			if (active?.id === pb.timelineId) Object.assign(view.sendTo, pb.sendTo)
		}
		const wasPlaying = local.playing
		local.playing = !!pb.playing
		local.loop = !!pb.loop
		local.timelineId = pb.timelineId
		if (typeof pb.position === 'number') anchorPlayhead(pb.position, pb.timelineId)
		local.position = clientPlayheadMs(pb.timelineId)
		const active = timelineState.getActive()
		if (active?.id !== pb.timelineId) return
		if (pb.playing) {
			maybeFollowPlayhead()
			if (!wasPlaying) startPlaybackLoop()
		} else {
			stopPlaybackLoop()
			maybeFollowPlayhead()
			canvas.setPlayheadPosition(local.position)
		}
		buildTransport()
		redrawTimelineView()
	}

	stateStore.on('timeline.tick', (data) => onTick(data))
	stateStore.on('timeline.playback', (pb) => onPlayback(pb))
	stateStore.on('channelMap', () => {
		buildTransport()
		redrawTimelineView()
	})
	timelineState.on('change', () => {
		updateTimecode()
		redrawTimelineView()
	})
	window.addEventListener('project-loaded', () => {
		applyPersistedSendTo(timelineState.getActive())
		buildTransport()
		void updateSendTo()
		redrawTimelineView()
	})
	window.addEventListener('timeline-redraw-request', () => redrawTimelineView())
	document.addEventListener('highascg-editor-defaults-changed', () => {
		view.takeTransition = { ...getDefaultTransitionFromEditor(sceneState.getCanvasForScreen(0).framerate) }
		buildTransport()
	})
	sceneState.on('screenChange', () => {
		view.takeTransition = { ...getDefaultTransitionFromEditor(sceneState.getCanvasForScreen(0).framerate) }
		buildTransport()
	})

	// When the timeline tab is clicked, force canvas resize + fit
	document.addEventListener('timeline-tab-activated', () => {
		canvas.notifyVisible()
		canvas.zoomFit()
		previewPanel?.scheduleDraw?.()
		// Restore sendTo / playhead from server — do not force PRV-only (that flipped routing on tab change).
		void syncPlaybackFromServer()
	})

	// Initial build
	buildTransport()
	setTimeout(() => {
		canvas.zoomFit()
		redrawTimelineView()
		void syncPlaybackFromServer()
	}, 100) // allow container to lay out first

	return { onTick, onPlayback }
}
