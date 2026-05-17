'use strict'

import { timelineState } from '../lib/timeline-state.js'
import { applyTimelineClipLayoutFromMedia } from '../lib/timeline-clip-layout.js'
import { pixelsToNormalized } from '../lib/fill-math.js'
import { clipPixelRectAtLocalTime, interpClipProp } from '../lib/timeline-clip-interp.js'
import { api } from '../lib/api-client.js'

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

		if (!inField && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
			const tl = timelineState.getActive()
			if (tl) {
				e.preventDefault()
				const pb = getPlayback()
				const current = pb.position
				const edges = new Set([0, tl.duration || 0])
				for (const l of tl.layers || []) {
					for (const c of l.clips || []) {
						edges.add(c.startTime)
						edges.add(c.startTime + c.duration)
					}
				}
				const sorted = Array.from(edges).sort((a, b) => a - b)
				let targetMs = null
				if (e.key === 'ArrowRight') {
					targetMs = sorted.find((t) => t > current + 1)
				} else {
					targetMs = sorted.slice().reverse().find((t) => t < current - 1)
				}
				if (targetMs != null) {
					api.post(`/api/timelines/${encodeURIComponent(tl.id)}/seek`, { ms: targetMs }).catch(() => {})
				}
			}
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
			
			const screenIdx = timelineState.getActive()?.screenIdx ?? 0
			const res = stateStore.getState()?.channelMap?.programResolutions?.[screenIdx] || { w: 1920, h: 1080 }
			const W = res.w || 1920
			const H = res.h || 1080

			if (e.key === 'p') {
				const current = clipPixelRectAtLocalTime(clip, time, W, H, stateStore, screenIdx)
				timelineState.addPositionKeyframe(timelineId, layerIdx, clipId, time, pixelsToNormalized(current.x, W), pixelsToNormalized(current.y, H))
			} else if (e.key === 's') {
				const current = clipPixelRectAtLocalTime(clip, time, W, H, stateStore, screenIdx)
				timelineState.addScaleKeyframe(timelineId, layerIdx, clipId, time, current.w / W)
			} else if (e.key === 'v') {
				const val = interpClipProp(clip, time, 'volume', clip.volume ?? 1)
				timelineState.addKeyframe(timelineId, layerIdx, clipId, { time, property: 'volume', value: val, easing: 'linear' })
			} else if (e.key === 't') {
				const val = interpClipProp(clip, time, 'opacity', 1)
				timelineState.addKeyframe(timelineId, layerIdx, clipId, { time, property: 'opacity', value: val, easing: 'linear' })
			}
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
