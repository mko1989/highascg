/**
 * Program master faders (MIXER MASTERVOLUME) — collapsible section at the bottom of the Inspector.
 */

import { sceneState } from '../lib/scene-state.js'
import { collectProgramAudioRows, collectLiveInputMeterRows } from '../lib/audio-mixer-rows.js'
import { createAudioMeterLoop } from '../lib/audio-mixer-meter-loop.js'
import { settingsState } from '../lib/settings-state.js'
import { renderInspectorMasterBuses } from './audio-mixer-panel-masters.js'
import { renderInspectorLiveInputs } from './audio-mixer-panel-live-inputs.js'
import { renderInspectorProgramInputLayers } from './audio-mixer-panel-input-layers.js'

export { syncFaderUI, syncMuteUI, syncAllSolosUI } from './audio-mixer-panel-sync.js'

const LS_EXPANDED = 'highascg_inspector_program_audio_expanded'

/** @param {import('../lib/state-store.js').StateStore} stateStore */
export function initAudioMixerPanel(stateStore, mountEl) {
	if (!mountEl) return

	const root = document.createElement('div')
	root.className = 'audio-mixer audio-mixer--inspector'
	root.innerHTML = `
		<button type="button" class="audio-mixer__section-toggle" aria-expanded="false" title="Program audio (MASTERVOLUME)">
			<span class="audio-mixer__section-chevron" aria-hidden="true">▶</span>
			<span class="audio-mixer__section-label">Program audio</span>
		</button>
		<div class="audio-mixer__panel" hidden>
			<div class="audio-mixer__section-title">Masters</div>
			<div class="audio-mixer__masters"></div>
			<div class="audio-mixer__section-title">Inputs</div>
			<div class="audio-mixer__inputs"></div>
		</div>
	`
	mountEl.appendChild(root)

	// WO-381: the compact per-active-screen timer strip (WO-226 T226.5) was removed — owner
	// 2026-07-29: "there is an additional timer in the most bottom right. not needed." It sat
	// directly under the Timers dock (timer-control-panel.js) and duplicated its transport.
	// Screen timers are controlled there and configured in the screen-timer Inspector.

	const toggle = root.querySelector('.audio-mixer__section-toggle')
	const panel = root.querySelector('.audio-mixer__panel')
	const chevron = root.querySelector('.audio-mixer__section-chevron')
	const mastersEl = root.querySelector('.audio-mixer__masters')
	const inputsEl = root.querySelector('.audio-mixer__inputs')
	const meterFills = new Map()
	const meterSmooth = new Map()
	const meterLayerMeta = new Map()
	const meterLoop = createAudioMeterLoop({
		meterFills,
		meterLayerMeta,
		meterSmooth,
		stateStore,
		layerFillAxis: 'width',
	})

	function renderBuses() {
		meterLoop.stop()
		meterFills.clear()
		meterSmooth.clear()
		meterLayerMeta.clear()
		mastersEl.innerHTML = ''
		inputsEl.innerHTML = ''

		const { programChannels, mastersList, inputsList } = collectProgramAudioRows(stateStore, {
			masterLabel: (ch, i) => `PGM ${i + 1} (ch ${ch})`,
		})
		const channelMap = stateStore.getState()?.channelMap || {}
		const settings = settingsState.getSettings()

		renderInspectorMasterBuses(mastersEl, { mastersList, settings, channelMap, meterFills })

		const liveInputMeters = collectLiveInputMeterRows(stateStore.getState()?.channelMap || {})
		renderInspectorLiveInputs(inputsEl, {
			liveInputMeters,
			programChannels,
			stateStore,
			meterFills,
			meterLayerMeta,
		})

		renderInspectorProgramInputLayers(inputsEl, {
			programChannels,
			inputsList,
			settings,
			channelMap,
			stateStore,
			meterFills,
			meterLayerMeta,
		})

		if (meterFills.size) meterLoop.start()
	}

	let isExpanded = false
	try {
		const v = localStorage.getItem(LS_EXPANDED)
		if (v === '1') isExpanded = true
		else if (v === '0') isExpanded = false
	} catch {
		/* ignore */
	}

	function applyExpanded(expanded) {
		isExpanded = !!expanded
		panel.hidden = !isExpanded
		toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false')
		if (chevron) chevron.textContent = isExpanded ? '▼' : '▶'
		if (isExpanded) renderBuses()
		else meterLoop.stop()
	}

	applyExpanded(isExpanded)

	toggle.addEventListener('click', () => {
		applyExpanded(!isExpanded)
		try {
			localStorage.setItem(LS_EXPANDED, isExpanded ? '1' : '0')
		} catch {
			/* ignore */
		}
	})

	const onMixerRefresh = () => {
		if (isExpanded) renderBuses()
	}

	stateStore.on('*', (path) => {
		if (!isExpanded) return
		if (path === 'variables') return
		if (
			path === '*' ||
			path == null ||
			path === 'channelMap' ||
			path === 'channels' ||
			path === 'liveAudioConfigured' ||
			path === 'scene.live' ||
			(typeof path === 'string' && path.startsWith('scene.live'))
		) {
			renderBuses()
		}
	})

	settingsState.subscribe(() => onMixerRefresh())
	sceneState.on('change', onMixerRefresh)
	sceneState.on('softChange', onMixerRefresh)
	document.addEventListener('highascg-settings-applied', onMixerRefresh)
	document.addEventListener('highascg-live-audio-configured', (ev) => {
		const detail = ev?.detail
		if (detail && typeof detail === 'object') stateStore.applyChange('liveAudioConfigured', detail)
		onMixerRefresh()
	})
}
