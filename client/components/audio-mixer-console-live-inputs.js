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
import { getMultiPlayTargets, setMultiPlayTargets } from '../lib/live-audio-play-targets.js'
import {
	disableLiveAudioPgmRoute,
	enableLiveAudioPgmRoute,
	pgmDestLayerForSlot,
} from '../lib/live-audio-routing.js'
import { showScenesToast } from './scenes-editor-support.js'

/**
 * @param {HTMLElement} inputsListEl
 * @param {{
 *   liveInputMeters: Array<object>,
 *   programChannels: number[],
 *   stateStore: import('../lib/state-store.js').StateStore,
 *   meterFills: Map<string, HTMLElement>,
 *   meterLayerMeta: Map<string, object>,
 * }} ctx
 */
export function renderConsoleLiveInputs(inputsListEl, { liveInputMeters, programChannels, stateStore, meterFills, meterLayerMeta }) {
	if (liveInputMeters.length === 0) return

	const liveUi = readLiveAudioCasparSettings(settingsState.getSettings()?.casparServer || {})
	const liveGroup = document.createElement('div')
	liveGroup.className = 'audio-mixer-view__group'
	liveGroup.innerHTML = `
		<div class="audio-mixer-view__group-header">Live inputs</div>
		<div class="audio-mixer-view__group-strips"></div>
	`
	inputsListEl.appendChild(liveGroup)
	const stripsEl = liveGroup.querySelector('.audio-mixer-view__group-strips')
	for (const r of liveInputMeters) {
		const slot = r?.slot
		const device = slot ? liveUi?.slots?.[slot - 1] || '' : ''
		const destLayer = slot ? pgmDestLayerForSlot(slot, liveUi) : 1
		const cm = stateStore.getState()?.channelMap || {}
		const enabledTargets = slot ? getMultiPlayTargets(slot) : []
		const enabledChannels = new Set(enabledTargets.map((t) => Number(t.channel)))

		const pgmButtonsHtml = Array.isArray(programChannels)
			? programChannels
					.map((pc) => {
						const ch = Number(pc)
						if (!Number.isFinite(ch) || ch < 1) return ''
						const active = enabledChannels.has(ch)
						return `<button type="button" class="audio-mixer-view__matrix-btn${active ? ' audio-mixer-view__matrix-btn--active' : ''}" data-route-ch="${ch}" ${!device ? 'disabled' : ''} title="Route to PGM channel ${ch}">${ch}</button>`
					})
					.join('')
			: ''

		const isMuted = !!r.muted
		const strip = document.createElement('div')
		strip.className = 'audio-mixer-view__strip audio-mixer-view__strip--live-input'
		const labelTitle = r.labelTitle || r.label
		strip.innerHTML = `
			<div class="audio-mixer-view__strip-label" title="${escapeAttr(labelTitle)}">${escapeHtml(r.label)}</div>
			<div class="audio-mixer-view__fader-container">
				<div class="audio-mixer-view__meter-vertical" aria-hidden="true">
					<div class="audio-mixer-view__meter-fill"></div>
				</div>
				<div class="audio-mixer-view__scale">
					<span>+6</span><span>0</span><span>-6</span><span>-12</span><span>-24</span><span>-48</span><span>-∞</span>
				</div>
				<input type="range" class="audio-mixer-view__fader" min="0" max="100" value="${linearGainToFaderPercent(r.v)}" data-ch="${r.ch}" data-layer="${r.layer}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
			</div>
			<span class="audio-mixer-view__fader-val">${formatVolumeDb(r.v)}</span>
			<div class="audio-mixer-view__strip-actions">
				<button type="button" class="audio-mixer-view__mute-btn${isMuted ? ' audio-mixer-view__mute-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Mute live input">MUTE</button>
			</div>
			<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;align-self:stretch;margin-top:6px">
				${pgmButtonsHtml}
			</div>
		`
		strip.title = 'Click to inspect / remove'
		strip.addEventListener('click', (e) => {
			const t = /** @type {HTMLElement} */ (e.target)
			if (t?.closest?.('button, input, select, textarea')) return
			if (r?.inputKind === 'live_audio' && r?.slot != null)
				window.dispatchEvent(new CustomEvent('live-audio-input-select', { detail: { slot: r.slot } }))
		})

		strip.querySelectorAll('[data-route-ch]').forEach((btn) => {
			btn.addEventListener('click', async (e) => {
				e.stopPropagation()
				if (!device) return
				const ch = Number(btn.dataset.routeCh)
				if (!Number.isFinite(ch) || ch < 1) return

				const curTargets = getMultiPlayTargets(slot)
				const curEnabled = curTargets.some((t) => Number(t.channel) === ch && Number(t.layer) === destLayer)
				btn.disabled = true
				try {
					if (!curEnabled) {
						setMultiPlayTargets(slot, [...curTargets, { channel: ch, layer: destLayer }])
						await enableLiveAudioPgmRoute(slot, ch, cm, liveUi)
						btn.classList.add('audio-mixer-view__matrix-btn--active')
					} else {
						await disableLiveAudioPgmRoute(ch, destLayer).catch(() => {})
						const next = curTargets.filter((t) => !(Number(t.channel) === ch && Number(t.layer) === destLayer))
						setMultiPlayTargets(slot, next)
						btn.classList.remove('audio-mixer-view__matrix-btn--active')
					}
				} catch (err) {
					showScenesToast(err?.message || String(err), 'error')
				} finally {
					btn.disabled = false
				}
			})
		})

		stripsEl.appendChild(strip)
		meterFills.set(r.key, strip.querySelector('.audio-mixer-view__meter-fill'))
		meterLayerMeta.set(r.key, meterMetaForInputRow(r))

		const fader = strip.querySelector('.audio-mixer-view__fader')
		const valEl = strip.querySelector('.audio-mixer-view__fader-val')
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

		strip.querySelector('.audio-mixer-view__mute-btn')?.addEventListener('click', async (e) => {
			e.stopPropagation()
			const muteBtn = strip.querySelector('.audio-mixer-view__mute-btn')
			if (!muteBtn) return
			const nextMuted = !muteBtn.classList.contains('audio-mixer-view__mute-btn--active')
			audioMixerState.setMuted(r.key, nextMuted)
			syncMuteUI(r.key, nextMuted)
			const meta = meterLayerMeta.get(r.key)
			if (meta) meta.muted = nextMuted
			const faderEl = strip.querySelector('.audio-mixer-view__fader')
			const currentVol = faderEl ? faderPercentToLinearGain(faderEl.value) : r.v
			try {
				await postAudioVolume({
					channel: r.ch,
					layer: r.layer,
					linearGain: nextMuted ? 0 : currentVol,
				})
			} catch (err) {
				console.warn('MUTE playout update failed:', err?.message || err)
			}
		})
	}
}
