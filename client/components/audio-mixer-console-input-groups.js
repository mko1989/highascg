import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { debounceAsync, postAudioVolume } from '../lib/audio-mixer-volume-api.js'
import { audioOutputRoutesForLayout } from '../lib/audio-routes.js'
import { resolveProgramLayoutForProgramChannel } from '../lib/program-audio-layouts.js'
import { sceneState } from '../lib/scene-state.js'
import { showScenesToast } from './scenes-editor-support.js'
import { meterMetaForInputRow } from '../lib/audio-mixer-rows.js'
import { escapeHtml, escapeAttr } from '../lib/audio-mixer-ui.js'
import {
	faderPercentToLinearGain,
	formatVolumeDb,
	linearGainToFaderPercent,
} from '../lib/audio-volume-scale.js'
import { bindFaderResetGestures, UNITY_LINEAR_GAIN } from '../lib/audio-mixer-fader-bind.js'
import { syncFaderUI, syncMuteUI, syncAllSolosUI } from './audio-mixer-panel-sync.js'

/**
 * @param {HTMLElement} inputsListEl
 * @param {{
 *   programChannels: number[],
 *   inputsList: Array<object>,
 *   settings: object,
 *   channelMap: object,
 *   stateStore: import('../lib/state-store.js').StateStore,
 *   meterFills: Map<string, HTMLElement>,
 *   meterLayerMeta: Map<string, object>,
 * }} ctx
 */
export function renderConsoleInputGroups(
	inputsListEl,
	{ programChannels, inputsList, settings, channelMap, stateStore, meterFills, meterLayerMeta },
) {
	const inputsByCh = {}
	for (const r of inputsList) {
		if (!inputsByCh[r.ch]) inputsByCh[r.ch] = []
		inputsByCh[r.ch].push(r)
	}

	const groups = []
	programChannels.forEach((ch, chIdx) => {
		groups.push({ ch, title: `PGM ${chIdx + 1} (ch ${ch}) Inputs` })
	})
	groups.forEach((g) => {
		const list = inputsByCh[g.ch] || []
		if (list.length === 0) return

		const groupCard = document.createElement('div')
		groupCard.className = 'audio-mixer-view__group'
		groupCard.innerHTML = `
			<div class="audio-mixer-view__group-header">${escapeHtml(g.title)}</div>
			<div class="audio-mixer-view__group-strips"></div>
		`
		inputsListEl.appendChild(groupCard)
		const stripsEl = groupCard.querySelector('.audio-mixer-view__group-strips')

		for (const r of list) {
			const strip = document.createElement('div')
			strip.className = 'audio-mixer-view__strip audio-mixer-view__strip--input'
			const isSolo = audioMixerState.isSoloed(r.key)
			const isMuted = !!r.muted
			const masterLayout = resolveProgramLayoutForProgramChannel(settings, channelMap, r.ch)
			const routes = audioOutputRoutesForLayout(masterLayout)
			const matrixButtonsHtml = routes
				.map((rt) => {
					const active = rt.value === r.audioRoute
					return `<button type="button" class="audio-mixer-view__matrix-btn${active ? ' audio-mixer-view__matrix-btn--active' : ''}" data-route="${escapeAttr(rt.value)}" title="Route to ${escapeAttr(rt.label)}">${escapeHtml(rt.label)}</button>`
				})
				.join('')
			const labelTitle = r.labelTitle || r.label
			const matrixHtml = r.sceneId ? `
				<div class="audio-mixer-view__matrix">
					<div class="audio-mixer-view__matrix-title">Routing</div>
					<div class="audio-mixer-view__matrix-buttons">${matrixButtonsHtml}</div>
				</div>
			` : ''
			strip.innerHTML = `
				<div class="audio-mixer-view__strip-label" title="${escapeAttr(labelTitle)}">${escapeHtml(r.label)}</div>
				<div class="audio-mixer-view__fader-container">
					<div class="audio-mixer-view__meter-vertical" aria-hidden="true">
						<div class="audio-mixer-view__meter-fill"></div>
					</div>
					<div class="audio-mixer-view__scale">
						<span>+6</span><span>0</span><span>-6</span><span>-12</span><span>-24</span><span>-48</span><span>-∞</span>
					</div>
					<input type="range" class="audio-mixer-view__fader" min="0" max="100" value="${linearGainToFaderPercent(r.v)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
				</div>
				<span class="audio-mixer-view__fader-val">${formatVolumeDb(r.v)}</span>
				<div class="audio-mixer-view__strip-actions">
					<button type="button" class="audio-mixer-view__solo-btn${isSolo ? ' audio-mixer-view__solo-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Solo layer (Ctrl+Click for multi)">SOLO</button>
					<button type="button" class="audio-mixer-view__mute-btn${isMuted ? ' audio-mixer-view__mute-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Mute layer">MUTE</button>
				</div>
				${matrixHtml}
			`
			if (r?.liveAudioSlot != null) {
				strip.title = 'Click to inspect / remove'
				strip.addEventListener('click', (e) => {
					const t = /** @type {HTMLElement} */ (e.target)
					if (t?.closest?.('button, input, select, textarea')) return
					window.dispatchEvent(new CustomEvent('live-audio-input-select', { detail: { slot: r.liveAudioSlot } }))
				})
			}
			stripsEl.appendChild(strip)

			meterFills.set(r.key, strip.querySelector('.audio-mixer-view__meter-fill'))
			meterLayerMeta.set(r.key, meterMetaForInputRow(r))

			const fader = strip.querySelector('.audio-mixer-view__fader')
			const valEl = strip.querySelector('.audio-mixer-view__fader-val')
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
				const liveScenes = stateStore.getState()?.scene?.live || {}
				const liveSceneData = liveScenes[r.ch] || liveScenes[String(r.ch)]
				if (liveSceneData?.scene?.layers) {
					const layer = liveSceneData.scene.layers.find((l) => l.layerNumber === r.layer)
					if (layer) layer.volume = x
				}
				if (!r.sceneId) {
					audioMixerState.setMasterVolume(r.key, x)
				}
				syncFaderUI(r.key, fader.value)
				postLayerVolume()
			})
			fader.addEventListener('change', async () => {
				const x = faderPercentToLinearGain(fader.value)
				if (r.sceneId) {
					const scene = sceneState.getScene(r.sceneId)
					if (scene) {
						const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
						if (idx >= 0) sceneState.patchLayer(r.sceneId, idx, { volume: x })
					}
				}
				try {
					await postAudioVolume({ channel: r.ch, layer: r.layer, linearGain: x })
				} catch (e) {
					console.warn('VOLUME failed:', e?.message || e)
				}
			})
			bindFaderResetGestures(fader, () => {
				fader.value = String(linearGainToFaderPercent(UNITY_LINEAR_GAIN))
				fader.dispatchEvent(new Event('input', { bubbles: true }))
				fader.dispatchEvent(new Event('change', { bubbles: true }))
			})

			strip.querySelector('.audio-mixer-view__solo-btn')?.addEventListener('click', async (e) => {
				audioMixerState.toggleSolo(r.key, e.metaKey || e.ctrlKey)
				syncAllSolosUI()
				try {
					const solos = audioMixerState.getSoloedLayers().map((k) => {
						const parts = k.split(':')
						return { channel: parseInt(parts[1], 10), layer: parseInt(parts[3], 10) }
					})
					await api.post('/api/audio/solo', { solos })
				} catch {
					console.warn('Solo API not supported on this playout server. Solo state will remain client-side only.')
				}
			})

			strip.querySelector('.audio-mixer-view__mute-btn')?.addEventListener('click', async () => {
				const muteBtn = strip.querySelector('.audio-mixer-view__mute-btn')
				if (!muteBtn) return
				const nextMuted = !muteBtn.classList.contains('audio-mixer-view__mute-btn--active')

				if (r.sceneId) {
					const scene = sceneState.getScene(r.sceneId)
					if (scene) {
						const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
						if (idx >= 0) {
							sceneState.patchLayer(r.sceneId, idx, { muted: nextMuted })
							document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
						}
					}
				} else {
					audioMixerState.setMuted(r.key, nextMuted)
				}

				const liveScenes = stateStore.getState()?.scene?.live || {}
				const liveSceneData = liveScenes[r.ch] || liveScenes[String(r.ch)]
				if (liveSceneData?.scene?.layers) {
					const layer = liveSceneData.scene.layers.find((l) => l.layerNumber === r.layer)
					if (layer) layer.muted = nextMuted
				}
				syncMuteUI(r.key, nextMuted)
				const meta = meterLayerMeta.get(r.key)
				if (meta) meta.muted = nextMuted
				const faderEl = document.querySelector(`input[data-key="${r.key}"]`)
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
			})

			if (r.sceneId) {
				strip.querySelectorAll('.audio-mixer-view__matrix-btn').forEach((btn) => {
					btn.addEventListener('click', () => {
						const routeVal = btn.dataset.route
						const scene = sceneState.getScene(r.sceneId)
						if (!scene) return
						const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
						if (idx >= 0) {
							sceneState.patchLayer(r.sceneId, idx, { audioRoute: routeVal })
							showScenesToast(`Route changed to ${routeVal}. Re-take look to apply.`, 'info')
						}
					})
				})
			}
		}
	})

	if (inputsListEl.innerHTML === '') {
		inputsListEl.innerHTML = `
			<div class="audio-mixer-view__empty-state">
				<div class="audio-mixer-view__empty-icon">🎚</div>
				<div class="audio-mixer-view__empty-text">No active program inputs playing audio. Play a scene look with audio/video media to see channel strips here.</div>
			</div>
		`
	}
}
