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
import { applyTimelineClipLayoutFromMedia } from '../lib/timeline-clip-layout.js'
import { api, getApiBase } from '../lib/api-client.js'
import { initTimelineCanvas, fmtSmpte, parseTcInput } from './timeline-canvas.js'
import { initPreviewPanel, drawTimelineStack } from './preview-canvas.js'
import { createTimelineTransport } from './timeline-transport.js'
import { UI_FONT_FAMILY } from '../lib/ui-font.js'

export function initTimelineEditor(root, stateStore) {
	let redrawTimelineView = () => {}
	let playback = { playing: false, position: 0, timelineId: null, loop: false }
	let selectedClip = null  // { layerIdx, clipId, timelineId, clip }
	let _seekThrottleLast = 0
	let _seekThrottleId = null
	// sendTo.screenIdx: 0-based screen index, null = all screens
	// Default to both PGM and PRV; timeline uses Caspar layers 100+ (separate from looks / black on 9)
	const view = {
		sendTo: { preview: true, program: true, screenIdx: 0 },
		follow: true,
		takeTransition: { type: 'MIX', duration: 12, tween: 'linear' },
	}

	// Smooth playhead: track server tick reference point for local interpolation (same clock as RAF)
	let serverTickPos = 0
	let serverTickAt = 0
	let playLoopRaf = null
	/** Above this, snap playhead to server time. Between soft and hard, blend (reduces stepping over Tailscale). */
	const TICK_DRIFT_HARD_MS = 120
	const TICK_DRIFT_SOFT_MIN_MS = 10
	const TICK_DRIFT_BLEND = 0.25

	function startPlaybackLoop() {
		if (playLoopRaf) return
		const loop = () => {
			if (!playback.playing) {
				playLoopRaf = null
				return
			}
			const elapsed = performance.now() - serverTickAt
			const tl = timelineState.getActive()
			const extrapolated = serverTickPos + elapsed
			playback.position = tl ? Math.min(extrapolated, tl.duration) : extrapolated
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
	}

	root.innerHTML = `
		<div class="tl-editor-root">
			<div id="tl-preview-host" class="tl-preview-host"></div>
			<div class="tl-editor">
				<div class="tl-transport" id="tl-transport"></div>
				<div class="tl-body" id="tl-body"></div>
			</div>
		</div>
	`
	const previewHost = root.querySelector('#tl-preview-host')
	const transportEl = root.querySelector('#tl-transport')
	const bodyEl = root.querySelector('#tl-body')

	// ── Canvas ────────────────────────────────────────────────────────────────

	const canvas = initTimelineCanvas(bodyEl, {
		getTimeline: () => timelineState.getActive(),
		getPlayback: () => playback,
		getView: () => view,
		onSeek(ms) {
			const tl = timelineState.getActive()
			if (!tl) return
			const clamped = Math.max(0, Math.min(ms, tl.duration))
			playback.position = clamped
			updateTimecode()
			// Throttle SEEK API during drag (~100ms) to avoid flooding CasparCG
			const now = Date.now()
			if (!_seekThrottleLast || now - _seekThrottleLast >= 100) {
				_seekThrottleLast = now
				if (_seekThrottleId) clearTimeout(_seekThrottleId)
				_seekThrottleId = null
				api.post(`/api/timelines/${tl.id}/seek`, { ms: clamped }).catch(() => {})
			} else if (!_seekThrottleId) {
				_seekThrottleId = setTimeout(() => {
					_seekThrottleId = null
					_seekThrottleLast = Date.now()
					const t = timelineState.getActive()
					if (t) api.post(`/api/timelines/${t.id}/seek`, { ms: playback.position }).catch(() => {})
				}, 100)
			}
			redrawTimelineView()
		},
		onSeekEnd(ms) {
			const tl = timelineState.getActive()
			if (!tl) return
			if (_seekThrottleId) { clearTimeout(_seekThrottleId); _seekThrottleId = null }
			const clamped = Math.max(0, Math.min(ms ?? playback.position, tl.duration))
			playback.position = clamped
			updateTimecode()
			api.post(`/api/timelines/${tl.id}/seek`, { ms: clamped }).catch(() => {})
			redrawTimelineView()
		},
		onSelectClip(info) {
			selectedClip = info
			if (!info) window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: null }))
			window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: info }))
		},
		onSelectFlag(info) {
			selectedClip = null
			window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: info }))
		},
		onMoveFlagTime(timelineId, flagId, timeMs) {
			timelineState.updateFlag(timelineId, flagId, { timeMs: timeMs })
		},
		onDropSource(source, layerIdx, startTime) {
			const tl = timelineState.getActive()
			if (!tl) return
			let duration = 5000
			if (source?.type === 'media' && source?.value) {
				const mediaList = stateStore.getState()?.media || []
				const match = mediaList.find((m) => m.id === source.value)
				if (match?.durationMs > 0) duration = match.durationMs
			}
			if (startTime + duration > tl.duration) {
				timelineState.updateTimeline(tl.id, { duration: startTime + duration + 2000 })
			}
			while (tl.layers.length <= layerIdx) {
				timelineState.addLayer(tl.id)
			}
			const clip = timelineState.addClip(tl.id, layerIdx, source, startTime, duration)
			syncToServer(timelineState.getActive())
			redrawTimelineView()
			if (clip) {
				void (async () => {
					await applyTimelineClipLayoutFromMedia(clip, timelineState, tl.id, layerIdx, clip.id, stateStore, sceneState)
					syncToServer(timelineState.getActive())
					redrawTimelineView()
				})()
			}
		},
		onMoveClip(layerIdx, clipId, newStartTime) {
			const tl = timelineState.getActive()
			if (!tl) return
			timelineState.updateClip(tl.id, layerIdx, clipId, { startTime: newStartTime })
			// Sync deferred to mouseup — avoid flooding API during drag
		},
		onResizeClip(layerIdx, clipId, changes) {
			const tl = timelineState.getActive()
			if (!tl) return
			timelineState.updateClip(tl.id, layerIdx, clipId, changes)
		},
		getThumbnailUrl: (source) => source?.type === 'media' && source?.value
			? `${getApiBase()}/api/thumbnail/${encodeURIComponent(source.value)}`
			: null,
		// Prompt 28: when local_media_path configured, use real waveform API; else synthetic
		getWaveformUrl: (source) => {
			if (source?.type !== 'media' || !source?.value) return null
			if (!stateStore.getState()?.localMediaEnabled) return null
			return `${getApiBase()}/api/local-media/${encodeURIComponent(source.value)}/waveform`
		},
		onLayerContextMenu(timelineId, layerIdx, layer, clientX, clientY) {
			showLayerContextMenu(clientX, clientY, timelineId, layerIdx, layer)
		},
		onLayerClick(timelineId, layerIdx, layer) {
			selectedClip = null
			window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: null }))
			window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: null }))
			window.dispatchEvent(new CustomEvent('timeline-layer-select', { detail: { timelineId, layerIdx, layer } }))
		},
		onSelectKeyframe(info) {
			window.dispatchEvent(new CustomEvent('timeline-keyframe-select', { detail: info }))
		},
		onMoveKeyframe(timelineId, layerIdx, clipId, keyframeIdx, newTime) {
			timelineState.updateKeyframeTime(timelineId, layerIdx, clipId, keyframeIdx, newTime)
		},
	})

	let previewPanel = null
	redrawTimelineView = () => {
		canvas.redraw()
		previewPanel?.scheduleDraw?.()
	}

	const transportApi = createTimelineTransport({
		transportEl,
		stateStore,
		playback,
		view,
		canvas,
		redrawTimelineView,
		stopPlaybackLoop,
		startPlaybackLoop,
		setServerTick: (pos) => {
			serverTickPos = pos
			serverTickAt = performance.now()
		},
	})
	const { buildTransport, updateTimecode, doSeek, syncToServer, updateSendTo, togglePlay, doStop } = transportApi

	/** Align Dest PRV/PGM with server playback (fixes missing `program` in sendTo defaulting to no PGM). */
	async function syncPlaybackFromServer() {
		const tl = timelineState.getActive()
		if (!tl?.id) return
		try {
			const pb = await api.get(`/api/timelines/${encodeURIComponent(tl.id)}/state`)
			if (!pb || typeof pb !== 'object') return
			if (pb.sendTo && typeof pb.sendTo === 'object') {
				Object.assign(view.sendTo, pb.sendTo)
			}
			if (typeof pb.loop === 'boolean') playback.loop = pb.loop
			if (pb.timelineId != null) playback.timelineId = pb.timelineId
			if (typeof pb.position === 'number') {
				playback.position = pb.position
				canvas.setPlayheadPosition(pb.position)
			}
			if (typeof pb.playing === 'boolean') {
				playback.playing = pb.playing
				if (pb.playing) {
					serverTickPos = pb.position ?? 0
					serverTickAt = performance.now()
					startPlaybackLoop()
				} else {
					stopPlaybackLoop()
				}
			}
			buildTransport()
			redrawTimelineView()
		} catch {
			/* timeline may not exist on server until first save/play */
		}
	}

	previewPanel = initPreviewPanel(previewHost, {
		title: 'Timeline output',
		storageKeyPrefix: 'casparcg_preview_timeline',
		getOutputResolution: () => {
			const s = view.sendTo.screenIdx ?? 0
			const pr = stateStore.getState()?.channelMap?.programResolutions?.[s]
			return pr?.w > 0 && pr?.h > 0 ? pr : { w: 1920, h: 1080 }
		},
		stateStore,
		streamName: 'prv_1',
		composePrvPgmLayoutToggle: true,
		draw(ctx, W, H, isLive, meta = {}) {
			drawTimelineStack(ctx, W, H, {
				timelineState,
				getPlayback: () => playback,
				isLive,
				composePrvPgmLayout: meta.composePrvPgmLayout === 'tb' ? 'tb' : 'lr',
				composeDualStreamPreview: meta.composeDualStreamPreview === true,
				getThumbUrl: (src) =>
					src?.type === 'media' && src?.value
						? `${getApiBase()}/api/thumbnail/${encodeURIComponent(src.value)}`
						: null,
				onThumbLoaded: () => previewPanel.scheduleDraw(),
				stateStore,
				screenIdx: view.sendTo.screenIdx ?? 0,
			})
		},
	})

	function showLayerContextMenu(clientX, clientY, timelineId, layerIdx, layer) {
		const existing = document.getElementById('tl-layer-menu')
		if (existing) existing.remove()
		const menu = document.createElement('div')
		menu.id = 'tl-layer-menu'
		menu.className = 'tl-layer-menu'
		menu.innerHTML = `
			<button type="button" data-action="rename">Rename layer</button>
			<button type="button" data-action="add">Add layer below</button>
			<button type="button" data-action="remove">Remove layer</button>
		`
		menu.style.cssText = `position:fixed;left:${clientX}px;top:${clientY}px;z-index:9999;background:#21262d;border:1px solid #30363d;border-radius:6px;padding:4px;min-width:140px;box-shadow:0 8px 24px rgba(0,0,0,0.4);`
		menu.querySelectorAll('button').forEach((b) => {
			b.style.cssText = `display:block;width:100%;text-align:left;padding:6px 10px;background:0;border:0;color:#c9d1d9;cursor:pointer;font:12px ${UI_FONT_FAMILY};border-radius:4px;`
			b.addEventListener('mouseenter', () => { b.style.background = '#30363d' })
			b.addEventListener('mouseleave', () => { b.style.background = '0' })
		})
		const close = () => menu.remove()
		menu.querySelector('[data-action="rename"]').addEventListener('click', () => {
			const name = prompt('Layer name', layer.name || `Layer ${layerIdx + 1}`)
			if (name != null && name.trim()) {
				timelineState.updateLayer(timelineId, layerIdx, { name: name.trim() })
				syncToServer(timelineState.getActive())
				redrawTimelineView()
			}
			close()
		})
		menu.querySelector('[data-action="add"]').addEventListener('click', () => {
			timelineState.addLayer(timelineId, `Layer ${layerIdx + 2}`)
			syncToServer(timelineState.getActive())
			redrawTimelineView()
			close()
		})
		menu.querySelector('[data-action="remove"]').addEventListener('click', () => {
			if (confirm(`Remove "${layer.name || 'Layer ' + (layerIdx + 1)}" and all its clips?`)) {
				timelineState.removeLayer(timelineId, layerIdx)
				syncToServer(timelineState.getActive())
				redrawTimelineView()
				if (selectedClip?.layerIdx === layerIdx) selectedClip = null
				window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: null }))
			}
			close()
		})
		document.body.appendChild(menu)
		document.addEventListener('click', close, { once: true })
	}

	// ── Keyboard shortcuts ────────────────────────────────────────────────────

	root.setAttribute('tabindex', '-1')
	root.addEventListener('keydown', (e) => {
		// Spacebar = play/pause regardless of selection
		if (e.key === ' ') {
			e.preventDefault()
			togglePlay()
			return
		}

		if (!selectedClip) return
		const { timelineId, layerIdx, clipId, clip } = selectedClip
		if (!clip) return

		if (e.key === 'i') {
			e.preventDefault()
			// Fade in: opacity 0 at localTime=0, opacity 1 at localTime=500ms
			timelineState.clearKeyframeRange(timelineId, layerIdx, clipId, 'opacity', 0, 500)
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: 0, property: 'opacity', value: 0, easing: 'linear' })
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: 500, property: 'opacity', value: 1, easing: 'linear' })
			syncToServer(timelineState.getActive())
			redrawTimelineView()
		}

		if (e.key === 'o') {
			e.preventDefault()
			// Fade out: opacity 1 at (duration-500ms), opacity 0 at duration
			const fadeStart = Math.max(0, clip.duration - 500)
			timelineState.clearKeyframeRange(timelineId, layerIdx, clipId, 'opacity', fadeStart, clip.duration + 1)
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: fadeStart, property: 'opacity', value: 1, easing: 'linear' })
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: clip.duration, property: 'opacity', value: 0, easing: 'linear' })
			syncToServer(timelineState.getActive())
			redrawTimelineView()
		}

		// p = position keyframe (x,y), s = scale keyframe (locked), v = volume, t = opacity at current time
		if (e.key === 'p' || e.key === 's' || e.key === 'v' || e.key === 't') {
			e.preventDefault()
			const localMs = Math.max(0, Math.round(playback.position - clip.startTime))
			const time = Math.min(localMs, clip.duration)
			if (e.key === 'p') timelineState.addPositionKeyframe(timelineId, layerIdx, clipId, time, 0, 0)
			else if (e.key === 's') timelineState.addScaleKeyframe(timelineId, layerIdx, clipId, time, 1)
			else timelineState.addKeyframe(timelineId, layerIdx, clipId, { time, property: e.key === 'v' ? 'volume' : 'opacity', value: e.key === 'v' ? 1 : 1, easing: 'linear' })
			syncToServer(timelineState.getActive())
			redrawTimelineView()
			window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: selectedClip }))
		}

		if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault()
			timelineState.removeClip(timelineId, layerIdx, clipId)
			selectedClip = null
			syncToServer(timelineState.getActive())
			redrawTimelineView()
		}
	})

	// Sync after drag ends (mouseup on the body — deferred clip move/resize sync)
	bodyEl.addEventListener('mouseup', () => {
		syncToServer(timelineState.getActive())
	})

	// Enter key anywhere in timeline tab → focus current time input
	root.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter' || e.defaultPrevented) return
		const tcCur = document.getElementById('tl-tc-cur')
		const tab = document.getElementById('tab-timeline')
		if (!tcCur || !tab?.classList?.contains('active')) return
		tcCur.focus()
		tcCur.select()
		e.preventDefault()
	})

	// ── WebSocket tick / playback updates ─────────────────────────────────────

	function onTick(data) {
		if (!data?.timelineId) return
		const tl = timelineState.getActive()
		if (tl?.id !== data.timelineId) return
		const now = performance.now()
		const predicted = serverTickPos + (now - serverTickAt)
		const drift = data.position - predicted
		const abs = Math.abs(drift)
		if (abs > TICK_DRIFT_HARD_MS) {
			serverTickPos = data.position
			serverTickAt = now
		} else if (abs > TICK_DRIFT_SOFT_MIN_MS) {
			serverTickPos += drift * TICK_DRIFT_BLEND
			serverTickAt = now
		}
		if (!playback.playing) {
			playback.playing = true
			buildTransport()
			startPlaybackLoop()
		}
		updateTimecode()
	}

	function onPlayback(pb) {
		if (!pb) return
		if (pb.sendTo && typeof pb.sendTo === 'object') {
			Object.assign(view.sendTo, pb.sendTo)
		}
		const wasPlaying = playback.playing
		playback.playing = !!pb.playing
		playback.loop = !!pb.loop
		if (pb.timelineId != null) playback.timelineId = pb.timelineId
		if (pb.playing) {
			serverTickPos = pb.position ?? 0
			serverTickAt = performance.now()
			if (!wasPlaying) startPlaybackLoop()
		} else {
			playback.position = pb.position ?? 0
			stopPlaybackLoop()
			canvas.setPlayheadPosition(playback.position)
		}
		buildTransport()
		redrawTimelineView()
	}

	stateStore.on('timeline.tick', (data) => onTick(data))
	stateStore.on('timeline.playback', (pb) => onPlayback(pb))
	timelineState.on('change', () => {
		redrawTimelineView()
	})
	window.addEventListener('project-loaded', () => {
		buildTransport()
		redrawTimelineView()
	})
	window.addEventListener('timeline-redraw-request', () => redrawTimelineView())

	// When the timeline tab is clicked, force canvas resize + fit
	document.addEventListener('timeline-tab-activated', () => {
		canvas.notifyVisible()
		canvas.zoomFit()
		previewPanel?.scheduleDraw?.()
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
