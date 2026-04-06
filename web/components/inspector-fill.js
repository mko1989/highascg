/**
 * Inspector — fill / geometry: scene layer rect, dashboard position/size, multiview cells, timeline clip keyframes.
 */

import { fillToPixelRect, pixelRectToFill, fullFill, sceneLayerPixelRectForContentFit } from '../lib/fill-math.js'
import { fetchMediaContentResolution } from '../lib/mixer-fill.js'
import { api } from '../lib/api-client.js'
import { multiviewState } from '../lib/multiview-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { createMathInput, parseNumberInput } from '../lib/math-input.js'
import { dashboardState } from '../lib/dashboard-state.js'
import { createDragInput, KF_PROPERTIES, KF_PROP_MAP } from './inspector-common.js'

/** @typedef {'fill-canvas' | 'horizontal' | 'vertical' | 'stretch'} SceneContentFit */

/** Same labels/values as look editor — also used by timeline clip inspector. */
export const SCENE_CONTENT_FIT_OPTIONS = /** @type {const} */ ([
	{ value: 'fill-canvas', label: 'Fit canvas' },
	{ value: 'horizontal', label: 'Fill width' },
	{ value: 'vertical', label: 'Fill height' },
	{ value: 'stretch', label: 'Stretch' },
])

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {{ w: number, h: number }} opts.res
 * @param {{ x: number, y: number, w: number, h: number }} opts.pxRect
 * @param {(partial: { x?: number, y?: number, w?: number, h?: number }) => void} opts.patchFillPx
 * @param {import('../lib/scene-state.js').LayerConfig} opts.layer
 * @param {string} opts.sceneId
 * @param {number} opts.layerIndex
 * @param {import('../lib/state-store.js').StateStore} opts.stateStore
 * @param {(mode: 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v' | 'center') => void} opts.patchFillAlign
 * @param {import('../lib/scene-state.js').SceneState} opts.sceneState
 */
export function appendSceneLayerFillGroup(root, opts) {
	const { res, pxRect, patchFillPx, patchFillAlign, layer, sceneId, layerIndex, sceneState, stateStore } = opts

	async function reapplyLayerFrameForContentFit() {
		const sc = sceneState.getScene(sceneId)
		const L = sc?.layers?.[layerIndex]
		if (!L?.source?.value) return
		const canvas = sceneState.getCanvasForScreen(sceneState.activeScreenIndex)
		const cr = await fetchMediaContentResolution(
			L.source,
			stateStore,
			sceneState.activeScreenIndex,
			() => api.get('/api/media'),
		)
		if (!cr?.w || !cr?.h) return
		const fit = L.contentFit || 'horizontal'
		const rect = sceneLayerPixelRectForContentFit(canvas.width, canvas.height, cr.w, cr.h, fit)
		sceneState.patchLayer(sceneId, layerIndex, { fill: pixelRectToFill(rect, canvas) })
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	}

	const fillGrp = document.createElement('div')
	fillGrp.className = 'inspector-group'
	fillGrp.innerHTML = '<div class="inspector-group__title">Position / size (canvas px)</div>'

	const alignRow = document.createElement('div')
	alignRow.className = 'inspector-align-row'
	const alignBtns = [
		['L', 'left'],
		['R', 'right'],
		['T', 'top'],
		['B', 'bottom'],
		['Cx', 'center-h'],
		['Cy', 'center-v'],
		['C', 'center'],
	]
	for (const [label, mode] of alignBtns) {
		const b = document.createElement('button')
		b.type = 'button'
		b.className = 'inspector-align-btn'
		b.textContent = label
		b.addEventListener('click', () => patchFillAlign(/** @type {'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v' | 'center'} */ (mode)))
		alignRow.appendChild(b)
	}
	fillGrp.appendChild(alignRow)

	const xInp = createDragInput({
		label: 'X',
		value: Math.round(pxRect.x),
		min: -999999,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => patchFillPx({ x: v }),
	})
	const yInp = createDragInput({
		label: 'Y',
		value: Math.round(pxRect.y),
		min: -999999,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => patchFillPx({ y: v }),
	})
	const wInp = createDragInput({
		label: 'Width',
		value: Math.max(1, Math.round(pxRect.w)),
		min: 1,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => patchFillPx({ w: Math.max(1, v) }),
	})
	const hInp = createDragInput({
		label: 'Height',
		value: Math.max(1, Math.round(pxRect.h)),
		min: 1,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => patchFillPx({ h: Math.max(1, v) }),
	})
	fillGrp.appendChild(xInp.wrap)
	fillGrp.appendChild(yInp.wrap)
	fillGrp.appendChild(wInp.wrap)
	fillGrp.appendChild(hInp.wrap)

	const lockWrap = document.createElement('div')
	lockWrap.className = 'inspector-field inspector-row'
	const lockCb = document.createElement('input')
	lockCb.type = 'checkbox'
	lockCb.id = 'inspector-scene-aspect-lock'
	lockCb.checked = layer.aspectLocked !== false
	const lockLab = document.createElement('label')
	lockLab.htmlFor = 'inspector-scene-aspect-lock'
	lockLab.textContent = 'Aspect lock'
	lockCb.addEventListener('change', () => {
		sceneState.patchLayer(sceneId, layerIndex, { aspectLocked: lockCb.checked })
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	})
	lockWrap.appendChild(lockCb)
	lockWrap.appendChild(lockLab)
	fillGrp.appendChild(lockWrap)

	const fitWrap = document.createElement('div')
	fitWrap.className = 'inspector-field'
	const fitLab = document.createElement('label')
	fitLab.className = 'inspector-field__label'
	fitLab.textContent = 'Content sizing'
	const fitSel = document.createElement('select')
	fitSel.className = 'inspector-field__select'
	fitSel.setAttribute('aria-label', 'Content sizing')
	const curFit = layer.contentFit || 'horizontal'
	for (const o of SCENE_CONTENT_FIT_OPTIONS) {
		const opt = document.createElement('option')
		opt.value = o.value
		opt.textContent = o.label
		if (o.value === curFit) opt.selected = true
		fitSel.appendChild(opt)
	}
	fitSel.addEventListener('change', () => {
		sceneState.patchLayer(sceneId, layerIndex, { contentFit: /** @type {SceneContentFit} */ (fitSel.value) })
		void reapplyLayerFrameForContentFit()
	})
	fitLab.appendChild(fitSel)
	fitWrap.appendChild(fitLab)
	fillGrp.appendChild(fitWrap)

	root.appendChild(fillGrp)
}

/**
 * @param {HTMLElement} root
 * @param {object} opts
 */
export function appendDashboardLayerFillGroup(root, { layerIdx, ls, res, applyLayerSettings }) {
	const fillGrp = document.createElement('div')
	fillGrp.className = 'inspector-group'
	fillGrp.innerHTML = '<div class="inspector-group__title">Position / Size (px)</div>'

	const fillFields = document.createElement('div')
	fillFields.className = 'inspector-fill-fields'

	const xInp = createMathInput({
		label: 'X', value: Math.round(ls.x ?? 0), min: -res.w * 2, max: res.w * 2, step: 1, decimals: 0,
		placeholder: '0',
		onChange: (v) => {
			const patch = { ...ls, x: v }
			dashboardState.setLayerSetting(layerIdx, { x: v })
			applyLayerSettings(layerIdx, patch)
		},
	})
	const yInp = createMathInput({
		label: 'Y', value: Math.round(ls.y ?? 0), min: -res.h * 2, max: res.h * 2, step: 1, decimals: 0,
		placeholder: '0',
		onChange: (v) => {
			dashboardState.setLayerSetting(layerIdx, { y: v })
			applyLayerSettings(layerIdx, { ...ls, y: v })
		},
	})
	const wInp = createMathInput({
		label: 'W', value: Math.round(ls.w ?? res.w), min: 1, max: res.w * 4, step: 1, decimals: 0,
		placeholder: String(res.w),
		onChange: (v) => {
			dashboardState.setLayerSetting(layerIdx, { w: v })
			applyLayerSettings(layerIdx, { ...ls, w: v })
		},
	})
	const hInp = createMathInput({
		label: 'H', value: Math.round(ls.h ?? res.h), min: 1, max: res.h * 4, step: 1, decimals: 0,
		placeholder: String(res.h),
		onChange: (v) => {
			dashboardState.setLayerSetting(layerIdx, { h: v })
			applyLayerSettings(layerIdx, { ...ls, h: v })
		},
	})
	fillFields.appendChild(xInp.wrap)
	fillFields.appendChild(yInp.wrap)
	fillFields.appendChild(wInp.wrap)
	fillFields.appendChild(hInp.wrap)
	fillGrp.appendChild(fillFields)
	root.appendChild(fillGrp)
}

/**
 * @param {HTMLElement} root
 * @param {object} opts
 */
export function appendMultiviewPositionSize(root, { cellId, cell }) {
	const cw = multiviewState.canvasWidth || 1920
	const ch = multiviewState.canvasHeight || 1080

	const posGrp = document.createElement('div')
	posGrp.className = 'inspector-group'
	posGrp.innerHTML = '<div class="inspector-group__title">Position (px)</div>'
	const xInp = createMathInput({
		label: 'X', value: Math.round(cell.x ?? 0), min: 0, max: cw - 1, step: 1, decimals: 0,
		placeholder: 'e.g. 1920/2',
		onChange: (v) => {
			multiviewState.setCell(cellId, { x: Math.round(Math.max(0, Math.min(cw - (cell.w ?? 1), v))) })
		},
	})
	const yInp = createMathInput({
		label: 'Y', value: Math.round(cell.y ?? 0), min: 0, max: ch - 1, step: 1, decimals: 0,
		placeholder: 'e.g. 1080-540',
		onChange: (v) => {
			multiviewState.setCell(cellId, { y: Math.round(Math.max(0, Math.min(ch - (cell.h ?? 1), v))) })
		},
	})
	posGrp.appendChild(xInp.wrap)
	posGrp.appendChild(yInp.wrap)
	root.appendChild(posGrp)

	const sizeGrp = document.createElement('div')
	sizeGrp.className = 'inspector-group'
	sizeGrp.innerHTML = '<div class="inspector-group__title">Size (px)</div>'
	const aspectRatio = (cell.w && cell.h) ? cell.w / cell.h : 16 / 9

	const lockWrap = document.createElement('div')
	lockWrap.className = 'inspector-field inspector-row'
	const lockCheck = document.createElement('input')
	lockCheck.type = 'checkbox'
	lockCheck.id = 'inspector-mv-lock'
	lockCheck.checked = !!cell.aspectLocked
	const lockLabel = document.createElement('label')
	lockLabel.htmlFor = 'inspector-mv-lock'
	lockLabel.textContent = 'Lock aspect ratio'
	lockWrap.appendChild(lockCheck)
	lockWrap.appendChild(lockLabel)
	sizeGrp.appendChild(lockWrap)

	const wInp = createMathInput({
		label: 'W', value: Math.round(cell.w ?? 0), min: 1, max: cw, step: 1, decimals: 0,
		placeholder: 'e.g. 960',
		onChange: (v) => {
			let nw = Math.round(Math.max(1, Math.min(cw - (cell.x ?? 0), v)))
			let nh = cell.h ?? 100
			if (lockCheck.checked && cell.h) nh = Math.max(1, Math.min(ch - (cell.y ?? 0), Math.round(nw / aspectRatio)))
			multiviewState.setCell(cellId, { w: nw, h: nh })
		},
	})
	const hInp = createMathInput({
		label: 'H', value: Math.round(cell.h ?? 0), min: 1, max: ch, step: 1, decimals: 0,
		placeholder: 'e.g. 540',
		onChange: (v) => {
			let nh = Math.round(Math.max(1, Math.min(ch - (cell.y ?? 0), v)))
			let nw = cell.w ?? 100
			if (lockCheck.checked && cell.w) nw = Math.max(1, Math.min(cw - (cell.x ?? 0), Math.round(nh * aspectRatio)))
			multiviewState.setCell(cellId, { w: nw, h: nh })
		},
	})
	sizeGrp.appendChild(wInp.wrap)
	sizeGrp.appendChild(hInp.wrap)
	root.appendChild(sizeGrp)

	lockCheck.addEventListener('change', () => multiviewState.setCell(cellId, { aspectLocked: lockCheck.checked }))
}

/**
 * Timeline clip keyframes + add-keyframe UI (after title + basic clip fields).
 * @param {HTMLElement} root
 * @param {object} opts
 */
export function appendTimelineClipKeyframes(root, opts) {
	const {
		timelineId, layerIdx, clipId, clip,
		syncTimelineToServer,
		getTimelinePlaybackPos,
		redrawClipInspector,
	} = opts

	// Keyframes: build grouped position (fill_x+fill_y) and scale (scale_x+scale_y) by time
	const allKfs = clip.keyframes || []
	const kfByProp = {}
	allKfs.forEach((kf) => { (kfByProp[kf.property] = kfByProp[kf.property] || []).push(kf) })

	const posTimes = new Set()
	;(kfByProp.fill_x || []).forEach((k) => posTimes.add(Math.round(k.time)))
	;(kfByProp.fill_y || []).forEach((k) => posTimes.add(Math.round(k.time)))
	const posKfs = []
	for (const t of posTimes) {
		const kx = (kfByProp.fill_x || []).find((k) => Math.abs(k.time - t) < 0.5)
		const ky = (kfByProp.fill_y || []).find((k) => Math.abs(k.time - t) < 0.5)
		if (kx || ky) posKfs.push({ time: t, x: kx?.value ?? 0, y: ky?.value ?? 0, easing: kx?.easing || ky?.easing || 'linear' })
	}
	posKfs.sort((a, b) => a.time - b.time)

	const scaleTimes = new Set()
	;(kfByProp.scale_x || []).forEach((k) => scaleTimes.add(Math.round(k.time)))
	;(kfByProp.scale_y || []).forEach((k) => scaleTimes.add(Math.round(k.time)))
	const scaleKfs = []
	for (const t of scaleTimes) {
		const kx = (kfByProp.scale_x || []).find((k) => Math.abs(k.time - t) < 0.5)
		const ky = (kfByProp.scale_y || []).find((k) => Math.abs(k.time - t) < 0.5)
		const v = kx?.value ?? ky?.value ?? 1
		if (kx || ky) scaleKfs.push({ time: t, value: v, easing: kx?.easing || ky?.easing || 'linear' })
	}
	scaleKfs.sort((a, b) => a.time - b.time)

	if (posKfs.length > 0) {
		const kfGrp = document.createElement('div')
		kfGrp.className = 'inspector-group'
		kfGrp.innerHTML = '<div class="inspector-group__title">Position keyframes</div>'
		posKfs.forEach((gkf) => {
			const row = document.createElement('div')
			row.className = 'inspector-field inspector-keyframe-row'
			row.innerHTML = `
				<span class="inspector-field__key">@ ${gkf.time}ms</span>
				<input type="text" class="inspector-field__input inspector-kf-x" value="${gkf.x}" placeholder="X" style="width:42px" />
				<input type="text" class="inspector-field__input inspector-kf-y" value="${gkf.y}" placeholder="Y" style="width:42px" />
				<select class="inspector-field__select inspector-keyframe-easing">
					${['linear', 'ease-in', 'ease-out', 'ease-in-out'].map((e) => `<option value="${e}" ${e === (gkf.easing || 'linear') ? 'selected' : ''}>${e}</option>`).join('')}
				</select>
				<button type="button" class="inspector-btn-sm inspector-kf-remove" title="Remove keyframe">×</button>
			`
			const xInp = row.querySelector('.inspector-kf-x')
			const yInp = row.querySelector('.inspector-kf-y')
			const easeSel = row.querySelector('.inspector-keyframe-easing')
			const removeBtn = row.querySelector('.inspector-kf-remove')
			const applyPos = () => {
				const x = parseNumberInput(xInp.value, NaN)
				const y = parseNumberInput(yInp.value, NaN)
				if (!isNaN(x)) timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'fill_x', value: x, easing: easeSel.value })
				if (!isNaN(y)) timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'fill_y', value: y, easing: easeSel.value })
				syncTimelineToServer()
			}
			xInp.addEventListener('change', applyPos)
			yInp.addEventListener('change', applyPos)
			easeSel.addEventListener('change', applyPos)
			removeBtn.addEventListener('click', () => {
				timelineState.removePositionKeyframe(timelineId, layerIdx, clipId, gkf.time)
				syncTimelineToServer()
				window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
				redrawClipInspector()
			})
			kfGrp.appendChild(row)
		})
		root.appendChild(kfGrp)
	}

	if (scaleKfs.length > 0) {
		const kfGrp = document.createElement('div')
		kfGrp.className = 'inspector-group'
		kfGrp.innerHTML = '<div class="inspector-group__title">Scale keyframes</div>'
		const scaleDef = KF_PROP_MAP.scale
		scaleKfs.forEach((gkf) => {
			const row = document.createElement('div')
			row.className = 'inspector-field inspector-keyframe-row'
			row.innerHTML = `
				<span class="inspector-field__key">@ ${gkf.time}ms</span>
				<input type="text" class="inspector-field__input inspector-kf-scale" value="${gkf.value}" style="width:50px" />
				<select class="inspector-field__select inspector-keyframe-easing">
					${['linear', 'ease-in', 'ease-out', 'ease-in-out'].map((e) => `<option value="${e}" ${e === (gkf.easing || 'linear') ? 'selected' : ''}>${e}</option>`).join('')}
				</select>
				<button type="button" class="inspector-btn-sm inspector-kf-remove" title="Remove keyframe">×</button>
			`
			const valInp = row.querySelector('.inspector-kf-scale')
			const easeSel = row.querySelector('.inspector-keyframe-easing')
			const removeBtn = row.querySelector('.inspector-kf-remove')
			valInp.addEventListener('change', () => {
				const v = parseNumberInput(valInp.value, NaN)
				if (!isNaN(v)) {
					const clamped = Math.max(scaleDef.min, Math.min(scaleDef.max, v))
					timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'scale_x', value: clamped, easing: easeSel.value })
					timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'scale_y', value: clamped, easing: easeSel.value })
					syncTimelineToServer()
				}
			})
			easeSel.addEventListener('change', () => {
				const v = parseNumberInput(valInp.value, NaN)
				const current = !isNaN(v) ? Math.max(scaleDef.min, Math.min(scaleDef.max, v)) : gkf.value
				timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'scale_x', value: current, easing: easeSel.value })
				timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'scale_y', value: current, easing: easeSel.value })
				syncTimelineToServer()
			})
			removeBtn.addEventListener('click', () => {
				timelineState.removeScaleKeyframe(timelineId, layerIdx, clipId, gkf.time)
				syncTimelineToServer()
				window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
				redrawClipInspector()
			})
			kfGrp.appendChild(row)
		})
		root.appendChild(kfGrp)
	}

	for (const propDef of KF_PROPERTIES) {
		if (propDef.pair) continue
		const propKfs = kfByProp[propDef.value] || []
		if (propKfs.length === 0) continue
		const kfGrp = document.createElement('div')
		kfGrp.className = 'inspector-group'
		kfGrp.innerHTML = `<div class="inspector-group__title">${propDef.label} keyframes</div>`
		propKfs.forEach((kf) => {
			const row = document.createElement('div')
			row.className = 'inspector-field inspector-keyframe-row'
			row.innerHTML = `
				<span class="inspector-field__key">@ ${Math.round(kf.time)}ms</span>
				<input type="text" class="inspector-field__input inspector-keyframe-value" value="${kf.value}" style="width:50px" />
				<select class="inspector-field__select inspector-keyframe-easing">
					${['linear', 'ease-in', 'ease-out', 'ease-in-out'].map((e) => `<option value="${e}" ${e === (kf.easing || 'linear') ? 'selected' : ''}>${e}</option>`).join('')}
				</select>
				<button type="button" class="inspector-btn-sm inspector-kf-remove" title="Remove keyframe">×</button>
			`
			const valInp = row.querySelector('.inspector-keyframe-value')
			const easeSel = row.querySelector('.inspector-keyframe-easing')
			const removeBtn = row.querySelector('.inspector-kf-remove')
			valInp.addEventListener('change', () => {
				const v = parseNumberInput(valInp.value, NaN)
				if (!isNaN(v)) {
					const clamped = Math.max(propDef.min ?? 0, Math.min(propDef.max ?? 1, v))
					timelineState.addKeyframe(timelineId, layerIdx, clipId, { ...kf, value: clamped })
					syncTimelineToServer()
				}
			})
			easeSel.addEventListener('change', () => {
				timelineState.addKeyframe(timelineId, layerIdx, clipId, { ...kf, easing: easeSel.value })
				syncTimelineToServer()
			})
			removeBtn.addEventListener('click', () => {
				timelineState.removeKeyframe(timelineId, layerIdx, clipId, kf.property, kf.time)
				syncTimelineToServer()
				window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
				redrawClipInspector()
			})
			kfGrp.appendChild(row)
		})
		root.appendChild(kfGrp)
	}

	const clipLocalMs = Math.max(0, Math.round(getTimelinePlaybackPos() - clip.startTime))
	const defaultTime = clipLocalMs >= 0 && clipLocalMs <= clip.duration ? clipLocalMs : 0
	const addKfGrp = document.createElement('div')
	addKfGrp.className = 'inspector-group'
	addKfGrp.innerHTML = '<div class="inspector-group__title">Add keyframe</div>'
	const addKfRow = document.createElement('div')
	addKfRow.className = 'inspector-field inspector-keyframe-row'
	addKfRow.innerHTML = `
		<select class="inspector-field__select" id="inspector-kf-property">
			${KF_PROPERTIES.map((p) => `<option value="${p.value}">${p.label}</option>`).join('')}
		</select>
		<input type="text" class="inspector-field__input inspector-math-input" id="inspector-kf-time" value="${defaultTime}" placeholder="time (ms)" inputmode="decimal" style="width:70px" />
		<span id="inspector-kf-values">
			<input type="text" class="inspector-field__input inspector-kf-val-single" id="inspector-kf-value" placeholder="value" value="1" style="width:50px" />
		</span>
		<button type="button" class="inspector-btn-sm" id="inspector-kf-add">Add</button>
	`
	const valuesWrap = addKfRow.querySelector('#inspector-kf-values')
	const updateAddInputs = () => {
		const propSel = addKfRow.querySelector('#inspector-kf-property')
		const val = propSel.value
		valuesWrap.innerHTML = ''
		if (val === 'position') {
			valuesWrap.innerHTML = '<input type="text" class="inspector-field__input inspector-kf-val-x" placeholder="X" value="0" style="width:42px" /><input type="text" class="inspector-field__input inspector-kf-val-y" placeholder="Y" value="0" style="width:42px" />'
		} else if (val === 'scale') {
			valuesWrap.innerHTML = '<input type="text" class="inspector-field__input inspector-kf-val-single" placeholder="scale" value="1" style="width:50px" />'
		} else {
			valuesWrap.innerHTML = `<input type="text" class="inspector-field__input inspector-kf-val-single" placeholder="value" value="${KF_PROP_MAP[val]?.default ?? 1}" style="width:50px" />`
		}
	}
	addKfRow.querySelector('#inspector-kf-property').addEventListener('change', updateAddInputs)
	updateAddInputs()
	addKfGrp.appendChild(addKfRow)
	addKfRow.querySelector('#inspector-kf-add').addEventListener('click', () => {
		const timeInp = addKfRow.querySelector('#inspector-kf-time')
		const propSel = addKfRow.querySelector('#inspector-kf-property')
		const time = Math.max(0, Math.round(parseNumberInput(timeInp.value, 0)))
		const prop = propSel.value
		if (prop === 'position') {
			const xInp = addKfRow.querySelector('.inspector-kf-val-x')
			const yInp = addKfRow.querySelector('.inspector-kf-val-y')
			const x = parseNumberInput(xInp?.value ?? 0, 0)
			const y = parseNumberInput(yInp?.value ?? 0, 0)
			timelineState.addPositionKeyframe(timelineId, layerIdx, clipId, time, x, y)
		} else if (prop === 'scale') {
			const valInp = addKfRow.querySelector('.inspector-kf-val-single')
			const v = parseNumberInput(valInp?.value ?? 1, 1)
			const clamped = Math.max(0, Math.min(4, v))
			timelineState.addScaleKeyframe(timelineId, layerIdx, clipId, time, clamped)
		} else {
			const valInp = addKfRow.querySelector('.inspector-kf-val-single')
			const val = parseNumberInput(valInp?.value ?? 1, NaN)
			if (isNaN(val)) return
			const propInfo = KF_PROP_MAP[prop] || { min: 0, max: 1 }
			const clamped = Math.max(propInfo.min ?? 0, Math.min(propInfo.max ?? 1, val))
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time, property: prop, value: clamped, easing: 'linear' })
		}
		syncTimelineToServer()
		window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
		redrawClipInspector()
	})
	root.appendChild(addKfGrp)
}
