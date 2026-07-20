import * as audioMixerState from '../lib/audio-mixer-state.js'
import { debounceAsync, postAudioVolume } from '../lib/audio-mixer-volume-api.js'
import { escapeHtml, escapeAttr } from '../lib/audio-mixer-ui.js'
import {
	faderPercentToLinearGain,
	formatVolumeDb,
	linearGainToFaderPercent,
} from '../lib/audio-volume-scale.js'
import { bindFaderResetGestures, UNITY_LINEAR_GAIN } from '../lib/audio-mixer-fader-bind.js'
import { syncFaderUI, syncMuteUI } from './audio-mixer-panel-sync.js'
import { meterMetaForInputRow } from '../lib/audio-mixer-rows.js'
import { settingsState } from '../lib/settings-state.js'
import { readLiveAudioCasparSettings } from '../lib/live-audio-inputs.js'
import { getMultiPlayTargets, inputTargetKey, setMultiPlayTargets } from '../lib/live-audio-play-targets.js'
import {
	disableLiveAudioPgmRoute,
	enableInputPgmRoute,
	inputRouteForRow,
	pgmDestLayerForInput,
	playRouteOnChannel,
} from '../lib/live-audio-routing.js'
import { runInputStart, shouldShowStartControl } from '../lib/live-input-start.js'
import { api } from '../lib/api-client.js'
import { showScenesToast } from './scenes-editor-support.js'

/**
 * @param {HTMLElement} inputsEl
 * @param {{
 *   liveInputMeters: Array<object>,
 *   programChannels: number[],
 *   stateStore: import('../lib/state-store.js').StateStore,
 *   meterFills: Map<string, HTMLElement>,
 *   meterLayerMeta: Map<string, object>,
 * }} ctx
 */
export function renderInspectorLiveInputs(inputsEl, { liveInputMeters, programChannels, stateStore, meterFills, meterLayerMeta }) {
	if (liveInputMeters.length === 0) return

	const liveUi = readLiveAudioCasparSettings(settingsState.getSettings()?.casparServer || {})
	const liveDivider = document.createElement('div')
	liveDivider.className = 'audio-mixer__channel-divider'
	liveDivider.textContent = 'Live inputs'
	inputsEl.appendChild(liveDivider)

	for (const r of liveInputMeters) {
		const slot = r?.slot
		const cm = stateStore.getState()?.channelMap || {}
		// WO-293: an ALSA slot is routable once a capture device is picked in settings; a
		// DeckLink/NDI input is routable once the channel map has allocated its route.
		const routable =
			r?.inputKind === 'live_audio' ? !!(liveUi?.slots?.[slot - 1] || '') : !!inputRouteForRow(cm, r)
		const destLayer = pgmDestLayerForInput(r?.inputKind, slot, liveUi)
		const targetKey = inputTargetKey(r?.inputKind, slot)
		const enabledTargets = getMultiPlayTargets(targetKey)
		const enabledChannels = new Set(enabledTargets.map((t) => Number(t.channel)))

		const isMuted = !!r.muted
		const muteHtml = `<button type="button" class="audio-mixer__mute-btn${isMuted ? ' audio-mixer__mute-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Mute live input">M</button>`
		// A stopped input reads as "no signal" — it must still carry its own way back. Offered for
		// every startable kind regardless of metering state (see shouldShowStartControl).
		const startHtml = shouldShowStartControl(r)
			? `<button type="button" class="audio-mixer__start-btn" data-input-start title="Start / restart this input's capture">▶</button>`
			: ''
		const row = document.createElement('div')
		row.className = 'audio-mixer__bus-layer audio-mixer__bus-layer--live-input'
		const labelTitle = r.labelTitle || r.label
		row.innerHTML = `
			<div class="audio-mixer__layer-info">
				<div class="audio-mixer__layer-label" title="${escapeAttr(labelTitle)}">${escapeHtml(r.label)}</div>
				<div class="audio-mixer__layer-actions">${startHtml}${muteHtml}</div>
			</div>
			<div class="audio-mixer__layer-fader-row">
				<div class="audio-mixer__meter-horizontal" aria-hidden="true">
					<div class="audio-mixer__meter-fill"></div>
				</div>
				<span class="audio-mixer__input-nosignal" data-input-nosignal hidden>no signal</span>
				<input type="range" class="audio-mixer__fader-horizontal" min="0" max="100" value="${linearGainToFaderPercent(r.v)}" data-ch="${r.ch}" data-layer="${r.layer}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
				<span class="audio-mixer__fader-val">${formatVolumeDb(r.v)}</span>
			</div>
			<div class="audio-mixer__live-route-buttons" data-slot="${slot}"></div>
		`
		row.dataset.inputKind = String(r?.inputKind || '')
		row.title = 'Click to inspect / remove'
		row.addEventListener('click', (e) => {
			const t = /** @type {HTMLElement} */ (e.target)
			if (t?.closest?.('button, input, select, textarea')) return
			if (r?.inputKind === 'live_audio' && r?.slot != null) window.dispatchEvent(new CustomEvent('live-audio-input-select', { detail: { slot: r.slot } }))
		})

		const btnWrap = row.querySelector('.audio-mixer__live-route-buttons')
		if (btnWrap && Array.isArray(programChannels)) {
			for (const programCh of programChannels) {
				const ch = Number(programCh)
				if (!Number.isFinite(ch) || ch < 1) continue
				const active = enabledChannels.has(ch)
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = `audio-mixer__live-route-btn${active ? ' audio-mixer__live-route-btn--active' : ''}`
				btn.dataset.channel = String(ch)
				btn.textContent = `Ch${ch}`
				btn.disabled = !routable
				btn.onclick = async (e) => {
					e.stopPropagation()
					if (!routable) {
						showScenesToast(
							r?.inputKind === 'live_audio'
								? `No capture device selected for live input slot ${slot}.`
								: `Input "${r?.label || slot}" has no dedicated channel route yet.`,
							'error',
						)
						return
					}
					// Single-flight per button: a dead input must not become a retry storm.
					const busy = btn.dataset.busy === '1'
					if (busy) return
					btn.dataset.busy = '1'
					btn.disabled = true
					const curTargets = getMultiPlayTargets(targetKey)
					const curEnabled = curTargets.some((t) => Number(t.channel) === ch && Number(t.layer) === destLayer)
					try {
						if (!curEnabled) {
							// Apply first, persist only on success — a failed route must not leave a
							// target recorded that nothing on air matches.
							await enableInputPgmRoute(r, ch, cm, liveUi)
							setMultiPlayTargets(targetKey, [...curTargets, { channel: ch, layer: destLayer }])
							btn.classList.add('audio-mixer__live-route-btn--active')
						} else {
							await disableLiveAudioPgmRoute(ch, destLayer)
							const next = curTargets.filter((t) => !(Number(t.channel) === ch && Number(t.layer) === destLayer))
							setMultiPlayTargets(targetKey, next)
							btn.classList.remove('audio-mixer__live-route-btn--active')
						}
					} catch (err) {
						showScenesToast(err?.message || String(err), 'error')
					} finally {
						btn.dataset.busy = '0'
						btn.disabled = !routable
					}
				}
				btnWrap.appendChild(btn)
			}
		}

		inputsEl.appendChild(row)
		meterFills.set(r.key, row.querySelector('.audio-mixer__meter-fill'))
		meterLayerMeta.set(r.key, meterMetaForInputRow(r))

		const startBtn = row.querySelector('[data-input-start]')
		if (startBtn) {
			startBtn.onclick = async (e) => {
				e.stopPropagation()
				if (startBtn.dataset.busy === '1') return
				startBtn.dataset.busy = '1'
				startBtn.disabled = true
				try {
					await runInputStart(r, {
						post: (p, b) => api.post(p, b),
						targets: getMultiPlayTargets(targetKey),
						playRoute: playRouteOnChannel,
						route: inputRouteForRow(cm, r),
						audioOnly: liveUi?.pgmAudioOnly !== false,
					})
					showScenesToast(`${r.label} capture started.`, 'success')
				} catch (err) {
					showScenesToast(err?.message || String(err), 'error')
				} finally {
					startBtn.dataset.busy = '0'
					startBtn.disabled = false
				}
			}
		}

		const muteBtn = row.querySelector('.audio-mixer__mute-btn')
		if (muteBtn) {
			muteBtn.onclick = async (e) => {
				e.stopPropagation()
				const nextMuted = !muteBtn.classList.contains('audio-mixer__mute-btn--active')
				audioMixerState.setMuted(r.key, nextMuted)
				syncMuteUI(r.key, nextMuted)
				const meta = meterLayerMeta.get(r.key)
				if (meta) meta.muted = nextMuted
				const faderEl = row.querySelector('.audio-mixer__fader-horizontal')
				const currentVol = faderEl ? faderPercentToLinearGain(faderEl.value) : r.v
				try {
					await postAudioVolume({
						channel: r.ch,
						layer: r.layer,
						linearGain: nextMuted ? 0 : currentVol,
					})
				} catch (e) {
					console.warn('MUTE playout update failed:', e?.message || e)
				}
			}
		}

		const fader = row.querySelector('.audio-mixer__fader-horizontal')
		const valEl = row.querySelector('.audio-mixer__fader-val')
		if (fader && valEl) {
			const postLayerVolume = debounceAsync(async () => {
				try {
					await postAudioVolume({
						channel: r.ch,
						layer: r.layer,
						linearGain: faderPercentToLinearGain(fader.value),
					})
				} catch (e) {
					console.warn('VOLUME failed:', e?.message || e)
				}
			})
			fader.addEventListener('input', () => {
				const x = faderPercentToLinearGain(fader.value)
				valEl.textContent = formatVolumeDb(x)
				audioMixerState.setMasterVolume(r.key, x)
				syncFaderUI(r.key, fader.value)
				postLayerVolume()
			})
			fader.addEventListener('change', async () => {
				try {
					await postAudioVolume({
						channel: r.ch,
						layer: r.layer,
						linearGain: faderPercentToLinearGain(fader.value),
					})
				} catch (e) {
					console.warn('VOLUME failed:', e?.message || e)
				}
			})
			bindFaderResetGestures(fader, () => {
				fader.value = String(linearGainToFaderPercent(UNITY_LINEAR_GAIN))
				audioMixerState.setMasterVolume(r.key, UNITY_LINEAR_GAIN)
				fader.dispatchEvent(new Event('input', { bubbles: true }))
				fader.dispatchEvent(new Event('change', { bubbles: true }))
			})
		}
	}
}
