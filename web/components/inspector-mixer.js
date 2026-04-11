/**
 * Inspector — mixer sections (scene look, dashboard layer settings).
 */

import { api } from '../lib/api-client.js'
import { ws } from '../app.js'
import { getVariableStore } from '../lib/variable-state.js'
import { sceneState } from '../lib/scene-state.js'
import { sourceSupportsLoopPlayback } from '../lib/media-ext.js'
import { dashboardState, dashboardCasparLayer, STRETCH_MODES } from '../lib/dashboard-state.js'
import { audioOutputRoutesForLayout, normalizeAudioRouteForLayout } from '../lib/audio-routes.js'

/**
 * Shared Audio block: route (pair), mute, volume % — look layers + timeline clips.
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {() => { audioRoute?: string, muted?: boolean, volume?: number }} opts.getAudio
 * @param {(patch: { audioRoute?: string, muted?: boolean, volume?: number }) => void} opts.onPatch
 */
export function appendAudioInspectorGroup(root, { getAudio, onPatch }) {
	const grp = document.createElement('div')
	grp.className = 'inspector-group'
	grp.innerHTML = '<div class="inspector-group__title">Audio</div>'
	const masterLayout = settingsState.getSettings()?.audioRouting?.programLayout || 'stereo'
	const routes = audioOutputRoutesForLayout(masterLayout)
	let a = getAudio()
	let canonical = normalizeAudioRouteForLayout(a.audioRoute || '1+2', masterLayout)
	if (canonical !== (a.audioRoute || '1+2')) {
		onPatch({ audioRoute: canonical })
		a = getAudio()
	}

	const routeWrap = document.createElement('div')
	routeWrap.className = 'inspector-field'
	const routeLab = document.createElement('label')
	routeLab.className = 'inspector-field__label'
	routeLab.textContent = 'Audio output (pair)'
	const routeSel = document.createElement('select')
	routeSel.className = 'inspector-field__select'
	routes.forEach((r) => {
		const opt = document.createElement('option')
		opt.value = r.value
		opt.textContent = r.label
		if (r.value === canonical) opt.selected = true
		routeSel.appendChild(opt)
	})
	routeSel.addEventListener('change', () => onPatch({ audioRoute: routeSel.value }))
	routeLab.appendChild(routeSel)
	routeWrap.appendChild(routeLab)
	grp.appendChild(routeWrap)

	const muteWrap = document.createElement('div')
	muteWrap.className = 'inspector-field inspector-row'
	const muteCb = document.createElement('input')
	muteCb.type = 'checkbox'
	muteCb.id = `inspector-audio-mute-${Math.random().toString(36).slice(2, 9)}`
	muteCb.checked = !!a.muted
	const muteLab = document.createElement('label')
	muteLab.htmlFor = muteCb.id
	muteLab.textContent = 'Mute'
	muteCb.addEventListener('change', () => onPatch({ muted: muteCb.checked }))
	muteWrap.appendChild(muteCb)
	muteWrap.appendChild(muteLab)
	grp.appendChild(muteWrap)

	const volPct = Math.round((a.volume != null ? a.volume : 1) * 100)
	const volInp = createDragInput({
		label: 'Volume %',
		value: volPct,
		min: 0,
		max: 100,
		step: 1,
		decimals: 0,
		onChange: (v) => onPatch({ volume: Math.max(0, Math.min(1, v / 100)) }),
	})
	grp.appendChild(volInp.wrap)
	root.appendChild(grp)
}
import { settingsState } from '../lib/settings-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { scheduleSelectionSync } from '../lib/selection-sync.js'
import { createDragInput } from './inspector-common.js'
import { createVuMeter } from './vu-meter.js'

const BLEND_MODES = ['normal', 'add', 'alpha', 'multiply', 'overlay', 'screen', 'hardlight', 'softlight', 'difference']

/**
 * @param {HTMLElement} root
 * @param {object} opts
 */
export function appendSceneLayerMixerGroup(root, { sceneId, layerIndex, layer }) {
	const mixGrp = document.createElement('div')
	mixGrp.className = 'inspector-group'
	mixGrp.innerHTML = '<div class="inspector-group__title">Mixer</div>'
	const rotInp = createDragInput({
		label: 'Rotation °', value: layer.rotation ?? 0, min: -180, max: 180, step: 0.5, decimals: 1,
		onChange: (v) => {
			sceneState.patchLayer(sceneId, layerIndex, { rotation: v })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		},
	})
	const opPct = Math.max(0, Math.min(100, Math.round((layer.opacity ?? 1) * 100)))
	const opInp = createDragInput({
		label: 'Opacity %',
		value: opPct,
		min: 0,
		max: 100,
		step: 1,
		decimals: 0,
		onChange: (v) => {
			sceneState.patchLayer(sceneId, layerIndex, { opacity: Math.max(0, Math.min(1, v / 100)) })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		},
	})
	mixGrp.appendChild(rotInp.wrap)
	mixGrp.appendChild(opInp.wrap)

	const alphaWrap = document.createElement('div')
	alphaWrap.className = 'inspector-field inspector-row'
	const alphaCb = document.createElement('input')
	alphaCb.type = 'checkbox'
	alphaCb.checked = !!layer.straightAlpha
	alphaCb.id = 'inspector-scene-straight-alpha'
	const alphaLab = document.createElement('label')
	alphaLab.htmlFor = 'inspector-scene-straight-alpha'
	alphaLab.textContent = 'Straight alpha (KEYER)'
	alphaCb.addEventListener('change', () => {
		sceneState.patchLayer(sceneId, layerIndex, { straightAlpha: alphaCb.checked })
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	})
	alphaWrap.appendChild(alphaCb)
	alphaWrap.appendChild(alphaLab)
	mixGrp.appendChild(alphaWrap)

	const showLoop = sourceSupportsLoopPlayback(layer.source?.value, layer.source?.type)
	if (showLoop) {
		const loopWrap = document.createElement('div')
		loopWrap.className = 'inspector-field inspector-row'
		const loopCb = document.createElement('input')
		loopCb.type = 'checkbox'
		loopCb.checked = !!layer.loop
		loopCb.id = 'inspector-scene-loop'
		const loopLab = document.createElement('label')
		loopLab.htmlFor = 'inspector-scene-loop'
		loopLab.textContent = 'Loop playback'
		loopCb.addEventListener('change', () => {
			sceneState.patchLayer(sceneId, layerIndex, { loop: loopCb.checked })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		})
		loopWrap.appendChild(loopCb)
		loopWrap.appendChild(loopLab)
		mixGrp.appendChild(loopWrap)
	}

	root.appendChild(mixGrp)

	appendAudioInspectorGroup(root, {
		getAudio: () => {
			const L = sceneState.getScene(sceneId)?.layers?.[layerIndex]
			return {
				audioRoute: L?.audioRoute || '1+2',
				muted: !!L?.muted,
				volume: L?.volume != null ? L.volume : 1,
			}
		},
		onPatch: (p) => {
			sceneState.patchLayer(sceneId, layerIndex, p)
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		},
	})
}

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {number} opts.layerIdx
 * @param {object} opts.ls
 * @param {(layerIdx: number, ls: object) => Promise<void>} opts.applyLayerSettings
 * @param {import('../lib/state-store.js').StateStore} opts.stateStore
 * @param {object | null} opts.selection
 */
export function appendDashboardLayerMixerAndStretch(root, { layerIdx, ls, applyLayerSettings, stateStore, selection }) {
	const mixerGrp = document.createElement('div')
	mixerGrp.className = 'inspector-group'
	mixerGrp.innerHTML = '<div class="inspector-group__title">Mixer</div>'

	const opInp = createDragInput({
		label: 'Opacity', value: ls.opacity ?? 1, min: 0, max: 1, step: 0.01, decimals: 2,
		onChange: (v) => {
			dashboardState.setLayerSetting(layerIdx, { opacity: v })
			applyLayerSettings(layerIdx, { ...ls, opacity: v })
		},
	})
	mixerGrp.appendChild(opInp.wrap)

	const volInp = createDragInput({
		label: 'Volume', value: ls.volume ?? 1, min: 0, max: 2, step: 0.01, decimals: 2,
		onChange: (v) => {
			dashboardState.setLayerSetting(layerIdx, { volume: v })
			applyLayerSettings(layerIdx, { ...ls, volume: v })
		},
	})
	mixerGrp.appendChild(volInp.wrap)

	const routeWrap = document.createElement('div')
	routeWrap.className = 'inspector-field'
	const routeLab = document.createElement('label')
	routeLab.className = 'inspector-field__label'
	routeLab.textContent = 'Audio output (pair)'
	const routeSel = document.createElement('select')
	routeSel.className = 'inspector-field__select'
	const masterLayoutDash = settingsState.getSettings()?.audioRouting?.programLayout || 'stereo'
	const routesDash = audioOutputRoutesForLayout(masterLayoutDash)
	const canonicalDash = normalizeAudioRouteForLayout(ls.audioRoute || '1+2', masterLayoutDash)
	if (canonicalDash !== (ls.audioRoute || '1+2')) {
		dashboardState.setLayerSetting(layerIdx, { audioRoute: canonicalDash })
	}
	routesDash.forEach((r) => {
		const opt = document.createElement('option')
		opt.value = r.value
		opt.textContent = r.label
		if (r.value === canonicalDash) opt.selected = true
		routeSel.appendChild(opt)
	})
	routeSel.addEventListener('change', async () => {
		const v = routeSel.value
		dashboardState.setLayerSetting(layerIdx, { audioRoute: v })
		const colIdx =
			selection?.type === 'dashboard' && selection.colIdx >= 0
				? selection.colIdx
				: Math.max(0, dashboardState.getActiveColumnIndex())
		const cell = dashboardState.getCell(colIdx, layerIdx)
		const clip = cell?.source?.value
		if (typeof clip !== 'string' || !clip || cell?.source?.type === 'timeline') return
		try {
			const state = stateStore.getState()
			const programChannels = state?.channelMap?.programChannels || [1]
			const screenIdx = dashboardState.activeScreenIndex ?? 0
			const programCh = programChannels[Math.min(screenIdx, programChannels.length - 1)] ?? 1
			await api.post('/api/play', {
				channel: programCh,
				layer: dashboardCasparLayer(layerIdx),
				clip,
				loop: !!cell.overrides?.loop,
				audioRoute: v,
			})
		} catch (e) {
			console.warn('Audio route replay:', e?.message || e)
		}
	})
	routeLab.appendChild(routeSel)
	routeWrap.appendChild(routeLab)
	mixerGrp.appendChild(routeWrap)

	const vuWrap = document.createElement('div')
	vuWrap.className = 'inspector-field inspector-row'
	vuWrap.style.marginTop = '4px'
	mixerGrp.appendChild(vuWrap)
	
	createVuMeter(vuWrap, {
		channels: 2,
		orientation: 'horizontal',
		label: 'Live Lvl',
		getLevels: () => {
			const vars = getVariableStore(ws)
			const channelMap = stateStore.getState()?.channelMap || {}
			const programChannels = channelMap.programChannels || [1]
			const screenIdx = dashboardState.activeScreenIndex ?? 0
			const ch =
				programChannels[Math.min(screenIdx, Math.max(0, programChannels.length - 1))] ?? 1
			const vL = parseFloat(vars.get(`osc_ch${ch}_audio_L`))
			const vR = parseFloat(vars.get(`osc_ch${ch}_audio_R`))
			return {
				l: Number.isFinite(vL) ? vL : -60,
				r: Number.isFinite(vR) ? vR : Number.isFinite(vL) ? vL : -60,
			}
		},
	})

	const blendWrap = document.createElement('div')
	blendWrap.className = 'inspector-field'
	const blendLab = document.createElement('label')
	blendLab.className = 'inspector-field__label'
	blendLab.textContent = 'Blend'
	const blendSel = document.createElement('select')
	blendSel.className = 'inspector-field__select'
	BLEND_MODES.forEach((m) => {
		const opt = document.createElement('option')
		opt.value = m
		opt.textContent = m
		if (m === (ls.blend || 'normal')) opt.selected = true
		blendSel.appendChild(opt)
	})
	blendSel.addEventListener('change', () => {
		const mode = blendSel.value
		dashboardState.setLayerSetting(layerIdx, { blend: mode })
		applyLayerSettings(layerIdx, { ...ls, blend: mode })
	})
	blendLab.appendChild(blendSel)
	blendWrap.appendChild(blendLab)
	mixerGrp.appendChild(blendWrap)
	root.appendChild(mixerGrp)

	const stretchGrp = document.createElement('div')
	stretchGrp.className = 'inspector-group'
	stretchGrp.innerHTML = '<div class="inspector-group__title">Content Scaling</div>'
	const stretchWrap = document.createElement('div')
	stretchWrap.className = 'inspector-field'
	const stretchLab = document.createElement('label')
	stretchLab.className = 'inspector-field__label'
	stretchLab.textContent = 'Stretch'
	const stretchSel = document.createElement('select')
	stretchSel.className = 'inspector-field__select'
	const stretchLabels = { 'none': 'None (1:1 pixel)', 'fit': 'Fit (uniform)', 'stretch': 'Stretch (fill area)', 'fill-h': 'Fill Horizontal', 'fill-v': 'Fill Vertical' }
	STRETCH_MODES.forEach((m) => {
		const opt = document.createElement('option')
		opt.value = m
		opt.textContent = stretchLabels[m] || m
		if (m === (ls.stretch || 'none')) opt.selected = true
		stretchSel.appendChild(opt)
	})
	stretchSel.addEventListener('change', () => {
		dashboardState.setLayerSetting(layerIdx, { stretch: stretchSel.value })
		applyLayerSettings(layerIdx, { ...dashboardState.getLayerSetting(layerIdx) })
	})
	stretchLab.appendChild(stretchSel)
	stretchWrap.appendChild(stretchLab)
	stretchGrp.appendChild(stretchWrap)

	const aspectLockWrap = document.createElement('div')
	aspectLockWrap.className = 'inspector-field inspector-row'
	const aspectLock = document.createElement('input')
	aspectLock.type = 'checkbox'
	aspectLock.id = 'inspector-layer-aspect-lock'
	aspectLock.checked = !!ls.aspectLocked
	aspectLock.title = 'When adjusting W/H via Companion encoders, keep aspect ratio'
	const aspectLockLab = document.createElement('label')
	aspectLockLab.htmlFor = 'inspector-layer-aspect-lock'
	aspectLockLab.textContent = 'Lock W/H aspect (Companion encoders)'
	aspectLock.addEventListener('change', () => {
		dashboardState.setLayerSetting(layerIdx, { aspectLocked: aspectLock.checked })
		scheduleSelectionSync(stateStore, selection)
	})
	aspectLockWrap.appendChild(aspectLock)
	aspectLockWrap.appendChild(aspectLockLab)
	stretchGrp.appendChild(aspectLockWrap)
	root.appendChild(stretchGrp)
}

/**
 * Timeline layer — rename / add / remove.
 * @param {HTMLElement} root
 * @param {object} opts
 */
export function renderTimelineLayerInspector(root, { timelineId, layerIdx, layer, syncTimelineToServer, renderEmpty }) {
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `Timeline Layer ${layerIdx + 1}`
	root.appendChild(title)

	const grp = document.createElement('div')
	grp.className = 'inspector-group'
	grp.innerHTML = '<div class="inspector-group__title">Layer</div>'

	const nameWrap = document.createElement('div')
	nameWrap.className = 'inspector-field'
	const nameLab = document.createElement('label')
	nameLab.className = 'inspector-field__label'
	const nameKey = document.createElement('span')
	nameKey.className = 'inspector-field__key'
	nameKey.textContent = 'Name'
	const nameInp = document.createElement('input')
	nameInp.type = 'text'
	nameInp.className = 'inspector-field__input'
	nameInp.value = layer?.name || `Layer ${layerIdx + 1}`
	nameInp.addEventListener('change', () => {
		timelineState.updateLayer(timelineId, layerIdx, { name: nameInp.value.trim() || `Layer ${layerIdx + 1}` })
		syncTimelineToServer()
		window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
	})
	nameLab.appendChild(nameKey)
	nameLab.appendChild(nameInp)
	nameWrap.appendChild(nameLab)
	grp.appendChild(nameWrap)
	root.appendChild(grp)

	const actGrp = document.createElement('div')
	actGrp.className = 'inspector-group'
	actGrp.innerHTML = '<div class="inspector-group__title">Actions</div>'

	const addBtn = document.createElement('button')
	addBtn.type = 'button'
	addBtn.className = 'inspector-btn-sm'
	addBtn.textContent = 'Add layer below'
	addBtn.addEventListener('click', () => {
		timelineState.addLayer(timelineId, `Layer ${layerIdx + 2}`)
		syncTimelineToServer()
		window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
	})
	actGrp.appendChild(addBtn)

	const removeBtn = document.createElement('button')
	removeBtn.type = 'button'
	removeBtn.className = 'inspector-btn-sm'
	removeBtn.style.marginLeft = '6px'
	removeBtn.textContent = 'Remove layer'
	removeBtn.addEventListener('click', () => {
		const lName = layer?.name || `Layer ${layerIdx + 1}`
		if (confirm(`Remove "${lName}" and all its clips?`)) {
			timelineState.removeLayer(timelineId, layerIdx)
			syncTimelineToServer()
			window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
			renderEmpty()
		}
	})
	actGrp.appendChild(removeBtn)
	root.appendChild(actGrp)
}
