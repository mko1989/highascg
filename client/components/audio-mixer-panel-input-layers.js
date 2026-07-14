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
 * @param {HTMLElement} inputsEl
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
export function renderInspectorProgramInputLayers(
	inputsEl,
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

		const divider = document.createElement('div')
		divider.className = 'audio-mixer__channel-divider'
		divider.textContent = g.title
		inputsEl.appendChild(divider)

		for (const r of list) {
			const row = document.createElement('div')
			row.className = 'audio-mixer__bus-layer'
			const masterLayout = resolveProgramLayoutForProgramChannel(settings, channelMap, r.ch)
			const routes = audioOutputRoutesForLayout(masterLayout)
			const options = routes
				.map(
					(rt) =>
						`<option value="${escapeAttr(rt.value)}"${rt.value === r.audioRoute ? ' selected' : ''}>${escapeHtml(rt.label)}</option>`,
				)
				.join('')

			// Screens/PGM channel row for panel view
			const pgmButtonsHtmlPanel = programChannels
				.map((pc) => {
					const ch = Number(pc)
					const isHost = ch === r.ch
					const active = isHost
					return `<button type="button" class="audio-mixer-view__matrix-btn${active ? ' audio-mixer-view__matrix-btn--active' : ''}" ${!isHost ? 'disabled' : ''} title="${isHost ? 'Host channel' : 'Cross-screen audio fan-out: planned (WO-157)'}">${ch}</button>`
				})
				.join('')
			const screensRowHtmlPanel = r.sceneId ? `
				<div class="audio-mixer-view__matrix" style="margin-bottom: 8px;">
					<div class="audio-mixer-view__matrix-title">Screens</div>
					<div class="audio-mixer-view__matrix-buttons">${pgmButtonsHtmlPanel}</div>
				</div>
			` : ''

			const routeHtml = r.sceneId ? `<select class="audio-mixer__route-sel" data-ch="${r.ch}" data-layer="${r.layer}" data-scene="${escapeAttr(r.sceneId)}" aria-label="Stereo pair" title="Audio stereo pair routing destination">${options}</select>` : ''
			const isSolo = audioMixerState.isSoloed(r.key)
			const soloHtml = `<button type="button" class="audio-mixer__solo-btn${isSolo ? ' audio-mixer__solo-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Solo this layer to monitor">S</button>`
			const isMuted = !!r.muted
			const muteHtml = `<button type="button" class="audio-mixer__mute-btn${isMuted ? ' audio-mixer__mute-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Mute this layer">M</button>`
			const labelTitle = r.labelTitle || r.label
			row.innerHTML = `
				${screensRowHtmlPanel}
				<div class="audio-mixer__layer-info">
					<div class="audio-mixer__layer-label" title="${escapeAttr(labelTitle)}">${escapeHtml(r.label)}</div>
					<div class="audio-mixer__layer-actions">
						${soloHtml}
						${muteHtml}
						${routeHtml}
					</div>
				</div>
				<div class="audio-mixer__layer-fader-row">
					<div class="audio-mixer__meter-horizontal" aria-hidden="true">
						<div class="audio-mixer__meter-fill"></div>
					</div>
					<input type="range" class="audio-mixer__fader-horizontal" min="0" max="100" value="${linearGainToFaderPercent(r.v)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
					<span class="audio-mixer__fader-val">${formatVolumeDb(r.v)}</span>
				</div>
			`
			if (r?.liveAudioSlot != null) {
				row.title = 'Click to inspect / remove'
				row.addEventListener('click', (e) => {
					const t = /** @type {HTMLElement} */ (e.target)
					if (t?.closest?.('button, input, select, textarea')) return
					window.dispatchEvent(new CustomEvent('live-audio-input-select', { detail: { slot: r.liveAudioSlot } }))
				})
			}
			inputsEl.appendChild(row)

			meterFills.set(r.key, row.querySelector('.audio-mixer__meter-fill'))
			meterLayerMeta.set(r.key, meterMetaForInputRow(r))

			const soloBtn = row.querySelector('.audio-mixer__solo-btn')
			if (soloBtn) {
				soloBtn.onclick = async (e) => {
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
				}
			}

			const muteBtn = row.querySelector('.audio-mixer__mute-btn')
			if (muteBtn) {
				muteBtn.onclick = async () => {
					const nextMuted = !muteBtn.classList.contains('audio-mixer__mute-btn--active')

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
				}
			}

			const fader = row.querySelector('.audio-mixer__fader-horizontal')
			const valEl = row.querySelector('.audio-mixer__fader-val')
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

			const routeSel = row.querySelector('.audio-mixer__route-sel')
			if (routeSel) {
				routeSel.addEventListener('change', () => {
					const scene = sceneState.getScene(r.sceneId)
					if (!scene) return
					const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
					if (idx >= 0) {
						sceneState.patchLayer(r.sceneId, idx, { audioRoute: routeSel.value })
						showScenesToast('Route changed. Re-take the look to apply to output.', 'info')
					}
				})
			}
		}
	})
}
