import { dashboardState, dashboardCasparLayer } from '../lib/dashboard-state.js'
import { sceneState } from '../lib/scene-state.js'
import { fillToPixelRect, pixelRectToFill, fullFill } from '../lib/fill-math.js'
import { api } from '../lib/api-client.js'
import { multiviewState } from '../lib/multiview-state.js'
import { calcMixerFill, getContentResolution } from '../lib/mixer-fill.js'
import { createDragInput } from './inspector-common.js'
import {
	appendSceneLayerFillGroup, appendDashboardLayerFillGroup, appendMultiviewPositionSize,
} from './inspector-fill.js'
import {
	appendSceneLayerMixerGroup,
	appendDashboardLayerMixerAndStretch,
} from './inspector-mixer.js'
import { appendDashboardClipTransitionOverride } from './inspector-transition.js'
import { renderEffectsGroup } from './inspector-effects.js'
import { renderPipOverlayGroup } from './inspector-pip-overlay.js'

/**
 * @param {object} stateStore
 */
export function getResolutionForScreen(stateStore) {
	const state = stateStore.getState()
	const idx = sceneState.activeScreenIndex ?? 0
	const pr = state?.channelMap?.programResolutions?.[idx]
	return pr && pr.w > 0 && pr.h > 0 ? pr : { w: 1920, h: 1080 }
}

/**
 * @param {{
 *   root: HTMLElement,
 *   sendAmcpIfActive: (cb: (ch: number, layer: number) => Promise<void>) => Promise<void>,
 * }} deps
 */
export function renderClipInspector(deps, colIdx, layerIdx, cell) {
	const { root, sendAmcpIfActive } = deps
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

	renderEffectsGroup(root, {
		effects: cell.overrides?.effects || [],
		onUpdate: (newEffects) => {
			dashboardState.setCellOverrides(colIdx, layerIdx, { effects: newEffects })
			renderClipInspector(deps, colIdx, layerIdx, dashboardState.getCell(colIdx, layerIdx))
		},
	})
}

/**
 * @param {{
 *   root: HTMLElement,
 *   stateStore: object,
 *   renderEmpty: () => void,
 *   rerenderSceneLayer: (sel: object) => void,
 * }} deps
 */
export function renderSceneLayerInspector(deps, sel) {
	const { root, stateStore, renderEmpty, rerenderSceneLayer } = deps
	const { sceneId, layerIndex } = sel
	const scene = sceneState.getScene(sceneId)
	const layer = scene?.layers?.[layerIndex]
	if (!layer) {
		renderEmpty()
		return
	}
	const res = getResolutionForScreen(stateStore)
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

	renderEffectsGroup(root, {
		effects: layer.effects || [],
		onUpdate: (newEffects) => {
			sceneState.patchLayer(sceneId, layerIndex, { effects: newEffects })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
			rerenderSceneLayer(sel)
		},
	})

	renderPipOverlayGroup(root, {
		pipOverlay: layer.pipOverlay || null,
		onUpdate: (newOverlay) => {
			sceneState.patchLayer(sceneId, layerIndex, { pipOverlay: newOverlay })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
			// Do not rerenderSceneLayer here: <input type="color"> would unmount on every input and close the native picker.
		},
	})

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

/**
 * @param {{
 *   stateStore: object,
 *   getResolutionForColumn: (colIdx: number) => { w: number, h: number },
 * }} deps
 */
export async function applyLayerSettings(deps, layerIdx, ls) {
	const { stateStore, getResolutionForColumn } = deps
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

/**
 * @param {{
 *   root: HTMLElement,
 *   getResolution: () => { w: number, h: number },
 *   applyLayerSettings: (layerIdx: number, ls: object) => Promise<void>,
 *   stateStore: object,
 *   getSelection: () => object | null,
 * }} deps
 */
export function renderLayerSettingsInspector(deps, layerIdx) {
	const { root, getResolution, applyLayerSettings, stateStore, getSelection } = deps
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
	appendDashboardLayerMixerAndStretch(root, {
		layerIdx, ls, applyLayerSettings, stateStore, selection: getSelection(),
	})
}

/**
 * @param {{
 *   root: HTMLElement,
 *   renderEmpty: () => void,
 * }} deps
 */
export function renderMultiviewInspector(deps, cellId) {
	const { root, renderEmpty } = deps
	const cell = multiviewState.getCell(cellId)
	if (!cell) { renderEmpty(); return }
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = cell.label || cell.id
	root.appendChild(title)
	appendMultiviewPositionSize(root, { cellId, cell })
}
