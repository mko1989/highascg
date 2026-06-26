import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { debounceAsync, postAudioVolume } from '../lib/audio-mixer-volume-api.js'
import { audioOutputRoutesForLayout } from '../lib/audio-routes.js'
import { resolveProgramLayoutForProgramChannel } from '../lib/program-audio-layouts.js'
import { sceneState } from '../lib/scene-state.js'
import { showScenesToast } from './scenes-editor-support.js'
import { collectProgramAudioRows, collectLiveInputMeterRows, meterMetaForInputRow } from '../lib/audio-mixer-rows.js'
import { createAudioMeterLoop } from '../lib/audio-mixer-meter-loop.js'
import { escapeHtml, escapeAttr } from '../lib/audio-mixer-ui.js'
import {
	faderPercentToLinearGain,
	formatVolumeDb,
	linearGainToFaderPercent,
} from '../lib/audio-volume-scale.js'
import { bindFaderResetGestures, UNITY_LINEAR_GAIN } from '../lib/audio-mixer-fader-bind.js'
import { syncFaderUI, syncMuteUI, syncAllSolosUI } from './audio-mixer-panel-sync.js'
import { settingsState } from '../lib/settings-state.js'
import { readLiveAudioCasparSettings } from '../lib/live-audio-inputs.js'
import { getMultiPlayTargets, setMultiPlayTargets } from '../lib/live-audio-play-targets.js'
import {
	disableLiveAudioPgmRoute,
	enableLiveAudioPgmRoute,
	pgmDestLayerForSlot,
} from '../lib/live-audio-routing.js'
import {
	programBusChannelCount,
	renderBusMeterBankHtml,
	registerBusMeterFills,
} from '../lib/audio-mixer-bus-meters.js'

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
			labelMax: 14,
			labelTailChars: 0,
		})
		const channelMap = stateStore.getState()?.channelMap || {}
		const settings = settingsState.getSettings()
		const liveInputMeters = collectLiveInputMeterRows(channelMap)

		if (liveInputMeters.length > 0) {
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
						return `<button type="button" class="audio-mixer-view__matrix-btn${active ? ' audio-mixer-view__matrix-btn--active' : ''}" data-route="${rt.value}" title="Route to ${rt.label}">${rt.label}</button>`
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
					<div class="audio-mixer-view__master-badge">PGM</div>
				</div>
			`
			mastersListEl.appendChild(strip)
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
