import * as audioMixerState from '../lib/audio-mixer-state.js'
import { debounceAsync, postAudioVolume } from '../lib/audio-mixer-volume-api.js'
import { escapeHtml, escapeAttr } from '../lib/audio-mixer-ui.js'
import {
	faderPercentToLinearGain,
	formatVolumeDb,
	linearGainToFaderPercent,
} from '../lib/audio-volume-scale.js'
import { bindFaderResetGestures, UNITY_LINEAR_GAIN } from '../lib/audio-mixer-fader-bind.js'
import { syncFaderUI } from './audio-mixer-panel-sync.js'
import {
	programBusChannelCount,
	renderBusMeterBankHtml,
	registerBusMeterFills,
} from '../lib/audio-mixer-bus-meters.js'

/**
 * @param {HTMLElement} mastersEl
 * @param {{
 *   mastersList: Array<{ ch: number, key: string, label: string, v: number }>,
 *   settings: object,
 *   channelMap: object,
 *   meterFills: Map<string, HTMLElement>,
 * }} ctx
 */
export function renderInspectorMasterBuses(mastersEl, { mastersList, settings, channelMap, meterFills }) {
	for (const r of mastersList) {
		const busChCount = programBusChannelCount(settings, channelMap, r.ch)
		const row = document.createElement('div')
		row.className = 'audio-mixer__bus-master'
		const labelShort = r.label.replace('Program', 'PGM').replace('audio', '')
		row.innerHTML = `
			<div class="audio-mixer__master-label" title="${escapeAttr(r.label)}">${escapeHtml(labelShort)}</div>
			<div class="audio-mixer__master-meter-container">
				${renderBusMeterBankHtml(busChCount, 'audio-mixer')}
				<input type="range" class="audio-mixer__fader-vertical" min="0" max="100" value="${linearGainToFaderPercent(r.v)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
			</div>
			<span class="audio-mixer__fader-val">${formatVolumeDb(r.v)}</span>
		`
		mastersEl.appendChild(row)

		registerBusMeterFills(r.key, row, meterFills, busChCount, 'audio-mixer')

		const fader = row.querySelector('.audio-mixer__fader-vertical')
		const valEl = row.querySelector('.audio-mixer__fader-val')
		const postMasterVolume = debounceAsync(async () => {
			try {
				await postAudioVolume({
					channel: r.ch,
					master: true,
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
			postMasterVolume()
		})
		fader.addEventListener('change', async () => {
			try {
				await postAudioVolume({
					channel: r.ch,
					master: true,
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
