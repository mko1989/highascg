/**
 * Inspector — fill / geometry: scene layer rect, multiview cells, timeline clip keyframes.
 */

import { fillToPixelRect, pixelRectToFill, fullFill, sceneLayerPixelRectForContentFit } from '../lib/fill-math.js'
import { fetchMediaContentResolution } from '../lib/mixer-fill.js'
import { api } from '../lib/api-client.js'
import { multiviewState } from '../lib/multiview-state.js'
import { createMathInput } from '../lib/math-input.js'
import { createDragInput } from './inspector-common.js'
import { getCellOverlayType, resolveSourceAspectRatio, solveCellDimensions } from './multiview-editor-canvas.js'

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
		onChange: (v) => {
			patchFillPx({ w: Math.max(1, v) })
			if (layer.aspectLocked !== false) {
				const ar = pxRect.w > 0 && pxRect.h > 0 ? pxRect.w / pxRect.h : 16 / 9
				const nh = Math.max(1, Math.round(v / ar))
				hInp.setValue(nh, false)
			}
		},
	})
	const hInp = createDragInput({
		label: 'Height',
		value: Math.max(1, Math.round(pxRect.h)),
		min: 1,
		max: 999999,
		step: 1,
		decimals: 0,
		onChange: (v) => {
			patchFillPx({ h: Math.max(1, v) })
			if (layer.aspectLocked !== false) {
				const ar = pxRect.w > 0 && pxRect.h > 0 ? pxRect.w / pxRect.h : 16 / 9
				const nw = Math.max(1, Math.round(v * ar))
				wInp.setValue(nw, false)
			}
		},
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
export function appendMultiviewPositionSize(root, { cellId, cell, stateStore }) {
	const posGrp = document.createElement('div')
	posGrp.className = 'inspector-group'
	posGrp.innerHTML = '<div class="inspector-group__title">Position (px)</div>'
	const xInp = createMathInput({
		label: 'X', value: Math.round(cell.x ?? 0), min: -999999, max: 999999, step: 1, decimals: 0,
		placeholder: 'e.g. -1920',
		onChange: (v) => {
			multiviewState.setCell(cellId, { x: Math.round(v) })
		},
	})
	const yInp = createMathInput({
		label: 'Y', value: Math.round(cell.y ?? 0), min: -999999, max: 999999, step: 1, decimals: 0,
		placeholder: 'e.g. -100',
		onChange: (v) => {
			multiviewState.setCell(cellId, { y: Math.round(v) })
		},
	})
	posGrp.appendChild(xInp.wrap)
	posGrp.appendChild(yInp.wrap)
	root.appendChild(posGrp)

	const sizeGrp = document.createElement('div')
	sizeGrp.className = 'inspector-group'
	sizeGrp.innerHTML = '<div class="inspector-group__title">Size (px)</div>'

	const cm = stateStore?.getState()?.channelMap || {}
	const programChannels = cm.programChannels || []
	const previewChannels = cm.previewChannels || []
	const ovType = getCellOverlayType(cell, programChannels, previewChannels)

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
		label: 'W', value: Math.round(cell.w ?? 0), min: 1, max: 999999, step: 1, decimals: 0,
		placeholder: 'e.g. 3300',
		onChange: (v) => {
			let nw = Math.round(Math.max(1, v))
			let nh = cell.h ?? 100
			if (lockCheck.checked) {
				const ratio = resolveSourceAspectRatio(cell, cm)
				const showTimersUnderLabels = !!multiviewState.showTimersUnderLabels
				const solved = solveCellDimensions(nw, nh, ratio, 'width', ovType, showTimersUnderLabels)
				nh = solved.h
			}
			multiviewState.setCell(cellId, { w: nw, h: nh })
		},
	})
	const hInp = createMathInput({
		label: 'H', value: Math.round(cell.h ?? 0), min: 1, max: 999999, step: 1, decimals: 0,
		placeholder: 'e.g. 540',
		onChange: (v) => {
			let nh = Math.round(Math.max(1, v))
			let nw = cell.w ?? 100
			if (lockCheck.checked) {
				const ratio = resolveSourceAspectRatio(cell, cm)
				const showTimersUnderLabels = !!multiviewState.showTimersUnderLabels
				const solved = solveCellDimensions(nw, nh, ratio, 'height', ovType, showTimersUnderLabels)
				nw = solved.w
			}
			multiviewState.setCell(cellId, { w: nw, h: nh })
		},
	})
	sizeGrp.appendChild(wInp.wrap)
	sizeGrp.appendChild(hInp.wrap)
	root.appendChild(sizeGrp)

	lockCheck.addEventListener('change', () => {
		const locked = lockCheck.checked
		const update = { aspectLocked: locked }
		if (locked) {
			const ratio = resolveSourceAspectRatio(cell, cm)
			const showTimersUnderLabels = !!multiviewState.showTimersUnderLabels
			const solved = solveCellDimensions(cell.w ?? 100, cell.h ?? 100, ratio, 'width', ovType, showTimersUnderLabels)
			update.h = solved.h
		}
		multiviewState.setCell(cellId, update)
	})
}

export { appendTimelineClipKeyframes } from './inspector-fill-timeline.js'
