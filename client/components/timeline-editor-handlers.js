import { timelineState } from '../lib/timeline-state.js'
import { interpClipProp } from '../lib/timeline-clip-interp.js'
import { applyTimelineClipLayoutFromMedia } from '../lib/timeline-clip-layout.js'
import { findMediaRow } from '../lib/mixer-fill.js'
import { api, getApiBase } from '../lib/api-client.js'
import { getThumbnailUrl } from '../lib/thumbnail-url.js'
import { createEffectInstance } from '../lib/effect-registry.js'
import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { isLikelyAudioOnlySource } from '../lib/media-audio-kind.js'
export { attachTimelineEditorInput } from './timeline-editor-inputs.js'

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

/**
 * @param {object} source
 * @param {import('../lib/state-store.js').StateStore} stateStore
 */
async function resolveDroppedSourceDurationMs(source, stateStore) {
	let duration = 5000
	if (source?.type !== 'media' || !source?.value) return duration
	if (Number(source.durationMs) > 0) return Number(source.durationMs)
	const mediaList = stateStore.getState()?.media || []
	const match = findMediaRow(mediaList, source.value)
	if (match?.durationMs > 0) return match.durationMs
	try {
		const j = await api.post('/api/media/cinf', { id: source.value })
		if (j?.durationMs > 0) return j.durationMs
	} catch {
		/* fallback */
	}
	return duration
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
		getSelectedLayer,
		setSelectedLayer,
		getSelectedFlagDetail,
		setSelectedFlagDetail,
		redrawTimelineView,
		updateTimecode,
		getSyncToServer,
		notifyTimelineSeekFailed,
		getPreviewPanel,
		showLayerContextMenu,
		/** Reset RAF playhead clock after user seek while transport is playing. */
		syncPlayheadClock,
		maybeFollowPlayhead,
	} = deps

	let _seekThrottleLast = 0
	let _seekThrottleId = null

	function applySeekPosition(clamped) {
		const pb = getPlayback()
		pb.position = clamped
		if (typeof syncPlayheadClock === 'function') syncPlayheadClock(clamped)
		updateTimecode()
	}

	return {
		getTimeline: () => timelineState.getActive(),
		getPlayback,
		getView,
		onSeek(ms) {
			const tl = timelineState.getActive()
			if (!tl) return
			const clamped = Math.max(0, Math.min(ms, tl.duration))
			applySeekPosition(clamped)
			maybeFollowPlayhead?.()
			// During play, UI-only until mouseup — server CALL SEEK every 100ms stutters Caspar decode.
			if (getPlayback().playing) {
				redrawTimelineView()
				return
			}
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
			if (_seekThrottleId) { clearTimeout(_seekThrottleId); _seekThrottleId = null }
			const pb = getPlayback()
			const clamped = Math.max(0, Math.min(ms ?? pb.position, tl.duration))
			applySeekPosition(clamped)
			maybeFollowPlayhead?.()
			api.post(`/api/timelines/${tl.id}/seek`, { ms: clamped }).catch(notifyTimelineSeekFailed)
			redrawTimelineView()
		},
		onSelectClip(info) {
			setSelectedClip(info)
			if (info?.timelineId != null && typeof info.layerIdx === 'number') {
				const layer = timelineState.getTimeline(info.timelineId)?.layers?.[info.layerIdx]
				setSelectedLayer?.({ timelineId: info.timelineId, layerIdx: info.layerIdx, layer })
			}
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
				const duration = await resolveDroppedSourceDurationMs(source, stateStore)
				const tl = timelineState.getActive()
				if (!tl || tl.id !== tl0.id) return

				while (tl.layers.length <= layerIdx) {
					timelineState.addLayer(tl.id)
				}

				const existing = timelineState.findClipAtTime(tl.id, layerIdx, startTime)
				if (existing) {
					const clip = timelineState.replaceClipSource(
						tl.id,
						layerIdx,
						existing.id,
						source,
						duration,
					)
					if (!clip) return
					const sel = { timelineId: tl.id, layerIdx, clipId: clip.id, clip }
					setSelectedClip(sel)
					window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: sel }))
					void getSyncToServer()(timelineState.getActive())
					redrawTimelineView()
					return
				}

				if (startTime + duration > tl.duration) {
					timelineState.updateTimeline(tl.id, { duration: startTime + duration + 2000 })
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
		onMoveClip(layerIdx, clipId, newStartTime, targetLayerIdx) {
			const tl = timelineState.getActive()
			if (!tl) return
			const actualLayerIdx = targetLayerIdx != null ? targetLayerIdx : layerIdx
			if (targetLayerIdx != null && targetLayerIdx !== layerIdx) {
				timelineState.moveClipToLayer(tl.id, clipId, layerIdx, targetLayerIdx)
			}
			timelineState.updateClip(tl.id, actualLayerIdx, clipId, { startTime: newStartTime })
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
			if (!pb.playing) {
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
			}
			redrawTimelineView()
			getPreviewPanel()?.scheduleDraw?.()
		},
		getThumbnailUrl: (source) => source?.type === 'media' && source?.value
			? getThumbnailUrl(source.value, 320, 2)
			: null,
		// Real waveform from same tree as thumbnails (GET /api/local-media/.../waveform); server ffprobe path
		getWaveformUrl: (source, reqBars) => {
			if (source?.type !== 'media' || !source?.value) return null
			let bars = Number(reqBars)
			if (!(bars > 0)) {
				let durationMs = Number(source.durationMs)
				if (!(durationMs > 0)) {
					const mediaList = stateStore.getState()?.media || []
					const match = findMediaRow(mediaList, source.value)
					if (match?.durationMs > 0) durationMs = match.durationMs
				}
				const durationSec = durationMs > 0 ? durationMs / 1000 : 30
				const need = Math.ceil(durationSec * 40)
				if (need <= 512) bars = 512
				else if (need <= 2048) bars = 2048
				else bars = 8192
			}
			return `${getApiBase()}/api/local-media/${encodeURIComponent(source.value)}/waveform?bars=${bars}`
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
			setSelectedLayer?.({ timelineId, layerIdx, layer })
			setSelectedClip(null)
			setSelectedFlagDetail(null)
			window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: null }))
			window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: null }))
			window.dispatchEvent(new CustomEvent('timeline-layer-select', { detail: { timelineId, layerIdx, layer } }))
		},
		onAddLayer(timelineId, layerIdx) {
			timelineState.insertLayerBelow(timelineId, layerIdx)
			void getSyncToServer()(timelineState.getActive())
			redrawTimelineView()
		},
		onSelectKeyframe(info) {
			window.dispatchEvent(new CustomEvent('timeline-keyframe-select', { detail: info }))
		},
		onDblClickAddKeyframe({ timelineId, layerIdx, clipId, clip, localMs }) {
			const time = Math.max(0, Math.min(localMs, clip.duration || 0))
			const val = interpClipProp(clip, time, 'opacity', 1)
			timelineState.addKeyframe(timelineId, layerIdx, clipId, {
				time,
				property: 'opacity',
				value: val,
				easing: 'linear',
			})
			const sel = { timelineId, layerIdx, clipId, clip: timelineState.getTimeline(timelineId)?.layers?.[layerIdx]?.clips?.find((c) => c.id === clipId) || clip }
			setSelectedClip(sel)
			window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: sel }))
			void getSyncToServer()(timelineState.getActive())
			redrawTimelineView()
			showTimelineToast(`Opacity keyframe @ ${time}ms (double-click). Keys: P position, S scale, V volume, T opacity`, 'info')
		},
		onMoveKeyframe(timelineId, layerIdx, clipId, keyframeIdx, newTime) {
			timelineState.updateKeyframeTime(timelineId, layerIdx, clipId, keyframeIdx, newTime)
		},
		onKeyframeDragEnd(timelineId) {
			const tl = timelineState.getActive()
			if (!tl || tl.id !== timelineId) return
			void getSyncToServer()(tl).then(() => {
				const pb = getPlayback()
				api.post(`/api/timelines/${tl.id}/seek`, { ms: pb.position }).catch(notifyTimelineSeekFailed)
			})
		},
		onMoveLayer(fromIdx, toIdx) {
			const tl = timelineState.getActive()
			if (!tl) return
			timelineState.reorderLayer(tl.id, fromIdx, toIdx)
		},
		onLayerDragEnd(timelineId) {
			const tl = timelineState.getActive()
			if (!tl || tl.id !== timelineId) return
			void getSyncToServer()(tl)
		},
		onClipDragEnd(timelineId) {
			const tl = timelineState.getActive()
			if (!tl || tl.id !== timelineId) return
			void getSyncToServer()(tl)
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
			timelineState.insertLayerBelow(timelineId, layerIdx)
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


