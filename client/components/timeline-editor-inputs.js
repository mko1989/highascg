'use strict'

import { timelineState } from '../lib/timeline-state.js'
import { applyTimelineClipLayoutFromMedia } from '../lib/timeline-clip-layout.js'
import { pixelsToNormalized } from '../lib/fill-math.js'
import { clipPixelRectAtLocalTime, interpClipProp } from '../lib/timeline-clip-interp.js'
import { api } from '../lib/api-client.js'

/** Clip keyframe shortcuts — work from timeline canvas or inspector fields. */
const CLIP_KEYFRAME_KEYS = new Set(['i', 'o', 'p', 's', 'v', 't'])

function isTimelineTabActive() {
	const tab = document.getElementById('tab-timeline')
	return !!tab?.classList?.contains('active')
}

/**
 * @param {ReturnType<typeof import('../lib/timeline-state.js').timelineState.getTimeline>} getSel
 */
function freshClipSelection(getSelectedClip) {
	const sel = getSelectedClip()
	if (!sel?.timelineId || sel.clipId == null || typeof sel.layerIdx !== 'number') return null
	const clip = timelineState
		.getTimeline(sel.timelineId)
		?.layers?.[sel.layerIdx]
		?.clips?.find((c) => c.id === sel.clipId)
	if (!clip) return null
	return { ...sel, clip }
}

/**
 * @param {KeyboardEvent} e
 * @param {object} deps
 */
function handleTimelineEditorKeydown(e, deps) {
	if (!isTimelineTabActive()) return

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
		getSyncToServer,
	} = deps

	const inField = !!e.target.closest('input, textarea, select')
	const mod = (e.ctrlKey || e.metaKey) && !e.altKey
	const k = e.key.length === 1 ? e.key.toLowerCase() : e.key

	if (mod && k === 'c') {
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
	if (mod && k === 'v') {
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
					void getSyncToServer()(timelineState.getActive())
					redrawTimelineView()
					void (async () => {
						await applyTimelineClipLayoutFromMedia(newClip, timelineState, tl.id, li, newClip.id, stateStore, sceneState)
						void getSyncToServer()(timelineState.getActive())
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
				void getSyncToServer()(timelineState.getActive())
				redrawTimelineView()
			}
		}
		return
	}

	if (!inField && (e.key === 'Delete' || e.key === 'Backspace') && getSelectedFlagDetail()?.flagId) {
		e.preventDefault()
		const fd = getSelectedFlagDetail()
		timelineState.removeFlag(fd.timelineId, fd.flagId)
		setSelectedFlagDetail(null)
		window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: null }))
		void getSyncToServer()(timelineState.getActive())
		redrawTimelineView()
		return
	}

	if (e.key === ' ') {
		e.preventDefault()
		togglePlay()
		return
	}

	if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
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

	if (!inField && !e.shiftKey && !mod && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
		const canvas = document.querySelector('.tl-canvas')
		const lastClicked = canvas?.dataset?.lastClicked
		const selected = freshClipSelection(getSelectedClip)

		if (selected && lastClicked !== 'ruler') {
			e.preventDefault()
			const { timelineId, layerIdx, clipId, clip } = selected
			const tl = timelineState.getTimeline(timelineId)
			if (tl) {
				const fps = tl.fps || 25
				const frameMs = 1000 / fps
				let newStartTime = clip.startTime
				if (e.key === 'ArrowRight') {
					newStartTime = Math.min(tl.duration - clip.duration, newStartTime + frameMs)
				} else {
					newStartTime = Math.max(0, newStartTime - frameMs)
				}
				timelineState.updateClip(timelineId, layerIdx, clipId, { startTime: newStartTime })
				void getSyncToServer()(timelineState.getActive())
				redrawTimelineView()

				const refreshed = freshClipSelection(getSelectedClip)
				if (refreshed) {
					setSelectedClip(refreshed)
					window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: refreshed }))
				}
			}
			return
		}

		if (lastClicked === 'ruler') {
			const tl = timelineState.getActive()
			if (tl) {
				e.preventDefault()
				const fps = tl.fps || 25
				const frameMs = 1000 / fps
				const pb = getPlayback()
				let targetMs = pb.position
				if (e.key === 'ArrowRight') {
					targetMs = Math.min(tl.duration || 0, targetMs + frameMs)
				} else {
					targetMs = Math.max(0, targetMs - frameMs)
				}
				pb.position = targetMs
				api.post(`/api/timelines/${encodeURIComponent(tl.id)}/seek`, { ms: targetMs }).catch(() => {})
				redrawTimelineView()
			}
			return
		}
	}

	const selected = freshClipSelection(getSelectedClip)
	if (!selected) return
	const { timelineId, layerIdx, clipId, clip } = selected

	// I/O/P/S/V/T — also when typing in inspector (operator sets X/Y then hits P without re-focusing timeline).
	if (CLIP_KEYFRAME_KEYS.has(k) && !mod && !e.altKey) {
		e.preventDefault()

		if (k === 'i') {
			timelineState.clearKeyframeRange(timelineId, layerIdx, clipId, 'opacity', 0, 500)
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: 0, property: 'opacity', value: 0, easing: 'linear' })
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: 500, property: 'opacity', value: 1, easing: 'linear' })
		} else if (k === 'o') {
			const fadeStart = Math.max(0, clip.duration - 500)
			timelineState.clearKeyframeRange(timelineId, layerIdx, clipId, 'opacity', fadeStart, clip.duration + 1)
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: fadeStart, property: 'opacity', value: 1, easing: 'linear' })
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: clip.duration, property: 'opacity', value: 0, easing: 'linear' })
		} else {
			const pb = getPlayback()
			const localMs = Math.max(0, Math.round(pb.position - clip.startTime))
			const time = Math.min(localMs, clip.duration)
			const screenIdx = timelineState.getActive()?.screenIdx ?? 0
			const res = stateStore.getState()?.channelMap?.programResolutions?.[screenIdx] || { w: 1920, h: 1080 }
			const W = res.w || 1920
			const H = res.h || 1080

			if (k === 'p') {
				const current = clipPixelRectAtLocalTime(clip, time, W, H, stateStore, screenIdx)
				timelineState.addPositionKeyframe(
					timelineId,
					layerIdx,
					clipId,
					time,
					pixelsToNormalized(current.x, W),
					pixelsToNormalized(current.y, H),
				)
			} else if (k === 's') {
				const current = clipPixelRectAtLocalTime(clip, time, W, H, stateStore, screenIdx)
				timelineState.addScaleKeyframe(timelineId, layerIdx, clipId, time, current.w / W)
			} else if (k === 'v') {
				const val = interpClipProp(clip, time, 'volume', clip.volume ?? 1)
				timelineState.addKeyframe(timelineId, layerIdx, clipId, { time, property: 'volume', value: val, easing: 'linear' })
			} else if (k === 't') {
				const val = interpClipProp(clip, time, 'opacity', 1)
				timelineState.addKeyframe(timelineId, layerIdx, clipId, { time, property: 'opacity', value: val, easing: 'linear' })
			}
		}

		void getSyncToServer()(timelineState.getActive())
		redrawTimelineView()
		const refreshed = freshClipSelection(getSelectedClip)
		if (refreshed) {
			setSelectedClip(refreshed)
			window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: refreshed }))
		}
		return
	}

	if (!inField && (e.key === 'Delete' || e.key === 'Backspace')) {
		e.preventDefault()
		timelineState.removeClip(timelineId, layerIdx, clipId)
		setSelectedClip(null)
		void getSyncToServer()(timelineState.getActive())
		redrawTimelineView()
	}
}

/**
 * @param {HTMLElement} root
 * @param {HTMLElement} bodyEl
 * @param {object} deps
 * @returns {{ destroy: () => void }}
 */
export function attachTimelineEditorInput(root, bodyEl, deps) {
	root.setAttribute('tabindex', '-1')

	const onKeydown = (e) => handleTimelineEditorKeydown(e, deps)
	document.addEventListener('keydown', onKeydown, true)

	root.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter' || e.defaultPrevented) return
		const tcCur = document.getElementById('tl-tc-cur')
		const tab = document.getElementById('tab-timeline')
		if (!tcCur || !tab?.classList?.contains('active')) return
		tcCur.focus()
		tcCur.select()
		e.preventDefault()
	})

	return {
		destroy() {
			document.removeEventListener('keydown', onKeydown, true)
		},
	}
}
