import { timelineState } from '../lib/timeline-state.js'
import { api } from '../lib/api-client.js'
import { parseNumberInput } from '../lib/math-input.js'
import { createDragInput } from './inspector-common.js'
import { applyFillPxPatch, displayPositionFromStoredPx, fillInspectorPositionMeta } from '../lib/coordinate-origin.js'
import { SCENE_CONTENT_FIT_OPTIONS } from '../lib/scene-content-fit.js'
import { appendTimelineClipKeyframes } from './inspector-fill-timeline.js'
import { sceneState } from '../lib/scene-state.js'
import { getClipBasePixelRect } from '../lib/timeline-clip-interp.js'
import { fillToPixelRect, pixelRectToFill, fullFill, sceneLayerPixelRectForContentFit } from '../lib/fill-math.js'
import { getContentResolution, fetchMediaContentResolution } from '../lib/mixer-fill.js'
import { settingsState } from '../lib/settings-state.js'
import { appendAudioInspectorGroup } from './inspector-mixer.js'
import { renderEffectsGroup } from './inspector-effects.js'
import {
	parseCompanionLocationInput,
	formatCompanionLocation,
	parseCompanionCoordField,
	flagCompanionCoords,
} from '../lib/companion-location-parse.js'
import { companionButtonPreviewUrl } from '../lib/companion-button-preview-url.js'
import { openCompanionButtonPickerModal } from './companion-button-picker-modal.js'
import { fmtSmpte, parseTcInput } from './timeline-canvas.js'

/**
 * Prominent timeline position row (SMPTE + ms) directly under the inspector title.
 * @param {HTMLElement} root
 * @param {{ timeMs: number, fps?: number, maxMs?: number, onCommit: (ms: number) => void }} opts
 */
function appendTimelineInspectorPosition(root, { timeMs, fps = 25, maxMs, onCommit }) {
	const row = document.createElement('div')
	row.className = 'inspector-timeline-position'

	const lab = document.createElement('label')
	lab.className = 'inspector-timeline-position__label'
	lab.textContent = 'Position'

	const tcInp = document.createElement('input')
	tcInp.type = 'text'
	tcInp.className = 'inspector-field__input inspector-math-input'
	tcInp.spellcheck = false
	tcInp.value = fmtSmpte(timeMs, fps)
	tcInp.title = 'SMPTE (HH:MM:SS:FF), ++500 / --500 offset, or plain ms'

	const msHint = document.createElement('span')
	msHint.className = 'inspector-timeline-position__ms'
	msHint.textContent = `${Math.round(timeMs)} ms`

	const commit = () => {
		const parsed = parseTcInput(tcInp.value, timeMs, maxMs, fps)
		if (parsed == null) {
			tcInp.value = fmtSmpte(timeMs, fps)
			return
		}
		const clamped = Math.max(0, Math.min(parsed, maxMs ?? 999999999))
		tcInp.value = fmtSmpte(clamped, fps)
		msHint.textContent = `${Math.round(clamped)} ms`
		if (clamped !== timeMs) onCommit(clamped)
	}

	tcInp.addEventListener('change', commit)
	tcInp.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			tcInp.blur()
		}
	})

	lab.appendChild(tcInp)
	row.appendChild(lab)
	row.appendChild(msHint)
	root.appendChild(row)
}

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

	const fps = tl?.fps || 25
	const dur = tl?.duration ?? 999999
	appendTimelineInspectorPosition(root, {
		timeMs: flag.timeMs,
		fps,
		maxMs: dur,
		onCommit: (ms) => {
			timelineState.updateFlag(timelineId, flagId, { timeMs: ms })
			syncTimelineToServer()
			window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
			renderTimelineFlagInspector(deps, timelineId, flagId)
		},
	})

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

	const coords = flagCompanionCoords(flag)

	const previewWrap = document.createElement('div')
	previewWrap.className = 'companion-inspector-preview'
	const previewImg = document.createElement('img')
	previewImg.className = 'companion-inspector-preview__img'
	previewImg.alt = 'Companion button preview'
	previewImg.width = 72
	previewImg.height = 72
	previewImg.src = companionButtonPreviewUrl(coords.page, coords.row, coords.column)
	previewImg.onerror = () => {
		previewWrap.classList.add('companion-inspector-preview--missing')
	}
	previewWrap.appendChild(previewImg)
	companionWrap.appendChild(previewWrap)

	const previewStatus = document.createElement('p')
	previewStatus.className = 'inspector-field inspector-field--hint companion-inspector-preview-status'
	previewStatus.textContent = 'Checking Companion preview…'
	companionWrap.appendChild(previewStatus)

	const refreshPreviewImg = () => {
		const tl = timelineState.getActive()
		const f = tl?.flags?.find((x) => x.id === flagId) || flag
		const c = flagCompanionCoords(f)
		previewImg.src = companionButtonPreviewUrl(c.page, c.row, c.column, Date.now())
	}

	const applyCoords = (page, row, column) => {
		timelineState.updateFlag(timelineId, flagId, {
			companionPage: page,
			companionRow: row,
			companionColumn: column,
		})
		syncTimelineToServer()
		refreshPreviewImg()
	}

	const locWrap = document.createElement('div')
	locWrap.className = 'inspector-field'
	const locLab = document.createElement('label')
	locLab.className = 'inspector-field__label'
	locLab.textContent = 'Location (page row column)'
	const locInp = document.createElement('input')
	locInp.type = 'text'
	locInp.className = 'inspector-field__input'
	locInp.placeholder = '1 0 2'
	locInp.value = formatCompanionLocation(coords.page, coords.row, coords.column)
	locInp.addEventListener('change', () => {
		const parsed = parseCompanionLocationInput(locInp.value)
		if (!parsed) {
			locInp.value = formatCompanionLocation(coords.page, coords.row, coords.column)
			return
		}
		locInp.value = formatCompanionLocation(parsed.page, parsed.row, parsed.column)
		pageInp.value = String(parsed.page)
		rowInp.value = String(parsed.row)
		colInp.value = String(parsed.column)
		applyCoords(parsed.page, parsed.row, parsed.column)
	})
	locLab.appendChild(locInp)
	locWrap.appendChild(locLab)
	companionWrap.appendChild(locWrap)

	const makeCoordField = (labelText, propName, defaultVal, allowNegative) => {
		const fw = document.createElement('div')
		fw.className = 'inspector-field'
		const fl = document.createElement('label')
		fl.className = 'inspector-field__label'
		fl.textContent = labelText
		const fi = document.createElement('input')
		fi.type = 'text'
		fi.inputMode = 'numeric'
		fi.className = 'inspector-field__input'
		fi.value = flag[propName] != null ? String(flag[propName]) : String(defaultVal)
		fi.addEventListener('change', () => {
			const page =
				propName === 'companionPage'
					? parseCompanionCoordField(fi.value, { min: 1 })
					: parseCompanionCoordField(pageInp.value, { min: 1 })
			const row =
				propName === 'companionRow'
					? parseCompanionCoordField(fi.value, { allowNegative: true })
					: parseCompanionCoordField(rowInp.value, { allowNegative: true })
			const column =
				propName === 'companionColumn'
					? parseCompanionCoordField(fi.value, { allowNegative: true })
					: parseCompanionCoordField(colInp.value, { allowNegative: true })
			if (page == null || row == null || column == null) {
				fi.value = flag[propName] != null ? String(flag[propName]) : String(defaultVal)
				return
			}
			pageInp.value = String(page)
			rowInp.value = String(row)
			colInp.value = String(column)
			locInp.value = formatCompanionLocation(page, row, column)
			applyCoords(page, row, column)
		})
		fl.appendChild(fi)
		fw.appendChild(fl)
		return fi
	}

	const pageInp = makeCoordField('Page (1+)', 'companionPage', 1, false)
	const rowInp = makeCoordField('Row (0+)', 'companionRow', 0, true)
	const colInp = makeCoordField('Column (0+)', 'companionColumn', 0, true)
	companionWrap.appendChild(pageInp.parentElement)
	companionWrap.appendChild(rowInp.parentElement)
	companionWrap.appendChild(colInp.parentElement)

	const btnRow = document.createElement('div')
	btnRow.className = 'companion-inspector-actions'
	const pickBtn = document.createElement('button')
	pickBtn.type = 'button'
	pickBtn.className = 'inspector-btn-sm'
	pickBtn.textContent = 'Choose button…'
	pickBtn.addEventListener('click', () => {
		openCompanionButtonPickerModal({
			initial: flagCompanionCoords(flag),
			onSelect: ({ page, row, column }) => {
				pageInp.value = String(page)
				rowInp.value = String(row)
				colInp.value = String(column)
				locInp.value = formatCompanionLocation(page, row, column)
				applyCoords(page, row, column)
			},
		})
	})
	btnRow.appendChild(pickBtn)

	const testPressBtn = document.createElement('button')
	testPressBtn.type = 'button'
	testPressBtn.className = 'inspector-btn-sm'
	testPressBtn.textContent = 'Test press'
	testPressBtn.title = 'Send Companion HTTP press (down + release), same as playhead crossing this flag'
	testPressBtn.addEventListener('click', async () => {
		const page = parseCompanionCoordField(pageInp.value, { min: 1 })
		const row = parseCompanionCoordField(rowInp.value, { allowNegative: true })
		const column = parseCompanionCoordField(colInp.value, { allowNegative: true })
		if (page == null || row == null || column == null) {
			previewStatus.classList.add('companion-inspector-preview-status--warn')
			previewStatus.textContent = 'Invalid page / row / column for test press.'
			return
		}
		testPressBtn.disabled = true
		const prevLabel = testPressBtn.textContent
		testPressBtn.textContent = 'Pressing…'
		try {
			const r = await api.post('/api/companion/button-preview/test-press', { page, row, column })
			if (r?.ok) {
				previewStatus.classList.remove('companion-inspector-preview-status--warn')
				previewStatus.textContent = `Test press sent to ${formatCompanionLocation(page, row, column)}.`
			} else {
				previewStatus.classList.add('companion-inspector-preview-status--warn')
				previewStatus.textContent = `Test press failed: ${r?.error || `Companion HTTP ${r?.status ?? 'error'}`}`
			}
		} catch (e) {
			previewStatus.classList.add('companion-inspector-preview-status--warn')
			previewStatus.textContent = `Test press failed: ${e?.message || e}`
		} finally {
			testPressBtn.disabled = false
			testPressBtn.textContent = prevLabel
		}
	})
	btnRow.appendChild(testPressBtn)

	companionWrap.appendChild(btnRow)

	void api.get('/api/companion/button-preview/status').then((st) => {
		if (!previewStatus.isConnected) return
		if (st?.previewAvailable) {
			previewStatus.textContent = 'Preview via Companion Satellite (Button Subscriptions API).'
			return
		}
		previewStatus.classList.add('companion-inspector-preview-status--warn')
		previewStatus.textContent =
			st?.hint ||
			'Companion button preview unavailable. Enable Satellite + Button Subscriptions API in Companion Settings.'
		if (st?.reason === 'subscriptions_disabled') {
			pickBtn.disabled = true
			pickBtn.title = 'Enable Button Subscriptions API in Companion Settings'
		}
	}).catch(() => {
		if (previewStatus.isConnected) {
			previewStatus.classList.add('companion-inspector-preview-status--warn')
			previewStatus.textContent = 'Could not reach HighAsCG Companion preview status.'
		}
	})

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
	root.innerHTML = ''
	if (!clip?.source?.value) return

	const layerNum = layerIdx + 1
	const mediaLabel = clip.source?.label || clip.source?.value || 'Clip'
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `${mediaLabel} · Layer ${layerNum}`
	root.appendChild(title)

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
		let next = applyFillPxPatch({ x: r.x, y: r.y, w: r.w, h: r.h }, partial, canvas)
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

	renderEffectsGroup(root, {
		effects: clip.effects || [],
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
