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
import { computeDisplayTime, formatDisplayTime } from './timer-control-panel-display.js'
import { createTimerForScreen, dispatchTimersChanged } from '../lib/screen-timer-create.js'
import { screenLabel } from '../lib/screen-label.js'
import { uiIcon } from './ui-icons.js'

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

	/** Latest fetched records for the active screen — the display ticker below recomputes the
	 *  remaining time from these between fetches (computeDisplayTime is lastCmd/cmdAt-based, so
	 *  no per-second server traffic is needed). Each record carries its time element and the
	 *  last applied text/classes so the 250ms tick only touches the DOM on actual changes. */
	let compactRecords = []

	function tickCompactDisplays() {
		if (compactRecords.length === 0) return
		for (const rec of compactRecords) {
			const remaining = computeDisplayTime(rec.timer)
			const text = formatDisplayTime(remaining)
			const red = remaining <= rec.red
			const amber = !red && remaining <= rec.amber
			if (text === rec.lastText && red === rec.lastRed && amber === rec.lastAmber) continue
			rec.lastText = text
			rec.lastRed = red
			rec.lastAmber = amber
			rec.timeEl.textContent = text
			rec.timeEl.classList.toggle('audio-mixer__timer-compact-time--red', red)
			rec.timeEl.classList.toggle('audio-mixer__timer-compact-time--amber', amber)
		}
	}

	async function addCompactTimer(screenIdx) {
		const cm = stateStore?.getState?.()?.channelMap || {}
		await createTimerForScreen({
			name: `Timer ${screenLabel(cm, screenIdx)}`,
			screenIdx,
		})
	}

	// Non-null while the compact strip is showing the empty-state add button; keyed by screen
	// so consecutive empty renders skip the innerHTML/closure rebuild.
	let emptyRenderKey = null

	async function renderCompactTimers() {
		const screenIdx = sceneState.activeScreenIndex
		if (!Number.isFinite(screenIdx)) {
			timersCompactEl.hidden = true
			compactRecords = []
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

		timersCompactEl.hidden = false

		if (forScreen.length === 0) {
			compactRecords = []
			// No timer on the active screen — offer the per-screen add right here so the compact
			// menu is a complete control surface (add → control → display → on/off). The 3s poll
			// lands here repeatedly, so skip the rebuild when the button is already in the DOM
			// (the click closure captures screenIdx — a screen switch must rebuild).
			const key = `empty:${screenIdx}`
			if (emptyRenderKey === key) return
			emptyRenderKey = key
			timersCompactEl.innerHTML = ''
			const addBtn = document.createElement('button')
			addBtn.type = 'button'
			addBtn.className = 'audio-mixer__timer-compact-btn audio-mixer__timer-compact-add'
			addBtn.innerHTML = `${uiIcon('timer')} ${uiIcon('plus')}`
			addBtn.title = 'Add countdown timer to the active screen'
			addBtn.addEventListener('click', async () => {
				addBtn.disabled = true
				try {
					await addCompactTimer(screenIdx)
				} catch (err) {
					console.warn('[audio-mixer-panel] add timer failed:', err?.message || err)
				} finally {
					addBtn.disabled = false
				}
			})
			timersCompactEl.appendChild(addBtn)
			return
		}

		emptyRenderKey = null
		timersCompactEl.innerHTML = ''
		const records = []
		for (const { timer, entry } of forScreen) {
			const row = document.createElement('div')
			row.className = 'audio-mixer__timer-compact-row'

			const nameEl = document.createElement('span')
			nameEl.className = 'audio-mixer__layer-label'
			nameEl.textContent = timer.name || `Timer ${String(timer.timerId).slice(0, 8)}`
			row.appendChild(nameEl)

			const timeEl = document.createElement('span')
			timeEl.className = 'audio-mixer__timer-compact-time'
			timeEl.dataset.timerTime = timer.timerId
			timeEl.textContent = formatDisplayTime(computeDisplayTime(timer))
			row.appendChild(timeEl)

			const cfg = timer.config || {}
			records.push({
				timer,
				timeEl,
				amber: Number(cfg.amberThresholdSec) || 0,
				red: Number(cfg.redThresholdSec) || 0,
				lastText: timeEl.textContent,
				// Classes start absent on a fresh row; the next tick applies them if due.
				lastRed: false,
				lastAmber: false,
			})

			for (const action of ['start', 'pause', 'reset']) {
				const icons = { start: 'play', pause: 'pause', reset: 'reset' }
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'audio-mixer__timer-compact-btn'
				btn.title = action[0].toUpperCase() + action.slice(1)
				btn.innerHTML = uiIcon(icons[action])
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
			eyeBtn.innerHTML = uiIcon(entry.visible ? 'eye' : 'eyeOff')
			eyeBtn.addEventListener('click', async () => {
				try {
					// WO-320: fade the compact timer in/out (~25-frame opacity ramp) instead of an instant
					// cut — the server ramps MIXER OPACITY over fadeFrames, and a fade-in targets the timer's
					// stored on-air opacity. 25 matches the full screen-timer inspector's fade.
					await api.post('/api/timers/visible', { timerId: timer.timerId, screenIdx, visible: !entry.visible, fadeFrames: 25 })
					dispatchTimersChanged()
					void renderCompactTimers()
				} catch (err) {
					console.warn('[audio-mixer-panel] timer visible toggle failed:', err?.message || err)
				}
			})
			row.appendChild(eyeBtn)

			timersCompactEl.appendChild(row)
		}
		compactRecords = records
	}

	void renderCompactTimers()
	sceneState.on('change', () => void renderCompactTimers())
	sceneState.on('softChange', () => void renderCompactTimers())
	window.addEventListener('screen-timers-changed', () => void renderCompactTimers())
	setInterval(() => void renderCompactTimers(), TIMERS_COMPACT_POLL_MS)
	// Live countdown readout — purely client-side math off the last-fetched records (see
	// tickCompactDisplays), so 4×/s costs nothing on the wire.
	setInterval(tickCompactDisplays, 250)

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
