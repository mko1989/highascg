import * as audioMixerState from '../lib/audio-mixer-state.js'
import { api } from '../lib/api-client.js'
import { debounceAsync, postAudioVolume } from '../lib/audio-mixer-volume-api.js'
import { escapeHtml, escapeAttr } from '../lib/audio-mixer-ui.js'
import {
	faderPercentToLinearGain,
	formatVolumeDb,
	linearGainToFaderPercent,
} from '../lib/audio-volume-scale.js'
import { bindFaderResetGestures, UNITY_LINEAR_GAIN } from '../lib/audio-mixer-fader-bind.js'
import { syncFaderUI, syncAllSolosUI } from './audio-mixer-panel-sync.js'
import {
	programBusChannelCount,
	renderBusMeterBankHtml,
	registerBusMeterFills,
} from '../lib/audio-mixer-bus-meters.js'

/**
 * @param {HTMLElement} mastersListEl
 * @param {{
 *   mastersList: Array<{ ch: number, key: string, label: string, v: number }>,
 *   settings: object,
 *   channelMap: object,
 *   meterFills: Map<string, HTMLElement>,
 * }} ctx
 */
export function renderConsoleMasterStrips(mastersListEl, { mastersList, settings, channelMap, meterFills }) {
	for (const r of mastersList) {
		const busChCount = programBusChannelCount(settings, channelMap, r.ch)
		const strip = document.createElement('div')
		strip.className = 'audio-mixer-view__strip audio-mixer-view__strip--master'
		strip.innerHTML = `
			<div class="audio-mixer-view__strip-label audio-mixer-view__strip-label--master" title="${escapeAttr(r.label)}">${escapeHtml(r.label)}</div>
			<div class="audio-mixer-view__fader-container audio-mixer-view__fader-container--master">
				${renderBusMeterBankHtml(busChCount, 'audio-mixer-view')}
				<div class="audio-mixer-view__scale">
					<span>+6</span><span>0</span><span>-6</span><span>-12</span><span>-24</span><span>-48</span><span>-∞</span>
				</div>
				<input type="range" class="audio-mixer-view__fader" min="0" max="100" value="${linearGainToFaderPercent(r.v)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
			</div>
			<span class="audio-mixer-view__fader-val">${formatVolumeDb(r.v)}</span>
			<div class="audio-mixer-view__strip-actions">
				<div class="audio-mixer-view__master-badge">${r.isPreview ? 'PRV' : 'PGM'}</div>
				<button type="button" class="audio-mixer-view__solo-btn${audioMixerState.isSoloed(r.key) ? ' audio-mixer-view__solo-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Solo this ${r.isPreview ? 'PRV' : 'PGM'} bus to the monitor output (Ctrl+Click for multi)">SOLO</button>
			</div>
		`
		mastersListEl.appendChild(strip)
		// todos03.08: PRV and PGM master strips solo their whole channel onto the monitor
		// bus — same solo store/endpoint as the layer strips (layer-less target = full channel).
		strip.querySelector('.audio-mixer-view__solo-btn')?.addEventListener('click', async (e) => {
			audioMixerState.toggleSolo(r.key, e.metaKey || e.ctrlKey)
			syncAllSolosUI()
			try {
				const solos = audioMixerState.getSoloedLayers().map(audioMixerState.soloKeyToTarget)
				await api.post('/api/audio/solo', { solos })
			} catch {
				console.warn('Solo API not supported on this playout server. Solo state will remain client-side only.')
			}
		})
		registerBusMeterFills(r.key, strip, meterFills, busChCount, 'audio-mixer-view')
		const fader = strip.querySelector('.audio-mixer-view__fader')
		const valEl = strip.querySelector('.audio-mixer-view__fader-val')
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
