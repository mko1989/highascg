import { timelineState } from '../lib/timeline-state.js'
import { api } from '../lib/api-client.js'
import { parseNumberInput } from '../lib/math-input.js'
import { createDragInput } from './inspector-common.js'
import {
	appendTimelineClipKeyframes,
	SCENE_CONTENT_FIT_OPTIONS,
} from './inspector-fill.js'
import { sceneState } from '../lib/scene-state.js'
import { getClipBasePixelRect } from '../lib/timeline-clip-interp.js'
import { fillToPixelRect, pixelRectToFill, fullFill, sceneLayerPixelRectForContentFit } from '../lib/fill-math.js'
import { getContentResolution, fetchMediaContentResolution } from '../lib/mixer-fill.js'
import { appendAudioInspectorGroup } from './inspector-mixer.js'
import { renderEffectsGroup } from './inspector-effects.js'

export async function syncTimelineToServer() {
	const tl = timelineState.getActive()
	if (!tl) return
	try {
		await api.put(`/api/timelines/${tl.id}`, tl)
	} catch {
		try { await api.post('/api/timelines', tl) } catch {}
	}
}

/**
 * @param {{
 *   root: HTMLElement,
 *   renderEmpty: () => void,
 *   onClearSelection: () => void,
 * }} deps
 */
export function renderTimelineFlagInspector(deps, timelineId, flagId) {
	const { root, renderEmpty, onClearSelection } = deps
	root.innerHTML = ''
	const tl = timelineState.getTimeline(timelineId)
	const flag = tl?.flags?.find((f) => f.id === flagId)
	if (!flag) {
		renderEmpty()
		return
	}
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = 'Timeline flag'
	root.appendChild(title)

	const grp = document.createElement('div')
	grp.className = 'inspector-group'
	grp.innerHTML = '<div class="inspector-group__title">Flag</div>'

	const labelWrap = document.createElement('div')
	labelWrap.className = 'inspector-field'
	const labelLab = document.createElement('label')
	labelLab.className = 'inspector-field__label'
	labelLab.textContent = 'Label'
	const labelInp = document.createElement('input')
	labelInp.type = 'text'
	labelInp.className = 'inspector-field__input'
	labelInp.value = flag.label || ''
	labelInp.addEventListener('change', () => {
		timelineState.updateFlag(timelineId, flagId, { label: labelInp.value.trim() })
		syncTimelineToServer()
	})
	labelLab.appendChild(labelInp)
	labelWrap.appendChild(labelLab)
	grp.appendChild(labelWrap)

	const typeWrap = document.createElement('div')
	typeWrap.className = 'inspector-field'
	const typeLab = document.createElement('label')
	typeLab.className = 'inspector-field__label'
	typeLab.textContent = 'Action'
	const typeSel = document.createElement('select')
	typeSel.className = 'inspector-field__select'
	typeSel.innerHTML =
		'<option value="pause">Pause</option><option value="play">Play (resume)</option><option value="jump">Jump to</option><option value="companion_press">Companion button press</option>'
	typeSel.value = flag.type || 'pause'
	typeSel.addEventListener('change', () => {
		timelineState.updateFlag(timelineId, flagId, { type: typeSel.value })
		syncTimelineToServer()
		renderTimelineFlagInspector(deps, timelineId, flagId)
	})
	typeLab.appendChild(typeSel)
	typeWrap.appendChild(typeLab)
	grp.appendChild(typeWrap)

	const timeWrap = document.createElement('div')
	timeWrap.className = 'inspector-field'
	const timeLab = document.createElement('label')
	timeLab.className = 'inspector-field__label'
	timeLab.textContent = 'Time (ms)'
	const timeInp = document.createElement('input')
	timeInp.type = 'text'
	timeInp.className = 'inspector-field__input inspector-math-input'
	timeInp.value = String(Math.round(flag.timeMs))
	timeInp.addEventListener('change', () => {
		const v = parseNumberInput(timeInp.value, flag.timeMs)
		const dur = tl?.duration ?? 999999
		timelineState.updateFlag(timelineId, flagId, { timeMs: Math.max(0, Math.min(v, dur)) })
		syncTimelineToServer()
		renderTimelineFlagInspector(deps, timelineId, flagId)
	})
	timeLab.appendChild(timeInp)
	timeWrap.appendChild(timeLab)
	grp.appendChild(timeWrap)

	const showJump = (flag.type || 'pause') === 'jump'
	const jumpWrap = document.createElement('div')
	jumpWrap.className = 'inspector-field'
	if (!showJump) jumpWrap.style.display = 'none'
	const jumpLab = document.createElement('label')
	jumpLab.className = 'inspector-field__label'
	jumpLab.textContent = 'Jump to time (ms)'
	const jumpInp = document.createElement('input')
	jumpInp.type = 'text'
	jumpInp.className = 'inspector-field__input inspector-math-input'
	jumpInp.value = flag.jumpTimeMs != null && Number.isFinite(flag.jumpTimeMs) ? String(flag.jumpTimeMs) : ''
	jumpInp.placeholder = 'optional'
	jumpInp.addEventListener('change', () => {
		const raw = jumpInp.value.trim()
		const v = raw === '' ? undefined : parseNumberInput(raw, 0)
		timelineState.updateFlag(timelineId, flagId, { jumpTimeMs: v })
		syncTimelineToServer()
	})
	jumpLab.appendChild(jumpInp)
	jumpWrap.appendChild(jumpLab)
	grp.appendChild(jumpWrap)

	const refWrap = document.createElement('div')
	refWrap.className = 'inspector-field'
	if (!showJump) refWrap.style.display = 'none'
	const refLab = document.createElement('label')
	refLab.className = 'inspector-field__label'
	refLab.textContent = 'Or jump to flag'
	const refSel = document.createElement('select')
	refSel.className = 'inspector-field__select'
	const other = (tl.flags || []).filter((f) => f.id !== flagId)
	refSel.innerHTML =
		'<option value="">—</option>' +
		other.map((f) => `<option value="${f.id}">${(f.label || f.type || 'flag') + ' @ ' + Math.round(f.timeMs) + 'ms'}</option>`).join('')
	refSel.value = flag.jumpFlagId || ''
	refSel.addEventListener('change', () => {
		timelineState.updateFlag(timelineId, flagId, { jumpFlagId: refSel.value || undefined })
		syncTimelineToServer()
	})
	refLab.appendChild(refSel)
	refWrap.appendChild(refLab)
	grp.appendChild(refWrap)

	const hint = document.createElement('p')
	hint.className = 'inspector-field inspector-field--hint'
	hint.textContent = 'For “Jump to”, set a time (ms) or pick another flag; time wins if both are set.'
	if (!showJump) hint.style.display = 'none'
	grp.appendChild(hint)

	const showCompanion = (flag.type || 'pause') === 'companion_press'

	const companionWrap = document.createElement('div')
	if (!showCompanion) companionWrap.style.display = 'none'

	const companionTitle = document.createElement('div')
	companionTitle.className = 'inspector-group__title'
	companionTitle.textContent = 'Companion Button'
	companionTitle.style.marginTop = '4px'
	companionWrap.appendChild(companionTitle)

	const makeNumField = (labelText, propName, defaultVal) => {
		const fw = document.createElement('div')
		fw.className = 'inspector-field'
		const fl = document.createElement('label')
		fl.className = 'inspector-field__label'
		fl.textContent = labelText
		const fi = document.createElement('input')
		fi.type = 'number'
		fi.className = 'inspector-field__input'
		fi.min = '0'
		fi.value = flag[propName] != null ? String(flag[propName]) : String(defaultVal)
		fi.addEventListener('change', () => {
			const v = parseInt(fi.value, 10)
			timelineState.updateFlag(timelineId, flagId, { [propName]: Number.isFinite(v) ? Math.max(0, v) : defaultVal })
			syncTimelineToServer()
		})
		fl.appendChild(fi)
		fw.appendChild(fl)
		return fw
	}
	companionWrap.appendChild(makeNumField('Page', 'companionPage', 1))
	companionWrap.appendChild(makeNumField('Row', 'companionRow', 0))
	companionWrap.appendChild(makeNumField('Column', 'companionColumn', 0))

	const companionHint = document.createElement('p')
	companionHint.className = 'inspector-field inspector-field--hint'
	companionHint.textContent = 'Sends POST to the configured Companion instance (see Settings > Companion tab).'
	companionWrap.appendChild(companionHint)
	grp.appendChild(companionWrap)

	const del = document.createElement('button')
	del.type = 'button'
	del.className = 'inspector-btn-sm'
	del.textContent = 'Remove flag'
	del.style.marginTop = '8px'
	del.addEventListener('click', () => {
		timelineState.removeFlag(timelineId, flagId)
		syncTimelineToServer()
		onClearSelection()
	})
	grp.appendChild(del)
	root.appendChild(grp)
}

/**
 * @param {{
 *   root: HTMLElement,
 *   stateStore: object,
 *   getTimelinePlaybackPos: () => number,
 * }} deps
 */
export function renderTimelineClipInspector(deps, timelineId, layerIdx, clipId, clip) {
	const { root, stateStore, getTimelinePlaybackPos } = deps
	if (!clip?.source?.value) return
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = clip.source?.label || clip.source?.value || 'Clip'
	root.appendChild(title)

	function freshClip() {
		const tl = timelineState.getTimeline(timelineId)
		const layer = tl?.layers?.[layerIdx]
		return layer?.clips?.find((c) => c.id === clipId) || clip
	}

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
		getAudio: () => {
			const c = freshClip()
			return {
				audioRoute: c.audioRoute || '1+2',
				muted: !!c.muted,
				volume: c.volume != null ? c.volume : 1,
			}
		},
		onPatch: (p) => {
			timelineState.updateClip(timelineId, layerIdx, clipId, p)
			syncTimelineToServer()
		},
	})

	function redrawClipInspector() {
		renderTimelineClipInspector(deps, timelineId, layerIdx, clipId, freshClip())
	}

	async function reapplyClipFrameForContentFit() {
		const c = freshClip()
		if (!c?.source?.value) return
		const cv = sceneState.getCanvasForScreen(sceneState.activeScreenIndex)
		const cw = cv.width > 0 ? cv.width : 1920
		const ch = cv.height > 0 ? cv.height : 1080
		const cr = await fetchMediaContentResolution(
			c.source,
			stateStore,
			sceneState.activeScreenIndex,
			() => api.get('/api/media'),
		)
		if (!cr?.w || !cr.h) return
		const fit = c.contentFit || 'native'
		const rect = sceneLayerPixelRectForContentFit(cw, ch, cr.w, cr.h, fit)
		timelineState.updateClip(timelineId, layerIdx, clipId, {
			fillPx: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
		})
		syncTimelineToServer()
		window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
		redrawClipInspector()
	}

	const transGrp = document.createElement('div')
	transGrp.className = 'inspector-group'
	transGrp.innerHTML = '<div class="inspector-group__title">Position / size (canvas px)</div>'
	const canvas = sceneState.getCanvasForScreen(sceneState.activeScreenIndex)
	function pxRectForClip() {
		const c = freshClip()
		const fp = c.fillPx
		if (fp && fp.w > 0 && fp.h > 0) {
			return { x: fp.x, y: fp.y, w: fp.w, h: fp.h }
		}
		return getClipBasePixelRect(c, canvas.width, canvas.height, stateStore, sceneState.activeScreenIndex)
	}
	function applyFillPx(partial) {
		const c = freshClip()
		const baseRect =
			c.fillPx && c.fillPx.w > 0 && c.fillPx.h > 0
				? { x: c.fillPx.x, y: c.fillPx.y, w: c.fillPx.w, h: c.fillPx.h }
				: getClipBasePixelRect(c, canvas.width, canvas.height, stateStore, sceneState.activeScreenIndex)
		const f = pixelRectToFill(
			{ x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h },
			canvas,
		)
		const r = fillToPixelRect(f, canvas)
		let next = { x: r.x, y: r.y, w: r.w, h: r.h, ...partial }
		if (c.aspectLocked !== false) {
			const cr = c.source ? getContentResolution(c.source, stateStore, sceneState.activeScreenIndex) : null
			const ar =
				cr && cr.w > 0 && cr.h > 0 ? cr.w / cr.h : r.w > 0 && r.h > 0 ? r.w / r.h : 16 / 9
			if (partial.w != null && partial.h == null) {
				next.h = Math.max(1, Math.round(next.w / ar))
			} else if (partial.h != null && partial.w == null) {
				next.w = Math.max(1, Math.round(next.h * ar))
			}
		}
		timelineState.updateClip(timelineId, layerIdx, clipId, {
			fillPx: { x: next.x, y: next.y, w: next.w, h: next.h },
		})
		syncTimelineToServer()
		window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
		redrawClipInspector()
	}
	const px = pxRectForClip()
	const xInp = createDragInput({
		label: 'X',
		value: Math.round(px.x),
		min: -999999,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => applyFillPx({ x: v }),
	})
	const yInp = createDragInput({
		label: 'Y',
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
	})

	renderEffectsGroup(root, {
		effects: clip.effects || [],
		onUpdate: (newEffects) => {
			timelineState.updateClip(timelineId, layerIdx, clipId, { effects: newEffects })
			syncTimelineToServer()
			redrawClipInspector()
		},
	})
}
