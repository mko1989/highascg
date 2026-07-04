'use strict'

import { timelineState } from '../lib/timeline-state.js'
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
 * Snap targets: timeline bounds, playhead, flag times, clip in/out edges.
 * @param {object} tl
 * @param {{ position?: number }|null|undefined} playback
 * @param {{ clipId?: string, flagId?: string }} [exclude]
 */
function buildTimelineSnapCandidates(tl, playback, exclude = {}) {
	const candidates = new Set([0, tl.duration || 0])
	const nowPointer = playback?.position
	if (nowPointer != null && Number.isFinite(nowPointer)) {
		candidates.add(Math.round(nowPointer))
	}
	for (const f of tl.flags || []) {
		if (exclude.flagId && f.id === exclude.flagId) continue
		candidates.add(Math.round(f.timeMs))
	}
	for (const layer of tl.layers || []) {
		for (const c of layer.clips || []) {
			if (exclude.clipId && c.id === exclude.clipId) continue
			candidates.add(Math.round(c.startTime))
			candidates.add(Math.round(c.startTime + (c.duration || 0)))
		}
	}
	return Array.from(candidates).sort((a, b) => a - b)
}

/** @param {number[]} candidates sorted ascending */
function prevSnapPoint(candidates, currentMs, epsilon = 1) {
	let best = null
	for (const t of candidates) {
		if (t < currentMs - epsilon) best = t
		else break
	}
	return best
}

/** @param {number[]} candidates sorted ascending */
function nextSnapPoint(candidates, currentMs, epsilon = 1) {
	for (const t of candidates) {
		if (t > currentMs + epsilon) return t
	}
	return null
}

/** @param {object} tl @param {{ layerIdx?: number }} clipBoard @param {() => { timelineId?: string, layerIdx?: number } | null | undefined} getSelectedLayer */
function resolvePasteLayerIdx(tl, clipBoard, getSelectedLayer) {
	const sel = getSelectedLayer?.()
	if (
		sel?.timelineId === tl.id &&
		typeof sel.layerIdx === 'number' &&
		sel.layerIdx >= 0 &&
		sel.layerIdx < tl.layers.length
	) {
		return sel.layerIdx
	}
	if (typeof clipBoard.layerIdx === 'number' && clipBoard.layerIdx >= 0) {
		return Math.min(clipBoard.layerIdx, tl.layers.length - 1)
	}
	return Math.max(0, tl.layers.length - 1)
}

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
		getSelectedLayer,
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
			const li = resolvePasteLayerIdx(tl, _clipBoard, getSelectedLayer)
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
			const current = Math.round(pb.position)
			const candidates = buildTimelineSnapCandidates(tl, pb)
			const target =
				e.key === 'ArrowRight' ? nextSnapPoint(candidates, current) : prevSnapPoint(candidates, current)
			if (target != null) {
				pb.position = target
				redrawTimelineView()
				api.post(`/api/timelines/${encodeURIComponent(tl.id)}/seek`, { ms: target }).catch(() => {})
			}
		}
		return
	}

	if (!inField && e.altKey && !e.shiftKey && !mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
		const tl = timelineState.getActive()
		if (!tl) return
		const pb = getPlayback()
		const flagSel = getSelectedFlagDetail()
		const clipSel = freshClipSelection(getSelectedClip)

		if (flagSel?.flagId && flagSel.timelineId === tl.id) {
			const flag = tl.flags?.find((f) => f.id === flagSel.flagId)
			if (!flag) return
			const candidates = buildTimelineSnapCandidates(tl, pb, { flagId: flag.id })
			const current = Math.round(flag.timeMs)
			const target =
				e.key === 'ArrowRight' ? nextSnapPoint(candidates, current) : prevSnapPoint(candidates, current)
			if (target == null) return
			e.preventDefault()
			const clamped = Math.max(0, Math.min(target, tl.duration || 0))
			timelineState.updateFlag(tl.id, flag.id, { timeMs: clamped })
			const updated = timelineState.getTimeline(tl.id)?.flags?.find((f) => f.id === flag.id) || {
				...flag,
				timeMs: clamped,
			}
			const fd = { timelineId: tl.id, flagId: flag.id, flag: updated }
			setSelectedFlagDetail(fd)
			window.dispatchEvent(new CustomEvent('timeline-flag-select', { detail: fd }))
			void getSyncToServer()(tl)
			redrawTimelineView()
			return
		}

		if (clipSel && clipSel.timelineId === tl.id) {
			const { timelineId, layerIdx, clipId, clip } = clipSel
			const candidates = buildTimelineSnapCandidates(tl, pb, { clipId })
			const current = Math.round(clip.startTime)
			const target =
				e.key === 'ArrowRight' ? nextSnapPoint(candidates, current) : prevSnapPoint(candidates, current)
			if (target == null) return
			e.preventDefault()
			const maxStart = Math.max(0, (tl.duration || 0) - (clip.duration || 0))
			const newStart = Math.max(0, Math.min(target, maxStart))
			timelineState.updateClip(timelineId, layerIdx, clipId, { startTime: newStart })
			void getSyncToServer()(tl)
			redrawTimelineView()
			const refreshed = freshClipSelection(getSelectedClip)
			if (refreshed) {
				setSelectedClip(refreshed)
				window.dispatchEvent(new CustomEvent('timeline-clip-select', { detail: refreshed }))
			}
			return
		}
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
