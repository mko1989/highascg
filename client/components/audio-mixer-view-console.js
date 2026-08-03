import { sceneState } from '../lib/scene-state.js'
import { collectProgramAudioRows, collectLiveInputMeterRows } from '../lib/audio-mixer-rows.js'
import { createAudioMeterLoop } from '../lib/audio-mixer-meter-loop.js'
import { settingsState } from '../lib/settings-state.js'
import { renderConsoleMasterStrips } from './audio-mixer-console-masters.js'
import { renderConsoleLiveInputs } from './audio-mixer-console-live-inputs.js'
import { renderConsoleInputGroups } from './audio-mixer-console-input-groups.js'

/**
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{
 *   root: HTMLElement,
 *   tabPaneEl: HTMLElement,
 *   inputsListEl: HTMLElement,
 *   mastersListEl: HTMLElement,
 * }} mount
 */
export function mountAudioMixerViewConsole(stateStore, { root, tabPaneEl, inputsListEl, mastersListEl }) {
	const isViewActive = () => tabPaneEl?.classList.contains('active') ?? true
	void root

	const meterFills = new Map()
	const meterSmooth = new Map()
	const meterLayerMeta = new Map()
	const meterLoop = createAudioMeterLoop({
		meterFills,
		meterLayerMeta,
		meterSmooth,
		stateStore,
		peakClipColor: '#ef4444',
		peakNormalColor: '#22c55e',
	})

	function renderConsole() {
		meterLoop.stop()
		meterFills.clear()
		meterSmooth.clear()
		meterLayerMeta.clear()
		inputsListEl.innerHTML = ''
		mastersListEl.innerHTML = ''

		const { programChannels, mastersList, inputsList } = collectProgramAudioRows(stateStore, {
			masterLabel: (_ch, i) => `PGM ${i + 1} Master`,
			previewLabel: (_ch, i) => `PRV ${i + 1} Master`,
			labelMax: 14,
			labelTailChars: 0,
		})
		const channelMap = stateStore.getState()?.channelMap || {}
		const settings = settingsState.getSettings()
		const liveInputMeters = collectLiveInputMeterRows(channelMap)

		renderConsoleLiveInputs(inputsListEl, {
			liveInputMeters,
			programChannels,
			stateStore,
			meterFills,
			meterLayerMeta,
		})

		renderConsoleInputGroups(inputsListEl, {
			programChannels,
			inputsList,
			settings,
			channelMap,
			stateStore,
			meterFills,
			meterLayerMeta,
		})

		renderConsoleMasterStrips(mastersListEl, {
			mastersList,
			settings,
			channelMap,
			meterFills,
		})

		if (meterFills.size) meterLoop.start()
	}

	renderConsole()

	const observer = new MutationObserver(() => {
		if (isViewActive()) renderConsole()
		else meterLoop.stop()
	})
	if (tabPaneEl) observer.observe(tabPaneEl, { attributes: true, attributeFilter: ['class'] })

	const onConsoleRefresh = () => {
		if (isViewActive()) renderConsole()
	}

	const unbindState = stateStore.on('*', (path) => {
		if (!isViewActive()) return
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
			renderConsole()
		}
	})

	const unbindSceneChange = sceneState.on('change', onConsoleRefresh)
	const unbindScene = sceneState.on('softChange', onConsoleRefresh)
	const unbindSettings = settingsState.subscribe(() => onConsoleRefresh())
	document.addEventListener('highascg-settings-applied', onConsoleRefresh)
	document.addEventListener('highascg-live-audio-configured', (ev) => {
		const detail = ev?.detail
		if (detail && typeof detail === 'object') stateStore.applyChange('liveAudioConfigured', detail)
		onConsoleRefresh()
	})

	return {
		stop: () => meterLoop.stop(),
		unbindState,
		unbindScene,
		unbindSceneChange,
		unbindSettings,
	}
}
