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
import { api } from '../lib/api-client.js'

export { syncFaderUI, syncMuteUI, syncAllSolosUI } from './audio-mixer-panel-sync.js'

const LS_EXPANDED = 'highascg_inspector_program_audio_expanded'

/** WO-226 T226.5: compact transport poll while mounted (event-driven refresh covers most
 *  changes; this is just a safety net for state drifting between events). */
const TIMERS_COMPACT_POLL_MS = 3000

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
		<div class="audio-mixer__timers-compact" id="audio-mixer-timers-compact" hidden></div>
		<div class="audio-mixer__panel" hidden>
			<div class="audio-mixer__section-title">Masters</div>
			<div class="audio-mixer__masters"></div>
			<div class="audio-mixer__section-title">Inputs</div>
			<div class="audio-mixer__inputs"></div>
		</div>
	`
	mountEl.appendChild(root)

	// WO-226 T226.5: slim start/pause/reset + on/off cluster for the ACTIVE screen's timer(s),
	// rendered beside the compact audio mixer (always visible, independent of the Program audio
	// collapse state above).
	const timersCompactEl = root.querySelector('#audio-mixer-timers-compact')

	function dispatchTimersChanged() {
		window.dispatchEvent(new CustomEvent('screen-timers-changed'))
	}

	async function renderCompactTimers() {
		const screenIdx = sceneState.activeScreenIndex
		if (!Number.isFinite(screenIdx)) {
			timersCompactEl.hidden = true
			return
		}
		let timers = []
		try {
			const res = await api.get('/api/timers/list')
			if (res?.ok && Array.isArray(res.timers)) timers = res.timers
		} catch {
			/* leave compact row as-is; next poll/event retries */
			return
		}
		const forScreen = timers
			.filter((t) => t?.screens?.[String(screenIdx)])
			.map((t) => ({ timer: t, entry: t.screens[String(screenIdx)] }))

		timersCompactEl.innerHTML = ''
		if (forScreen.length === 0) {
			timersCompactEl.hidden = true
			return
		}
		timersCompactEl.hidden = false

		for (const { timer, entry } of forScreen) {
			const row = document.createElement('div')
			row.className = 'audio-mixer__timer-compact-row'

			const nameEl = document.createElement('span')
			nameEl.className = 'audio-mixer__layer-label'
			nameEl.textContent = timer.name || `Timer ${String(timer.timerId).slice(0, 8)}`
			row.appendChild(nameEl)

			for (const action of ['start', 'pause', 'reset']) {
				const icons = { start: '▶', pause: '⏸', reset: '⟲' }
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'audio-mixer__timer-compact-btn'
				btn.title = action[0].toUpperCase() + action.slice(1)
				btn.textContent = icons[action]
				btn.addEventListener('click', async () => {
					try {
						await api.post('/api/timers/cmd', { timerId: timer.timerId, cmd: action })
						dispatchTimersChanged()
					} catch (err) {
						console.warn(`[audio-mixer-panel] timer ${action} failed:`, err?.message || err)
					}
				})
				row.appendChild(btn)
			}

			const eyeBtn = document.createElement('button')
			eyeBtn.type = 'button'
			eyeBtn.className = 'audio-mixer__timer-compact-btn'
			eyeBtn.title = entry.visible ? 'Hide' : 'Show'
			eyeBtn.textContent = entry.visible ? '👁' : '⊘'
			eyeBtn.addEventListener('click', async () => {
				try {
					await api.post('/api/timers/visible', { timerId: timer.timerId, screenIdx, visible: !entry.visible })
					dispatchTimersChanged()
					void renderCompactTimers()
				} catch (err) {
					console.warn('[audio-mixer-panel] timer visible toggle failed:', err?.message || err)
				}
			})
			row.appendChild(eyeBtn)

			timersCompactEl.appendChild(row)
		}
	}

	void renderCompactTimers()
	sceneState.on('change', () => void renderCompactTimers())
	sceneState.on('softChange', () => void renderCompactTimers())
	window.addEventListener('screen-timers-changed', () => void renderCompactTimers())
	setInterval(() => void renderCompactTimers(), TIMERS_COMPACT_POLL_MS)

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
