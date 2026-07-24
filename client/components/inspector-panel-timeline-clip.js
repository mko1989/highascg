import { timelineState } from '../lib/timeline-state.js'
import { api } from '../lib/api-client.js'
import { createDragInput } from './inspector-common.js'
import { applyFillPxPatch, alignStoredPxRect, displayPositionFromStoredPx, fillInspectorPositionMeta } from '../lib/coordinate-origin.js'
import { SCENE_CONTENT_FIT_OPTIONS } from '../lib/scene-content-fit.js'
import { appendLayerAlignButtons } from './inspector-fill.js'
import { appendTimelineClipKeyframes } from './inspector-fill-timeline.js'
import { sceneState } from '../lib/scene-state.js'
import { getClipBasePixelRect } from '../lib/timeline-clip-interp.js'
import { sceneLayerPixelRectForContentFit } from '../lib/fill-math.js'
import { getContentResolution, fetchMediaContentResolution } from '../lib/mixer-fill.js'
import { getTimelineProgramCanvas } from '../lib/timeline-program-canvas.js'
import { settingsState } from '../lib/settings-state.js'
import { appendAudioInspectorGroup } from './inspector-mixer.js'
import { renderEffectsGroup } from './inspector-effects.js'
import { appendTimelineInspectorPosition, syncTimelineToServer } from './inspector-panel-timeline-shared.js'

/**
 * @param {{
 *   root: HTMLElement,
 *   stateStore: object,
 *   getTimelinePlaybackPos: () => number,
 * }} deps
 */
export function renderTimelineClipInspector(deps, timelineId, layerIdx, clipId, clip) {
	const { root, stateStore, getTimelinePlaybackPos } = deps
	root.innerHTML = ''

	const layerNum = layerIdx + 1
	const mediaLabel = clip?.source?.label || clip?.source?.value || 'Clip'
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `${mediaLabel} · Layer ${layerNum}`
	root.appendChild(title)

	// Title renders before this guard so a clip whose source has not resolved yet still shows a
	// labelled panel with a hint, never a completely blank inspector.
	if (!clip?.source?.value) {
		const note = document.createElement('p')
		note.className = 'inspector-field inspector-field--hint'
		note.textContent = 'This clip has no resolved media source yet.'
		root.appendChild(note)
		return
	}

	function freshClip() {
		const tl = timelineState.getTimeline(timelineId)
		const layer = tl?.layers?.[layerIdx]
		return layer?.clips?.find((c) => c.id === clipId) || clip
	}

	function redrawClipInspector() {
		renderTimelineClipInspector(deps, timelineId, layerIdx, clipId, freshClip())
	}

	const tl = timelineState.getTimeline(timelineId)
	const fps = tl?.fps || 25
	const dur = tl?.duration ?? 999999
	appendTimelineInspectorPosition(root, {
		timeMs: freshClip().startTime ?? 0,
		fps,
		maxMs: dur,
		onCommit: (ms) => {
			timelineState.updateClip(timelineId, layerIdx, clipId, { startTime: ms })
			syncTimelineToServer()
			window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
			redrawClipInspector()
		},
	})

	const grp = document.createElement('div')
	grp.className = 'inspector-group'
	grp.innerHTML = '<div class="inspector-group__title">Clip</div>'

	const loopWrap = document.createElement('div')
	loopWrap.className = 'inspector-field'
	const loopLab = document.createElement('label')
	loopLab.className = 'inspector-field__label'
	loopLab.textContent = 'Loop always'
	const loopCheck = document.createElement('input')
	loopCheck.type = 'checkbox'
	const loopSnap = freshClip()
	loopCheck.checked = !!(loopSnap.loopAlways || loopSnap.loop)
	loopCheck.title =
		'Loop this clip on the layer while the playhead is on it, including when the timeline is paused (Caspar LOOP).'
	loopCheck.addEventListener('change', () => {
		const on = loopCheck.checked
		timelineState.updateClip(timelineId, layerIdx, clipId, { loopAlways: on, loop: false })
		syncTimelineToServer()
	})
	loopLab.appendChild(loopCheck)
	loopWrap.appendChild(loopLab)
	grp.appendChild(loopWrap)

	root.appendChild(grp)

	appendAudioInspectorGroup(root, {
		showStoredRoute: true,
		mainIndex: timelineState.getSendTo(timelineId).screenIdx,
		channelMap: stateStore.getState()?.channelMap ?? settingsState.getSettings()?.channelMap ?? null,
		getAudio: () => {
			const c = freshClip()
			return {
				audioRoute: c.audioRoute || '1+2',
				muted: !!c.muted,
				volume: c.volume != null ? c.volume : 1,
			}
		},
		onPatch: async (p) => {
			timelineState.updateClip(timelineId, layerIdx, clipId, p)
			await syncTimelineToServer()
			if (p.audioRoute != null) {
				const pb = stateStore.getState()?.timeline?.playback
				const active =
					pb?.timelineId === timelineId ||
					(!pb?.timelineId && timelineState.getActive()?.id === timelineId)
				if (active) {
					const ms = Math.max(
						0,
						Math.round(pb?.position ?? getTimelinePlaybackPos?.() ?? 0),
					)
					await api
						.post(`/api/timelines/${encodeURIComponent(timelineId)}/seek`, { ms })
						.catch(() => {})
				}
			}
		},
	})

	async function reapplyClipFrameForContentFit() {
		const c = freshClip()
		if (!c?.source?.value) return
		const cv = getTimelineProgramCanvas(timelineId, sceneState, stateStore)
		const cw = cv.width > 0 ? cv.width : 1920
		const ch = cv.height > 0 ? cv.height : 1080
		const screenIdx = cv.screenIdx ?? 0
		const cr = await fetchMediaContentResolution(
			c.source,
			stateStore,
			screenIdx,
			() => api.get('/api/media'),
		)
		if (!cr?.w || !cr.h) return
		const fit = c.contentFit || 'native'
		const rect = sceneLayerPixelRectForContentFit(cw, ch, cr.w, cr.h, fit)
		clearClipTransformKeyframes()
		timelineState.updateClip(timelineId, layerIdx, clipId, {
			fillPx: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
		})
		await refreshTimelineClipGeometryOnServer()
		window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
		redrawClipInspector()
	}

	const canvas = getTimelineProgramCanvas(timelineId, sceneState, stateStore)
	const programScreenIdx = canvas.screenIdx ?? 0

	async function refreshTimelineClipGeometryOnServer() {
		await syncTimelineToServer()
		const pb = stateStore.getState()?.timeline?.playback
		const active =
			pb?.timelineId === timelineId ||
			(!pb?.timelineId && timelineState.getActive()?.id === timelineId)
		if (active) {
			const ms = Math.max(
				0,
				Math.round(pb?.position ?? getTimelinePlaybackPos?.() ?? 0),
			)
			await api
				.post(`/api/timelines/${encodeURIComponent(timelineId)}/seek`, { ms })
				.catch(() => {})
		}
	}

	function clearClipTransformKeyframes() {
		for (const prop of ['fill_x', 'fill_y', 'scale_x', 'scale_y']) {
			timelineState.clearKeyframesByProperty(timelineId, layerIdx, clipId, prop)
		}
	}
	function pxRectForClip() {
		const c = freshClip()
		const fp = c.fillPx
		if (fp && fp.w > 0 && fp.h > 0) {
			return { x: fp.x, y: fp.y, w: fp.w, h: fp.h }
		}
		return getClipBasePixelRect(c, canvas.width, canvas.height, stateStore, programScreenIdx)
	}
	function applyFillPx(partial) {
		const c = freshClip()
		const stored = pxRectForClip()
		let next = applyFillPxPatch({ ...stored }, partial, canvas)
		if (c.aspectLocked !== false) {
			const cr = c.source ? getContentResolution(c.source, stateStore, programScreenIdx) : null
			const ar =
				cr && cr.w > 0 && cr.h > 0 ? cr.w / cr.h : stored.w > 0 && stored.h > 0 ? stored.w / stored.h : 16 / 9
			if (partial.w != null && partial.h == null) {
				next.h = Math.max(1, Math.round(next.w / ar))
			} else if (partial.h != null && partial.w == null) {
				next.w = Math.max(1, Math.round(next.h * ar))
			}
		}
		clearClipTransformKeyframes()
		timelineState.updateClip(timelineId, layerIdx, clipId, {
			fillPx: { x: next.x, y: next.y, w: next.w, h: next.h },
		})
		void refreshTimelineClipGeometryOnServer()
		window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
		redrawClipInspector()
	}
	function patchFillAlign(mode) {
		const next = alignStoredPxRect(pxRectForClip(), canvas, mode)
		clearClipTransformKeyframes()
		timelineState.updateClip(timelineId, layerIdx, clipId, { fillPx: next })
		void refreshTimelineClipGeometryOnServer()
		window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
		redrawClipInspector()
	}

	const posMeta = fillInspectorPositionMeta()
	const transGrp = document.createElement('div')
	transGrp.className = 'inspector-group'
	transGrp.innerHTML = `<div class="inspector-group__title">${posMeta.title}</div>`
	if (posMeta.subtitle) {
		const sub = document.createElement('p')
		sub.className = 'inspector-field inspector-field--hint'
		sub.style.fontSize = '0.78rem'
		sub.textContent = posMeta.subtitle
		transGrp.appendChild(sub)
	}
	appendLayerAlignButtons(transGrp, patchFillAlign)
	const pxStored = pxRectForClip()
	const px = displayPositionFromStoredPx(pxStored, canvas)
	const xInp = createDragInput({
		label: posMeta.xLabel,
		value: Math.round(px.x),
		min: -999999,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => applyFillPx({ x: v }),
	})
	const yInp = createDragInput({
		label: posMeta.yLabel,
		value: Math.round(px.y),
		min: -999999,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => applyFillPx({ y: v }),
	})
	const wInp = createDragInput({
		label: 'Width',
		value: Math.max(1, Math.round(px.w)),
		min: 1,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => applyFillPx({ w: Math.max(1, v) }),
	})
	const hInp = createDragInput({
		label: 'Height',
		value: Math.max(1, Math.round(px.h)),
		min: 1,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => applyFillPx({ h: Math.max(1, v) }),
	})
	transGrp.appendChild(xInp.wrap)
	transGrp.appendChild(yInp.wrap)
	transGrp.appendChild(wInp.wrap)
	transGrp.appendChild(hInp.wrap)
	const tlAspectLockWrap = document.createElement('div')
	tlAspectLockWrap.className = 'inspector-field inspector-row'
	const tlAspectLockCb = document.createElement('input')
	tlAspectLockCb.type = 'checkbox'
	tlAspectLockCb.id = 'inspector-timeline-clip-aspect-lock'
	tlAspectLockCb.checked = freshClip().aspectLocked !== false
	const tlAspectLockLab = document.createElement('label')
	tlAspectLockLab.htmlFor = 'inspector-timeline-clip-aspect-lock'
	tlAspectLockLab.textContent = 'Aspect lock'
	tlAspectLockCb.addEventListener('change', () => {
		timelineState.updateClip(timelineId, layerIdx, clipId, { aspectLocked: tlAspectLockCb.checked })
		syncTimelineToServer()
		redrawClipInspector()
	})
	tlAspectLockWrap.appendChild(tlAspectLockCb)
	tlAspectLockWrap.appendChild(tlAspectLockLab)
	transGrp.appendChild(tlAspectLockWrap)

	const fitWrap = document.createElement('div')
	fitWrap.className = 'inspector-field'
	const fitLab = document.createElement('label')
	fitLab.className = 'inspector-field__label'
	fitLab.textContent = 'Content sizing'
	const fitSel = document.createElement('select')
	fitSel.className = 'inspector-field__select'
	fitSel.setAttribute('aria-label', 'Content sizing')
	const curFit = freshClip().contentFit || 'native'
	for (const o of SCENE_CONTENT_FIT_OPTIONS) {
		const opt = document.createElement('option')
		opt.value = o.value
		opt.textContent = o.label
		if (o.value === curFit) opt.selected = true
		fitSel.appendChild(opt)
	}
	fitSel.addEventListener('change', () => {
		timelineState.updateClip(timelineId, layerIdx, clipId, {
			contentFit: /** @type {'native' | 'fill-canvas' | 'horizontal' | 'vertical' | 'stretch'} */ (fitSel.value),
		})
		syncTimelineToServer()
		void reapplyClipFrameForContentFit()
	})
	fitLab.appendChild(fitSel)
	fitWrap.appendChild(fitLab)
	transGrp.appendChild(fitWrap)

	const tfHint = document.createElement('p')
	tfHint.className = 'inspector-field inspector-field--hint'
	tfHint.style.fontSize = '0.78rem'
	tfHint.style.color = 'var(--text-muted)'
	tfHint.textContent =
		'Applies to the whole clip (program canvas pixels). Use keyframes below only when you need motion over time.'
	transGrp.appendChild(tfHint)
	root.appendChild(transGrp)

	// Mixer — base opacity for the clip. The timeline playback engine reads clip.opacity as the hold
	// value under any opacity keyframes (mirrors clip.volume) — see
	// src/engine/timeline-playback-amcp-schedule.js. Unset/1 renders exactly as before.
	const mixGrp = document.createElement('div')
	mixGrp.className = 'inspector-group'
	mixGrp.innerHTML = '<div class="inspector-group__title">Mixer</div>'
	const opPct = Math.max(0, Math.min(100, Math.round((freshClip().opacity ?? 1) * 100)))
	const opInp = createDragInput({
		label: 'Opacity %',
		value: opPct,
		min: 0,
		max: 100,
		step: 1,
		decimals: 0,
		onChange: (v) => {
			timelineState.updateClip(timelineId, layerIdx, clipId, { opacity: Math.max(0, Math.min(1, v / 100)) })
			void refreshTimelineClipGeometryOnServer()
			window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
		},
	})
	mixGrp.appendChild(opInp.wrap)
	const opHint = document.createElement('p')
	opHint.className = 'inspector-field inspector-field--hint'
	opHint.style.fontSize = '0.78rem'
	opHint.style.color = 'var(--text-muted)'
	opHint.textContent = 'Base opacity for the whole clip. Opacity keyframes (below) override it over time. Blend mode and chroma/keyer live in Effects.'
	mixGrp.appendChild(opHint)
	root.appendChild(mixGrp)

	// Trim — in-point (frames into the source file). Honored by the transport: added to the seek frame
	// in resolveTimelineClipFrame (src/engine/scene-play-seek.js). The clip's out bound is its timeline
	// duration; a separate out-point is not yet applied server-side.
	const trimGrp = document.createElement('div')
	trimGrp.className = 'inspector-group'
	trimGrp.innerHTML = '<div class="inspector-group__title">Trim</div>'
	const inFrames = Math.max(0, Math.round(Number(freshClip().inPoint) || 0))
	const inInp = createDragInput({
		label: 'In-point (frames)',
		value: inFrames,
		min: 0,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => {
			timelineState.updateClip(timelineId, layerIdx, clipId, { inPoint: Math.max(0, Math.round(v)) })
			void refreshTimelineClipGeometryOnServer()
		},
	})
	trimGrp.appendChild(inInp.wrap)
	const inHint = document.createElement('p')
	inHint.className = 'inspector-field inspector-field--hint'
	inHint.style.fontSize = '0.78rem'
	inHint.style.color = 'var(--text-muted)'
	inHint.textContent = `Frames skipped from the start of the media on take/seek (at ${fps} fps).`
	trimGrp.appendChild(inHint)
	root.appendChild(trimGrp)

	const takeGrp = document.createElement('div')
	takeGrp.className = 'inspector-group'
	takeGrp.innerHTML = '<div class="inspector-group__title">Look take (playback)</div>'
	const startWrap = document.createElement('div')
	startWrap.className = 'inspector-field'
	const startLab = document.createElement('label')
	startLab.className = 'inspector-field__label'
	startLab.textContent = 'Start behaviour'
	const startSel = document.createElement('select')
	startSel.className = 'inspector-field__select'
	startSel.setAttribute('aria-label', 'Media start when taking this look to program')
	startSel.innerHTML =
		'<option value="beginning">Start from beginning (trim)</option>' +
		'<option value="relativeToPrevious">Relative to timeline (layer)</option>'
	const sbClip = freshClip().startBehaviour || 'beginning'
	startSel.value = sbClip === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning'
	startSel.addEventListener('change', () => {
		timelineState.updateClip(timelineId, layerIdx, clipId, {
			startBehaviour: startSel.value === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning',
		})
		syncTimelineToServer()
		redrawClipInspector()
	})
	startLab.appendChild(startSel)
	startWrap.appendChild(startLab)
	const startHint = document.createElement('p')
	startHint.className = 'inspector-field inspector-field--hint'
	startHint.style.fontSize = '0.78rem'
	startHint.style.color = 'var(--text-muted)'
	startHint.textContent =
		'Relative: on take, seek to the same position in the file as the timeline playhead on this layer (in-point + elapsed).'
	startWrap.appendChild(startHint)
	takeGrp.appendChild(startWrap)
	root.appendChild(takeGrp)

	appendTimelineClipKeyframes(root, {
		timelineId, layerIdx, clipId, clip,
		syncTimelineToServer,
		getTimelinePlaybackPos,
		redrawClipInspector,
		stateStore,
	})

	/* Crop is edited in pixels of the clip's content resolution (fallback: program canvas) — WO-158 T158.4. */
	const effectContentRes =
		(clip.source ? getContentResolution(clip.source, stateStore, programScreenIdx) : null) || {
			w: canvas.width,
			h: canvas.height,
		}

	renderEffectsGroup(root, {
		effects: clip.effects || [],
		contentResolution: effectContentRes,
		liveApplyContext: {
			kind: 'timeline_clip',
			stateStore: deps.stateStore,
			timelineId,
			layerIdx,
			clipId,
			clip,
		},
		onUpdate: (newEffects) => {
			timelineState.updateClip(timelineId, layerIdx, clipId, { effects: newEffects })
			syncTimelineToServer()
			redrawClipInspector()
		},
	})
}
