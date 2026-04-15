/**
 * Inspector — fill / geometry: scene layer rect, dashboard position/size, multiview cells, timeline clip keyframes.
 */

import { fillToPixelRect, pixelRectToFill, fullFill, sceneLayerPixelRectForContentFit } from '../lib/fill-math.js'
import { fetchMediaContentResolution } from '../lib/mixer-fill.js'
import { api } from '../lib/api-client.js'
import { multiviewState } from '../lib/multiview-state.js'
import { createMathInput } from '../lib/math-input.js'
import { dashboardState } from '../lib/dashboard-state.js'
import { createDragInput } from './inspector-common.js'

/** @typedef {'native' | 'fill-canvas' | 'horizontal' | 'vertical' | 'stretch'} SceneContentFit */

/** Same labels/values as look editor — also used by timeline clip inspector. */
export const SCENE_CONTENT_FIT_OPTIONS = /** @type {const} */ ([
	{ value: 'native', label: 'Native (1:1 px)' },
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
		const fit = L.contentFit || 'native'
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
	const curFit = layer.contentFit || 'native'
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

export { appendTimelineClipKeyframes } from './inspector-fill-timeline.js'
