/**
 * Inspector — mixer sections for scene look layers.
 */

import { sceneState } from '../lib/scene-state.js'
import { sourceSupportsLoopPlayback } from '../lib/media-ext.js'
import { audioOutputRoutesForLayout, normalizeAudioRouteForLayout } from '../lib/audio-routes.js'
import { resolveProgramLayoutForMain, resolveEffectiveProgramLayout } from '../lib/program-audio-layouts.js'
import { faderPercentToLinearGain, formatVolumeDb, linearGainToFaderPercent } from '../lib/audio-volume-scale.js'
import { settingsState } from '../lib/settings-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { createDragInput } from './inspector-common.js'

/**
 * Shared Audio block: route (pair), mute, volume % — look layers + timeline clips.
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {() => { audioRoute?: string, muted?: boolean, volume?: number }} opts.getAudio
 * @param {(patch: { audioRoute?: string, muted?: boolean, volume?: number, routeSourceAudio?: string }) => void} opts.onPatch
 * @param {boolean} [opts.showStoredRoute]
 * @param {number|null|undefined} [opts.mainIndex] 0-based main; null = all screens (widest bus)
 * @param {object|null|undefined} [opts.channelMap] defaults to settings.channelMap
 * @param {() => { source?: { type?: string, value?: string }, routeSourceAudio?: string } | null} [opts.getLayer]
 */
export function appendAudioInspectorGroup(root, { getAudio, onPatch, showStoredRoute = false, mainIndex, channelMap, getLayer }) {
	const grp = document.createElement('div')
	grp.className = 'inspector-group'
	grp.innerHTML = '<div class="inspector-group__title">Audio</div>'
	const settings = settingsState.getSettings()
	const cm = channelMap ?? settings?.channelMap ?? null
	const masterLayout =
		mainIndex === null
			? resolveEffectiveProgramLayout(settings, cm)
			: resolveProgramLayoutForMain(
					settings,
					cm,
					mainIndex != null && Number.isFinite(Number(mainIndex))
						? Number(mainIndex)
						: sceneState.activeScreenIndex ?? 0,
				)
	const routes = audioOutputRoutesForLayout(masterLayout)
	let a = getAudio()
	const layer = getLayer?.()
	const isRouteSource = layer && String(layer.source?.value || '').startsWith('route://')

	// Canonical output pair for a media source. Also read by the `showStoredRoute` hint below (outside
	// the media branch), so it must be function-scoped — when it was block-scoped in the else branch,
	// the hint threw `ReferenceError: canonical is not defined`, which aborted the whole timeline-clip
	// inspector render (its only caller passing showStoredRoute) and left the panel near-empty.
	let canonical = normalizeAudioRouteForLayout(a.audioRoute || '1+2', masterLayout)

	if (isRouteSource) {
		// Route source: render source audio channels selector
		const srcWrap = document.createElement('div')
		srcWrap.className = 'inspector-field'
		const srcLab = document.createElement('label')
		srcLab.className = 'inspector-field__label'
		srcLab.textContent = 'Source audio channels'
		const srcSel = document.createElement('select')
		srcSel.className = 'inspector-field__select'
		srcSel.setAttribute('data-inspector-field', 'route-source-audio')
		const sourceOptions = [
			{ value: 'all', label: 'All' },
			{ value: '1+2', label: '1+2' },
			{ value: '3+4', label: '3+4' },
			{ value: '5+6', label: '5+6' },
			{ value: '7+8', label: '7+8' },
		]
		sourceOptions.forEach((opt) => {
			const option = document.createElement('option')
			option.value = opt.value
			option.textContent = opt.label
			srcSel.appendChild(option)
		})
		srcSel.value = layer.routeSourceAudio || 'all'
		srcSel.addEventListener('change', () => {
			onPatch({ routeSourceAudio: srcSel.value })
		})
		srcLab.appendChild(srcSel)
		srcWrap.appendChild(srcLab)
		grp.appendChild(srcWrap)
	} else {
		// Media source: render output pair selector
		if (canonical !== (a.audioRoute || '1+2')) {
			queueMicrotask(() => onPatch({ audioRoute: canonical }))
		}

		const routeWrap = document.createElement('div')
		routeWrap.className = 'inspector-field'
		const routeLab = document.createElement('label')
		routeLab.className = 'inspector-field__label'
		routeLab.textContent = 'Audio output (pair)'
		const routeSel = document.createElement('select')
		routeSel.className = 'inspector-field__select'
		routeSel.setAttribute('data-inspector-field', 'audio-route')
		routes.forEach((r) => {
			const opt = document.createElement('option')
			opt.value = r.value
			opt.textContent = r.label
			routeSel.appendChild(opt)
		})
		routeSel.value = canonical
		routeSel.addEventListener('change', () => onPatch({ audioRoute: routeSel.value }))
		routeLab.appendChild(routeSel)
		routeWrap.appendChild(routeLab)
		grp.appendChild(routeWrap)
	}

	if (showStoredRoute) {
		const stored = routes.find((r) => r.value === canonical)?.label || canonical
		const routeHint = document.createElement('p')
		routeHint.className = 'inspector-field inspector-field--hint'
		routeHint.style.fontSize = '0.78rem'
		routeHint.setAttribute('data-inspector-field', 'audio-route-stored')
		routeHint.textContent = `Stored on this clip: ${stored}`
		grp.appendChild(routeHint)
	}

	if (routes.length < 2) {
		const layoutHint = document.createElement('p')
		layoutHint.className = 'inspector-field inspector-field--hint'
		layoutHint.style.fontSize = '0.78rem'
		layoutHint.textContent =
			'Program master is stereo — only ch1+2 is available. Widen program audio layout on the screen destination (Device View).'
		grp.appendChild(layoutHint)
	}

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

	const volGain = a.volume != null ? a.volume : 1
	const volInp = createDragInput({
		label: `Volume (${formatVolumeDb(volGain)})`,
		value: linearGainToFaderPercent(volGain),
		min: 0,
		max: 100,
		step: 1,
		decimals: 0,
		onChange: (v) => onPatch({ volume: faderPercentToLinearGain(v) }),
	})
	grp.appendChild(volInp.wrap)
	root.appendChild(grp)
}

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

	const showLoop = sourceSupportsLoopPlayback(layer.source?.value, layer.source?.type) && layer.sourceMode !== 'list'
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

	const foe = layer.fadeOnEnd || { enabled: false, frames: 12 }
	const fadeGrp = document.createElement('div')
	fadeGrp.className = 'inspector-group'
	fadeGrp.innerHTML = '<div class="inspector-group__title">Fade on end</div>'

	const fadeEnWrap = document.createElement('div')
	fadeEnWrap.className = 'inspector-field inspector-row'
	const fadeEnCb = document.createElement('input')
	fadeEnCb.type = 'checkbox'
	fadeEnCb.checked = !!foe.enabled
	fadeEnCb.id = 'inspector-scene-fade-on-end'
	const fadeEnLab = document.createElement('label')
	fadeEnLab.htmlFor = 'inspector-scene-fade-on-end'
	fadeEnLab.textContent = 'Fade out when clip ends'
	fadeEnCb.addEventListener('change', () => {
		sceneState.patchLayer(sceneId, layerIndex, { fadeOnEnd: { enabled: fadeEnCb.checked } })
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	})
	fadeEnWrap.appendChild(fadeEnCb)
	fadeEnWrap.appendChild(fadeEnLab)
	fadeGrp.appendChild(fadeEnWrap)

	const fadeFrInp = createDragInput({
		label: 'Duration (frames)',
		value: foe.frames ?? 12,
		min: 1,
		max: 250,
		step: 1,
		decimals: 0,
		onChange: (v) => {
			sceneState.patchLayer(sceneId, layerIndex, { fadeOnEnd: { frames: Math.max(1, Math.min(250, Math.round(v))) } })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		},
	})
	fadeGrp.appendChild(fadeFrInp.wrap)

	const fadeHint = document.createElement('p')
	fadeHint.className = 'inspector-field inspector-field--hint'
	fadeHint.style.fontSize = '0.78rem'
	fadeHint.style.color = 'var(--text-muted)'
	fadeHint.textContent = 'When enabled, the layer opacity fades to 0 over this many frames before a non-looping clip finishes. Ignored when loop is on.'
	fadeGrp.appendChild(fadeHint)
	root.appendChild(fadeGrp)

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
		getLayer: () => sceneState.getScene(sceneId)?.layers?.[layerIndex],
		mainIndex: sceneState.activeScreenIndex ?? 0,
		channelMap: settingsState.getSettings()?.channelMap ?? null,
	})
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
		timelineState.insertLayerBelow(timelineId, layerIdx)
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
