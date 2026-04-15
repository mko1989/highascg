import { timelineState } from '../lib/timeline-state.js'
import { applyTimelineClipLayoutFromMedia } from '../lib/timeline-clip-layout.js'
import { findMediaRow } from '../lib/mixer-fill.js'
import { api, getApiBase } from '../lib/api-client.js'
import { createEffectInstance } from '../lib/effect-registry.js'
import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { isLikelyAudioOnlySource } from '../lib/media-audio-kind.js'

export function showTimelineToast(msg, type = 'info') {
	let container = document.getElementById('tl-toast-container')
	if (!container) {
		container = document.createElement('div')
		container.id = 'tl-toast-container'
		container.style.cssText =
			'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10020;display:flex;flex-direction:column;gap:8px;pointer-events:none;'
		document.body.appendChild(container)
	}
	const toast = document.createElement('div')
	const bg = type === 'error' ? '#b91c1c' : '#1d4ed8'
	toast.style.cssText = `padding:10px 16px;border-radius:6px;font-size:13px;font-family:${UI_FONT_FAMILY};max-width:380px;word-break:break-word;box-shadow:0 2px 10px rgba(0,0,0,.4);background:${bg};color:#fff;pointer-events:auto;`
	toast.setAttribute('role', 'status')
	toast.textContent = msg
	container.appendChild(toast)
	setTimeout(() => toast.remove(), type === 'error' ? 6000 : 4000)
}

export function createNotifyTimelineSeekFailed() {
	let _timelineSeekFailToastAt = 0
	return function notifyTimelineSeekFailed() {
		const t = Date.now()
		if (t - _timelineSeekFailToastAt < 5000) return
		_timelineSeekFailToastAt = t
		showTimelineToast('Timeline seek failed — server may be offline or timeline not synced.', 'error')
	}
}

/**
 * @param {object} deps
 * @param {() => (tl: any) => Promise<void>} deps.getSyncToServer
 */
export function createTimelineCanvasHandlers(deps) {
	const {
		stateStore,
		sceneState,
		getPlayback,
		getView,
		getSelectedClip,
		setSelectedClip,
		getSelectedFlagDetail,
		setSelectedFlagDetail,
		redrawTimelineView,
		updateTimecode,
		getSyncToServer,
		notifyTimelineSeekFailed,
		getPreviewPanel,
		showLayerContextMenu,
	} = deps

	let _seekThrottleLast = 0
	let _seekThrottleId = null

	return {
		getTimeline: () => timelineState.getActive(),
		getPlayback,
		getView,
		onSeek(ms) {
			const tl = timelineState.getActive()
			if (!tl) return
			const pb = getPlayback()
			const clamped = Math.max(0, Math.min(ms, tl.duration))
			pb.position = clamped
			updateTimecode()
			// Throttle SEEK API during drag (~100ms) to avoid flooding CasparCG
			const now = Date.now()
			if (!_seekThrottleLast || now - _seekThrottleLast >= 100) {
				_seekThrottleLast = now
				if (_seekThrottleId) clearTimeout(_seekThrottleId)
				_seekThrottleId = null
				api.post(`/api/timelines/${tl.id}/seek`, { ms: clamped }).catch(notifyTimelineSeekFailed)
			} else if (!_seekThrottleId) {
				_seekThrottleId = setTimeout(() => {
					_seekThrottleId = null
					_seekThrottleLast = Date.now()
					const t = timelineState.getActive()
					if (t) api.post(`/api/timelines/${t.id}/seek`, { ms: getPlayback().position }).catch(notifyTimelineSeekFailed)
				}, 100)
			}
			redrawTimelineView()
		},
		onSeekEnd(ms) {
			const tl = timelineState.getActive()
			if (!tl) return
			const pb = getPlayback()
			if (_seekThrottleId) { clearTimeout(_seekThrottleId); _seekThrottleId = null }
			const clamped = Math.max(0, Math.min(ms ?? pb.position, tl.duration))
			pb.position = clamped
			updateTimecode()
			api.post(`/api/timelines/${tl.id}/seek`, { ms: clamped }).catch(notifyTimelineSeekFailed)
			redrawTimelineView()
		},
		onSelectClip(info) {
			setSelectedClip(info)
			setSelectedFlagDetail(null)
			window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: null }))
			window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: info }))
		},
		onSelectFlag(info) {
			setSelectedClip(null)
			setSelectedFlagDetail(info)
			window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: info }))
		},
		onMoveFlagTime(timelineId, flagId, timeMs) {
			timelineState.updateFlag(timelineId, flagId, { timeMs: timeMs })
		},
		onDropSource(source, layerIdx, startTime) {
			const tl0 = timelineState.getActive()
			if (!tl0) return

			// Effect drop: add to the clip at this position (WO-22)
			if (source?.type === 'effect' && source?.value) {
				const layer = tl0.layers?.[layerIdx]
				if (!layer) return
				const clip = layer.clips?.find((c) => startTime >= c.startTime && startTime < c.startTime + c.duration)
				if (!clip) return // no clip at this position
				const existing = clip.effects || []
				if (existing.some((fx) => fx.type === source.value)) return // already has this effect
				const instance = createEffectInstance(source.value)
				if (!instance) return
				timelineState.updateClip(tl0.id, layerIdx, clip.id, { effects: [...existing, instance] })
				void getSyncToServer()(timelineState.getActive())
				redrawTimelineView()
				// Select the clip to show its effects in inspector
				window.dispatchEvent(new CustomEvent('timeline-clip-select', {
					detail: { layerIdx, clipId: clip.id, timelineId: tl0.id, clip: { ...clip, effects: [...existing, instance] } },
				}))
				return
			}

			void (async () => {
				let duration = 5000
				if (source?.type === 'media' && source?.value) {
					if (Number(source.durationMs) > 0) {
						duration = Number(source.durationMs)
					} else {
						const mediaList = stateStore.getState()?.media || []
						const match = findMediaRow(mediaList, source.value)
						if (match?.durationMs > 0) {
							duration = match.durationMs
						} else {
							try {
								const j = await api.post('/api/media/cinf', { id: source.value })
								if (j?.durationMs > 0) duration = j.durationMs
							} catch {
								/* fallback 5s */
							}
						}
					}
				}
				const tl = timelineState.getActive()
				if (!tl || tl.id !== tl0.id) return
				if (startTime + duration > tl.duration) {
					timelineState.updateTimeline(tl.id, { duration: startTime + duration + 2000 })
				}
				while (tl.layers.length <= layerIdx) {
					timelineState.addLayer(tl.id)
				}
				const clip = timelineState.addClip(tl.id, layerIdx, source, startTime, duration)
				void getSyncToServer()(timelineState.getActive())
				redrawTimelineView()
				if (clip) {
					await applyTimelineClipLayoutFromMedia(clip, timelineState, tl.id, layerIdx, clip.id, stateStore, sceneState)
					void getSyncToServer()(timelineState.getActive())
					redrawTimelineView()
				}
			})()
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
		onClipResizePreview({ timelineMs }) {
			const tl = timelineState.getActive()
			if (!tl) return
			const pb = getPlayback()
			const clamped = Math.max(0, Math.min(timelineMs, tl.duration))
			pb.position = clamped
			updateTimecode()
			const now = Date.now()
			if (!_seekThrottleLast || now - _seekThrottleLast >= 100) {
				_seekThrottleLast = now
				if (_seekThrottleId) clearTimeout(_seekThrottleId)
				_seekThrottleId = null
				api.post(`/api/timelines/${tl.id}/seek`, { ms: clamped }).catch(notifyTimelineSeekFailed)
			} else if (!_seekThrottleId) {
				_seekThrottleId = setTimeout(() => {
					_seekThrottleId = null
					_seekThrottleLast = Date.now()
					const t = timelineState.getActive()
					if (t) api.post(`/api/timelines/${t.id}/seek`, { ms: getPlayback().position }).catch(notifyTimelineSeekFailed)
				}, 100)
			}
			redrawTimelineView()
			getPreviewPanel()?.scheduleDraw?.()
		},
		getThumbnailUrl: (source) => source?.type === 'media' && source?.value
			? `${getApiBase()}/api/thumbnail/${encodeURIComponent(source.value)}`
			: null,
		// Real waveform from same tree as thumbnails (GET /api/local-media/.../waveform); server ffprobe path
		getWaveformUrl: (source) => {
			if (source?.type !== 'media' || !source?.value) return null
			return `${getApiBase()}/api/local-media/${encodeURIComponent(source.value)}/waveform?bars=128`
		},
		getSourceDurationMs: (source) => {
			if (source?.type !== 'media' || !source?.value) return null
			if (Number(source.durationMs) > 0) return Number(source.durationMs)
			const mediaList = stateStore.getState()?.media || []
			const match = findMediaRow(mediaList, source.value)
			if (match?.durationMs > 0) return match.durationMs
			return null
		},
		isAudioOnlySource: (source) =>
			isLikelyAudioOnlySource(source, stateStore.getState()?.media || []),
		onLayerContextMenu(timelineId, layerIdx, layer, clientX, clientY) {
			showLayerContextMenu(clientX, clientY, timelineId, layerIdx, layer)
		},
		onLayerClick(timelineId, layerIdx, layer) {
			setSelectedClip(null)
			setSelectedFlagDetail(null)
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
		getClipSelection: () => {
			const selectedClip = getSelectedClip()
			return selectedClip?.clipId && selectedClip?.timelineId
				? { timelineId: selectedClip.timelineId, layerIdx: selectedClip.layerIdx, clipId: selectedClip.clipId }
				: null
		},
		getFlagSelection: () => {
			const selectedFlagDetail = getSelectedFlagDetail()
			return selectedFlagDetail?.flagId && selectedFlagDetail?.timelineId
				? { timelineId: selectedFlagDetail.timelineId, flagId: selectedFlagDetail.flagId }
				: null
		},
		onLayerHeightsChange(timelineId, heights, isFinal) {
			timelineState.updateTimeline(timelineId, { layerHeights: heights })
			redrawTimelineView()
			if (isFinal) {
				const tl = timelineState.getTimeline(timelineId)
				void getSyncToServer()(tl)
			}
		},
	}
}

/**
 * @param {object} deps
 * @param {() => (tl: any) => Promise<void>} deps.getSyncToServer
 */
export function createShowLayerContextMenu(deps) {
	const { redrawTimelineView, getSyncToServer, getSelectedClip, setSelectedClip } = deps
	return function showLayerContextMenu(clientX, clientY, timelineId, layerIdx, layer) {
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
				void getSyncToServer()(timelineState.getActive())
				redrawTimelineView()
			}
			close()
		})
		menu.querySelector('[data-action="add"]').addEventListener('click', () => {
			timelineState.addLayer(timelineId, `Layer ${layerIdx + 2}`)
			void getSyncToServer()(timelineState.getActive())
			redrawTimelineView()
			close()
		})
		menu.querySelector('[data-action="remove"]').addEventListener('click', () => {
			if (confirm(`Remove "${layer.name || 'Layer ' + (layerIdx + 1)}" and all its clips?`)) {
				timelineState.removeLayer(timelineId, layerIdx)
				void getSyncToServer()(timelineState.getActive())
				redrawTimelineView()
				const sc = getSelectedClip()
				if (sc?.layerIdx === layerIdx) setSelectedClip(null)
				window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: null }))
			}
			close()
		})
		document.body.appendChild(menu)
		document.addEventListener('click', close, { once: true })
	}
}

/**
 * @param {object} deps
 * @param {() => (tl: any) => Promise<void>} deps.getSyncToServer
 */
export function attachTimelineEditorInput(root, bodyEl, deps) {
	const {
		stateStore,
		sceneState,
		getPlayback,
		getSelectedClip,
		setSelectedClip,
		getSelectedFlagDetail,
		setSelectedFlagDetail,
		getClipBoard,
		setClipBoard,
		getFlagBoard,
		setFlagBoard,
		redrawTimelineView,
		togglePlay,
	} = deps

	root.setAttribute('tabindex', '-1')
	root.addEventListener('keydown', (e) => {
		const inField = e.target.closest('input, textarea, select')
		const mod = (e.ctrlKey || e.metaKey) && !e.altKey
		const k = e.key.toLowerCase()

		if (!inField && mod && k === 'c') {
			const selectedClip = getSelectedClip()
			if (selectedClip?.clip) {
				e.preventDefault()
				setClipBoard({ layerIdx: selectedClip.layerIdx, clip: JSON.parse(JSON.stringify(selectedClip.clip)) })
				setFlagBoard(null)
				return
			}
			const selectedFlagDetail = getSelectedFlagDetail()
			if (selectedFlagDetail?.flag) {
				e.preventDefault()
				setFlagBoard(JSON.parse(JSON.stringify(selectedFlagDetail.flag)))
				setClipBoard(null)
				return
			}
		}
		if (!inField && mod && k === 'v') {
			const tl = timelineState.getActive()
			const _clipBoard = getClipBoard()
			const _flagBoard = getFlagBoard()
			if (tl && _clipBoard?.clip) {
				const li = Math.min(_clipBoard.layerIdx, tl.layers.length - 1)
				if (li >= 0) {
					e.preventDefault()
					const pb = getPlayback()
					const start = Math.round(pb.position)
					const dur = _clipBoard.clip.duration || 5000
					if (start + dur > tl.duration) {
						timelineState.updateTimeline(tl.id, { duration: start + dur + 2000 })
					}
					const newClip = timelineState.insertClipClone(tl.id, li, _clipBoard.clip, start)
					if (newClip) {
						const sel = { timelineId: tl.id, layerIdx: li, clipId: newClip.id, clip: newClip }
						setSelectedClip(sel)
						setSelectedFlagDetail(null)
						window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: null }))
						window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: sel }))
						void deps.getSyncToServer()(timelineState.getActive())
						redrawTimelineView()
						void (async () => {
							await applyTimelineClipLayoutFromMedia(newClip, timelineState, tl.id, li, newClip.id, stateStore, sceneState)
							void deps.getSyncToServer()(timelineState.getActive())
							redrawTimelineView()
						})()
					}
				}
			} else if (tl && _flagBoard) {
				e.preventDefault()
				const pb = getPlayback()
				const nf = timelineState.duplicateFlag(tl.id, _flagBoard, Math.round(pb.position))
				if (nf) {
					setSelectedClip(null)
					const fd = { timelineId: tl.id, flagId: nf.id, flag: nf }
					setSelectedFlagDetail(fd)
					window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: null }))
					window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: fd }))
					void deps.getSyncToServer()(timelineState.getActive())
					redrawTimelineView()
				}
			}
		}

		if (!inField && (e.key === 'Delete' || e.key === 'Backspace') && getSelectedFlagDetail()?.flagId) {
			e.preventDefault()
			const fd = getSelectedFlagDetail()
			timelineState.removeFlag(fd.timelineId, fd.flagId)
			setSelectedFlagDetail(null)
			window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: null }))
			void deps.getSyncToServer()(timelineState.getActive())
			redrawTimelineView()
			return
		}

		// Spacebar = play/pause regardless of selection
		if (e.key === ' ') {
			e.preventDefault()
			togglePlay()
			return
		}

		const selectedClip = getSelectedClip()
		if (!selectedClip) return
		const { timelineId, layerIdx, clipId, clip } = selectedClip
		if (!clip) return

		if (e.key === 'i') {
			e.preventDefault()
			// Fade in: opacity 0 at localTime=0, opacity 1 at localTime=500ms
			timelineState.clearKeyframeRange(timelineId, layerIdx, clipId, 'opacity', 0, 500)
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: 0, property: 'opacity', value: 0, easing: 'linear' })
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: 500, property: 'opacity', value: 1, easing: 'linear' })
			void deps.getSyncToServer()(timelineState.getActive())
			redrawTimelineView()
		}

		if (e.key === 'o') {
			e.preventDefault()
			// Fade out: opacity 1 at (duration-500ms), opacity 0 at duration
			const fadeStart = Math.max(0, clip.duration - 500)
			timelineState.clearKeyframeRange(timelineId, layerIdx, clipId, 'opacity', fadeStart, clip.duration + 1)
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: fadeStart, property: 'opacity', value: 1, easing: 'linear' })
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: clip.duration, property: 'opacity', value: 0, easing: 'linear' })
			void deps.getSyncToServer()(timelineState.getActive())
			redrawTimelineView()
		}

		// p = position keyframe (x,y), s = scale keyframe (locked), v = volume, t = opacity at current time
		if (e.key === 'p' || e.key === 's' || e.key === 'v' || e.key === 't') {
			e.preventDefault()
			const pb = getPlayback()
			const localMs = Math.max(0, Math.round(pb.position - clip.startTime))
			const time = Math.min(localMs, clip.duration)
			if (e.key === 'p') timelineState.addPositionKeyframe(timelineId, layerIdx, clipId, time, 0, 0)
			else if (e.key === 's') timelineState.addScaleKeyframe(timelineId, layerIdx, clipId, time, 1)
			else timelineState.addKeyframe(timelineId, layerIdx, clipId, { time, property: e.key === 'v' ? 'volume' : 'opacity', value: e.key === 'v' ? 1 : 1, easing: 'linear' })
			void deps.getSyncToServer()(timelineState.getActive())
			redrawTimelineView()
			window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: selectedClip }))
		}

		if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault()
			timelineState.removeClip(timelineId, layerIdx, clipId)
			setSelectedClip(null)
			void deps.getSyncToServer()(timelineState.getActive())
			redrawTimelineView()
		}
	})

	bodyEl.addEventListener('mouseup', () => {
		void deps.getSyncToServer()(timelineState.getActive())
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
}
