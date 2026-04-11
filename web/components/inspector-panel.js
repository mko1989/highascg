/** Inspector panel — selected item properties. @see main_plan.md Prompt 14 */

import { dashboardState, dashboardCasparLayer } from '../lib/dashboard-state.js'
import { sceneState } from '../lib/scene-state.js'
import { fillToPixelRect, pixelRectToFill, fullFill, sceneLayerPixelRectForContentFit } from '../lib/fill-math.js'
import { api } from '../lib/api-client.js'
import { multiviewState } from '../lib/multiview-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { calcMixerFill, getContentResolution, fetchMediaContentResolution } from '../lib/mixer-fill.js'
import { scheduleSelectionSync } from '../lib/selection-sync.js'
import { getClipBasePixelRect } from '../lib/timeline-clip-interp.js'
import { createDragInput } from './inspector-common.js'
import {
	appendSceneLayerFillGroup, appendDashboardLayerFillGroup, appendMultiviewPositionSize, appendTimelineClipKeyframes,
	SCENE_CONTENT_FIT_OPTIONS,
} from './inspector-fill.js'
import {
	appendSceneLayerMixerGroup,
	appendDashboardLayerMixerAndStretch,
	appendAudioInspectorGroup,
	renderTimelineLayerInspector,
} from './inspector-mixer.js'
import { appendDashboardClipTransitionOverride } from './inspector-transition.js'
import { settingsState } from '../lib/settings-state.js'
import { parseNumberInput } from '../lib/math-input.js'

/** @deprecated import from ../lib/mixer-fill.js */
export { calcMixerFill, getContentResolution }

/**
 * @param {HTMLElement} root
 * @param {object} stateStore
 */
export function initInspectorPanel(root, stateStore) {
	let selection = null
	let _timelinePlaybackPos = 0
	stateStore.on('timeline.tick', (data) => {
		if (data?.position != null) _timelinePlaybackPos = data.position
		if (selection?.type === 'timelineClip') scheduleSelectionSync(stateStore, selection)
	})
	stateStore.on('timeline.playback', (pb) => {
		if (pb?.position != null) _timelinePlaybackPos = pb.position
		if (selection?.type === 'timelineClip') scheduleSelectionSync(stateStore, selection)
	})

	function getProgramChannel() {
		const s = dashboardState.activeScreenIndex
		return getProgramChannelForColumn(s)
	}

	function getProgramChannelForColumn(colIdx) {
		const state = stateStore.getState()
		const ch = state?.channelMap?.programChannels?.[colIdx]
		return ch != null ? ch : 1
	}

	function getResolution() {
		const s = dashboardState.activeScreenIndex
		return getResolutionForColumn(s)
	}

	function getResolutionForColumn(colIdx) {
		const state = stateStore.getState()
		return state?.channelMap?.programResolutions?.[colIdx] || { w: 1920, h: 1080 }
	}

	function isSelectedColumnActive() {
		if (!selection || selection.type !== 'dashboard') return false
		return dashboardState.getActiveColumnIndex() === selection.colIdx
	}

	async function sendAmcpIfActive(cb) {
		if (!selection || selection.type !== 'dashboard') return
		if (!isSelectedColumnActive()) return
		await cb(getProgramChannel(), dashboardCasparLayer(selection.layerIdx))
	}

	function renderEmpty() {
		root.innerHTML = '<p class="inspector-empty">Select an item</p>'
	}

	function renderClipInspector(colIdx, layerIdx, cell) {
		root.innerHTML = ''
		const title = document.createElement('div')
		title.className = 'inspector-title'
		title.textContent = cell.source?.label || cell.source?.value || `Layer ${layerIdx + 1}`
		root.appendChild(title)

		const grp = document.createElement('div')
		grp.className = 'inspector-group'
		grp.innerHTML = '<div class="inspector-group__title">Clip</div>'

		const loopWrap = document.createElement('div')
		loopWrap.className = 'inspector-field'
		const loopLab = document.createElement('label')
		loopLab.className = 'inspector-field__label'
		loopLab.textContent = 'Loop'
		const loopCheck = document.createElement('input')
		loopCheck.type = 'checkbox'
		loopCheck.checked = !!cell.overrides?.loop
		loopCheck.addEventListener('change', () => {
			const v = loopCheck.checked ? 1 : 0
			dashboardState.setCellOverrides(colIdx, layerIdx, { loop: v })
			if (cell.source?.type === 'timeline') {
				api.post(`/api/timelines/${cell.source.value}/loop`, { loop: !!v }).catch(() => {})
			} else {
				sendAmcpIfActive(async (ch, layer) => {
					await api.post('/api/call', { channel: ch, layer, fn: 'LOOP', params: String(v) })
				})
			}
		})
		loopLab.appendChild(loopCheck)
		loopWrap.appendChild(loopLab)
		grp.appendChild(loopWrap)

		const volInp = createDragInput({
			label: 'Volume',
			value: cell.overrides?.volume ?? 1,
			min: 0, max: 2, step: 0.01, decimals: 2,
			onChange: (v) => {
				dashboardState.setCellOverrides(colIdx, layerIdx, { volume: v })
				sendAmcpIfActive(async (ch, layer) => {
					await api.post('/api/audio/volume', { channel: ch, layer, volume: v })
				})
			},
		})
		grp.appendChild(volInp.wrap)
		root.appendChild(grp)

		appendDashboardClipTransitionOverride(root, { colIdx, layerIdx, cell })
	}

	async function syncTimelineToServer() {
		const tl = timelineState.getActive()
		if (!tl) return
		try {
			await api.put(`/api/timelines/${tl.id}`, tl)
		} catch {
			try { await api.post('/api/timelines', tl) } catch {}
		}
	}

	function renderTimelineFlagInspector(timelineId, flagId) {
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
			'<option value="pause">Pause</option><option value="play">Play (resume)</option><option value="jump">Jump to</option>'
		typeSel.value = flag.type || 'pause'
		typeSel.addEventListener('change', () => {
			timelineState.updateFlag(timelineId, flagId, { type: typeSel.value })
			syncTimelineToServer()
			renderTimelineFlagInspector(timelineId, flagId)
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
			renderTimelineFlagInspector(timelineId, flagId)
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

		const del = document.createElement('button')
		del.type = 'button'
		del.className = 'inspector-btn-sm'
		del.textContent = 'Remove flag'
		del.style.marginTop = '8px'
		del.addEventListener('click', () => {
			timelineState.removeFlag(timelineId, flagId)
			syncTimelineToServer()
			update(null)
		})
		grp.appendChild(del)
		root.appendChild(grp)
	}

	function renderTimelineClipInspector(timelineId, layerIdx, clipId, clip) {
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
			renderTimelineClipInspector(timelineId, layerIdx, clipId, freshClip())
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
			getTimelinePlaybackPos: () => _timelinePlaybackPos,
			redrawClipInspector,
		})
	}

	function getResolutionForScreen() {
		const state = stateStore.getState()
		const idx = sceneState.activeScreenIndex ?? 0
		const pr = state?.channelMap?.programResolutions?.[idx]
		return pr && pr.w > 0 && pr.h > 0 ? pr : { w: 1920, h: 1080 }
	}

	function renderSceneLayerInspector(sel) {
		const { sceneId, layerIndex } = sel
		const scene = sceneState.getScene(sceneId)
		const layer = scene?.layers?.[layerIndex]
		if (!layer) {
			renderEmpty()
			return
		}
		const res = getResolutionForScreen()
		const canvas = sceneState.getCanvasForScreen(sceneState.activeScreenIndex)
		const fill = layer.fill || fullFill()
		const pxRect = fillToPixelRect(fill, canvas)

		root.innerHTML = ''
		const title = document.createElement('div')
		title.className = 'inspector-title'
		title.textContent = `Layer ${layer.layerNumber} (look)`
		root.appendChild(title)

		function patchFillPx(partial) {
			const sc = sceneState.getScene(sceneId)
			const L = sc?.layers?.[layerIndex]
			if (!L) return
			const f = L.fill || fullFill()
			const r = fillToPixelRect(f, canvas)
			let next = { x: r.x, y: r.y, w: r.w, h: r.h, ...partial }
			if (L.aspectLocked !== false) {
				const cr = L.source ? getContentResolution(L.source, stateStore, sceneState.activeScreenIndex) : null
				const ar =
					cr && cr.w > 0 && cr.h > 0 ? cr.w / cr.h : r.w > 0 && r.h > 0 ? r.w / r.h : 16 / 9
				if (partial.w != null && partial.h == null) {
					next.h = Math.max(1, Math.round(next.w / ar))
				} else if (partial.h != null && partial.w == null) {
					next.w = Math.max(1, Math.round(next.h * ar))
				}
			}
			sceneState.patchLayer(sceneId, layerIndex, { fill: pixelRectToFill(next, canvas) })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		}

		/**
		 * @param {'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v' | 'center'} mode
		 */
		function patchFillAlign(mode) {
			const sc = sceneState.getScene(sceneId)
			const L = sc?.layers?.[layerIndex]
			if (!L) return
			const f = L.fill || fullFill()
			const sx = f.scaleX ?? 0
			const sy = f.scaleY ?? 0
			let nx = f.x ?? 0
			let ny = f.y ?? 0
			if (mode === 'left') nx = 0
			else if (mode === 'right') nx = 1 - sx
			else if (mode === 'top') ny = 0
			else if (mode === 'bottom') ny = 1 - sy
			else if (mode === 'center-h') nx = (1 - sx) / 2
			else if (mode === 'center-v') ny = (1 - sy) / 2
			else if (mode === 'center') {
				nx = (1 - sx) / 2
				ny = (1 - sy) / 2
			}
			sceneState.patchLayer(sceneId, layerIndex, { fill: { ...f, x: nx, y: ny } })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		}

		appendSceneLayerFillGroup(root, {
			res,
			pxRect,
			patchFillPx,
			patchFillAlign,
			layer,
			sceneId,
			layerIndex,
			sceneState,
			stateStore,
		})
		appendSceneLayerMixerGroup(root, { sceneId, layerIndex, layer })

		const takeGrp = document.createElement('div')
		takeGrp.className = 'inspector-group'
		takeGrp.innerHTML = '<div class="inspector-group__title">Look take (playback)</div>'
		const startWrap = document.createElement('div')
		startWrap.className = 'inspector-field'
		const startLab = document.createElement('label')
		startLab.className = 'inspector-field__label'
		startLab.textContent = 'Start behaviour override'
		const startSel = document.createElement('select')
		startSel.className = 'inspector-field__select'
		startSel.setAttribute('aria-label', 'Override timeline clip start behaviour for this layer')
		startSel.innerHTML =
			'<option value="inherit">Same as timeline clip</option>' +
			'<option value="beginning">Start from beginning (trim)</option>' +
			'<option value="relativeToPrevious">Relative to timeline (layer)</option>'
		const rawSb = layer.startBehaviour
		startSel.value =
			rawSb === 'relativeToPrevious'
				? 'relativeToPrevious'
				: rawSb === 'beginning'
					? 'beginning'
					: 'inherit'
		startSel.addEventListener('change', () => {
			const v = startSel.value
			sceneState.patchLayer(sceneId, layerIndex, {
				startBehaviour: v === 'inherit' ? null : v === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning',
			})
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		})
		startLab.appendChild(startSel)
		startWrap.appendChild(startLab)
		const startHint = document.createElement('p')
		startHint.className = 'inspector-field inspector-field--hint'
		startHint.style.fontSize = '0.78rem'
		startHint.style.color = 'var(--text-muted)'
		startHint.textContent =
			'Optional: override the timeline clip’s setting for this layer index when taking the look. “Same as timeline” uses the clip inspector value.'
		startWrap.appendChild(startHint)
		takeGrp.appendChild(startWrap)
		root.appendChild(takeGrp)
	}

	async function applyLayerSettings(layerIdx, ls) {
		const colIdx = selection?.type === 'dashboard' && selection.colIdx >= 0
			? selection.colIdx
			: Math.max(0, dashboardState.getActiveColumnIndex())
		const state = stateStore.getState()
		const programChannels = state?.channelMap?.programChannels || [1]
		const casparLayer = dashboardCasparLayer(layerIdx)
		try {
			for (let i = 0; i < programChannels.length; i++) {
				const ch = programChannels[i] ?? 1
				const res = getResolutionForColumn(i)
				const fill = calcMixerFill(ls, res, null)
				await api.post('/api/mixer/fill', {
					channel: ch, layer: casparLayer, ...fill,
					stretch: ls.stretch || 'none',
					layerX: ls.x ?? 0, layerY: ls.y ?? 0,
					layerW: ls.w ?? res.w, layerH: ls.h ?? res.h,
					channelW: res.w, channelH: res.h,
				})
				await api.post('/api/mixer/opacity', { channel: ch, layer: casparLayer, opacity: ls.opacity ?? 1 })
				await api.post('/api/audio/volume', { channel: ch, layer: casparLayer, volume: ls.volume ?? 1 })
				await api.post('/api/mixer/blend', { channel: ch, layer: casparLayer, mode: ls.blend ?? 'normal' })
				await api.post('/api/mixer/commit', { channel: ch })
			}
		} catch (e) {
			console.warn('Layer settings apply failed:', e?.message || e)
		}
	}

	function renderLayerSettingsInspector(layerIdx) {
		const ls = dashboardState.getLayerSetting(layerIdx)
		const layerName = dashboardState.getLayerName(layerIdx)
		const res = getResolution()

		root.innerHTML = ''
		const title = document.createElement('div')
		title.className = 'inspector-title'
		title.textContent = `Layer ${layerIdx + 1} Settings`
		root.appendChild(title)

		const nameGrp = document.createElement('div')
		nameGrp.className = 'inspector-group'
		nameGrp.innerHTML = '<div class="inspector-group__title">Label</div>'
		const nameWrap = document.createElement('div')
		nameWrap.className = 'inspector-field'
		const nameInp = document.createElement('input')
		nameInp.type = 'text'
		nameInp.className = 'inspector-field__input'
		nameInp.value = layerName
		nameInp.placeholder = `Layer ${layerIdx + 1}`
		nameInp.addEventListener('change', () => {
			dashboardState.setLayerName(layerIdx, nameInp.value.trim())
		})
		nameWrap.appendChild(nameInp)
		nameGrp.appendChild(nameWrap)
		root.appendChild(nameGrp)

		appendDashboardLayerFillGroup(root, { layerIdx, ls, res, applyLayerSettings })
		appendDashboardLayerMixerAndStretch(root, { layerIdx, ls, applyLayerSettings, stateStore, selection })
	}

	function renderMultiviewInspector(cellId) {
		const cell = multiviewState.getCell(cellId)
		if (!cell) { renderEmpty(); return }
		root.innerHTML = ''
		const title = document.createElement('div')
		title.className = 'inspector-title'
		title.textContent = cell.label || cell.id
		root.appendChild(title)
		appendMultiviewPositionSize(root, { cellId, cell })
	}

	function update(data) {
		selection = data
		if (!data) {
			renderEmpty()
			scheduleSelectionSync(stateStore, null)
			return
		}
		if (data.type === 'sceneLayer' && data.sceneId && data.layerIndex != null) {
			renderSceneLayerInspector(data)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'dashboard' && data.colIdx != null && data.layerIdx != null) {
			const cell = dashboardState.getCell(data.colIdx, data.layerIdx)
			if (cell?.source?.value) {
				renderClipInspector(data.colIdx, data.layerIdx, cell)
				scheduleSelectionSync(stateStore, selection)
				return
			}
		}
		if (data.type === 'dashboardLayer' && data.layerIdx != null) {
			renderLayerSettingsInspector(data.layerIdx)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'multiview' && data.cellId) {
			renderMultiviewInspector(data.cellId)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'timelineClip' && data.timelineId && data.layerIdx != null && data.clipId && data.clip) {
			renderTimelineClipInspector(data.timelineId, data.layerIdx, data.clipId, data.clip)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'timelineLayer' && data.timelineId && data.layerIdx != null) {
			renderTimelineLayerInspector(root, {
				timelineId: data.timelineId,
				layerIdx: data.layerIdx,
				layer: data.layer,
				syncTimelineToServer,
				renderEmpty,
			})
			scheduleSelectionSync(stateStore, selection)
			return
		}
		if (data.type === 'timelineFlag' && data.timelineId && data.flagId) {
			renderTimelineFlagInspector(data.timelineId, data.flagId)
			scheduleSelectionSync(stateStore, selection)
			return
		}
		renderEmpty()
		scheduleSelectionSync(stateStore, selection)
	}

	window.addEventListener('dashboard-select', (e) => {
		const d = e.detail
		if (d && typeof d.colIdx === 'number' && typeof d.layerIdx === 'number') {
			update({ type: 'dashboard', colIdx: d.colIdx, layerIdx: d.layerIdx })
		} else if (!d) {
			if (selection?.type === 'dashboard') update(null)
		}
	})

	window.addEventListener('timeline-flag-select', (e) => {
		const d = e.detail
		if (d?.timelineId && d?.flagId) {
			update({ type: 'timelineFlag', timelineId: d.timelineId, flagId: d.flagId })
		} else if (!d) {
			if (selection?.type === 'timelineFlag') update(null)
		}
	})

	window.addEventListener('timeline-clip-select', (e) => {
		const d = e.detail
		if (d && d.timelineId && typeof d.layerIdx === 'number' && d.clipId && d.clip) {
			update({ type: 'timelineClip', timelineId: d.timelineId, layerIdx: d.layerIdx, clipId: d.clipId, clip: d.clip })
		} else if (!d) {
			if (selection?.type === 'timelineClip') update(null)
		}
	})

	window.addEventListener('dashboard-layer-select', (e) => {
		const d = e.detail
		if (d && typeof d.layerIdx === 'number') {
			update({ type: 'dashboardLayer', layerIdx: d.layerIdx })
		}
	})

	window.addEventListener('scene-layer-select', (e) => {
		const d = e.detail
		if (d && d.sceneId && typeof d.layerIndex === 'number') {
			update({ type: 'sceneLayer', sceneId: d.sceneId, layerIndex: d.layerIndex, layer: d.layer })
		} else if (!d) {
			if (selection?.type === 'sceneLayer') update(null)
		}
	})

	window.addEventListener('timeline-layer-select', (e) => {
		const d = e.detail
		if (d && d.timelineId && typeof d.layerIdx === 'number') {
			update({ type: 'timelineLayer', timelineId: d.timelineId, layerIdx: d.layerIdx, layer: d.layer })
		}
	})

	function onMultiviewSelect(e) {
		const d = e?.detail
		if (d?.cellId) update({ type: 'multiview', cellId: d.cellId })
		else update(null)
	}
	window.addEventListener('multiview-select', onMultiviewSelect)
	document.addEventListener('multiview-select', onMultiviewSelect, true)

	multiviewState.on('change', () => {
		if (selection?.type === 'multiview' && selection.cellId) {
			renderMultiviewInspector(selection.cellId)
			scheduleSelectionSync(stateStore, selection)
		}
	})

	timelineState.on('change', () => {
		if (selection?.type === 'timelineFlag') {
			const tl = timelineState.getTimeline(selection.timelineId)
			const f = tl?.flags?.find((x) => x.id === selection.flagId)
			if (f) renderTimelineFlagInspector(selection.timelineId, selection.flagId)
			else update(null)
		}
		if (selection?.type === 'timelineClip' && selection.timelineId && selection.clipId != null) {
			const tl = timelineState.getTimeline(selection.timelineId)
			const layer = tl?.layers?.[selection.layerIdx]
			const c = layer?.clips?.find((x) => x.id === selection.clipId)
			if (c) renderTimelineClipInspector(selection.timelineId, selection.layerIdx, selection.clipId, c)
			else update(null)
		}
	})

	dashboardState.on('change', () => {
		if (selection?.type === 'dashboard') {
			const cell = dashboardState.getCell(selection.colIdx, selection.layerIdx)
			if (cell?.source?.value) renderClipInspector(selection.colIdx, selection.layerIdx, cell)
		} else if (selection?.type === 'dashboardLayer') {
			renderLayerSettingsInspector(selection.layerIdx)
		}
	})

	dashboardState.on('activeColumn', () => {
		if (selection?.type === 'dashboard') {
			const cell = dashboardState.getCell(selection.colIdx, selection.layerIdx)
			if (cell?.source?.value) renderClipInspector(selection.colIdx, selection.layerIdx, cell)
		}
	})

	dashboardState.on('layerSettingChange', (idx) => {
		if (selection?.type === 'dashboardLayer' && selection.layerIdx === idx) {
			renderLayerSettingsInspector(idx)
			scheduleSelectionSync(stateStore, selection)
		}
	})

	let sceneInspectorRefreshTimer = null
	function refreshSceneLayerInspectorFromState() {
		if (selection?.type !== 'sceneLayer') return
		const L = sceneState.getScene(selection.sceneId)?.layers?.[selection.layerIndex]
		if (L) renderSceneLayerInspector(selection)
	}
	function scheduleSceneLayerInspectorRefresh() {
		clearTimeout(sceneInspectorRefreshTimer)
		sceneInspectorRefreshTimer = setTimeout(() => {
			sceneInspectorRefreshTimer = null
			refreshSceneLayerInspectorFromState()
		}, 120)
	}
	sceneState.on('change', refreshSceneLayerInspectorFromState)
	sceneState.on('softChange', scheduleSceneLayerInspectorRefresh)

	function refreshInspectorAfterAudioSettings() {
		if (!selection) return
		if (selection.type === 'sceneLayer') refreshSceneLayerInspectorFromState()
		else if (selection.type === 'dashboardLayer') renderLayerSettingsInspector(selection.layerIdx)
		else if (selection.type === 'timelineClip' && selection.timelineId && selection.clipId) {
			const tl = timelineState.getTimeline(selection.timelineId)
			const layer = tl?.layers?.[selection.layerIdx]
			const c = layer?.clips?.find((x) => x.id === selection.clipId)
			if (c) renderTimelineClipInspector(selection.timelineId, selection.layerIdx, selection.clipId, c)
		}
	}
	document.addEventListener('highascg-settings-applied', refreshInspectorAfterAudioSettings)
	settingsState.subscribe(() => refreshInspectorAfterAudioSettings())

	renderEmpty()
	scheduleSelectionSync(stateStore, null)
}
