/**
 * Dedicated Audio Mixer tab view - full professional audio mixing console.
 */

import { mountAudioMixerViewConsole } from './audio-mixer-view-console.js'
import { refreshLiveAudioConfigured } from '../lib/live-audio-state.js'
import { showLiveAudioMixerModal } from './live-audio-mixer-modal.js'

let mounted = false

/** @param {import('../lib/state-store.js').StateStore} stateStore */
export function initAudioMixerView(root, stateStore) {
	if (!root || mounted) return
	mounted = true

	root.innerHTML = `
		<div class="audio-mixer-view">
			<div class="audio-mixer-view__header">
				<div class="audio-mixer-view__header-left">
					<div class="audio-mixer-view__title-wrap">
						<h2 class="audio-mixer-view__title">Audio Mixer Console</h2>
						<button type="button" class="audio-mixer-view__add-input-btn" title="Configure Live Audio Inputs">+</button>
					</div>
					<p class="audio-mixer-view__subtitle">Full tactile control over program masters, active inputs, and channel routing destinations.</p>
				</div>
				<div class="audio-mixer-view__status-badge">
					<span class="audio-mixer-view__status-dot"></span> OSC Active
				</div>
			</div>
			<div class="audio-mixer-view__console">
				<div class="audio-mixer-view__inputs-bay">
					<div class="audio-mixer-view__inputs-list"></div>
				</div>
				<div class="audio-mixer-view__masters-bay">
					<div class="audio-mixer-view__masters-list"></div>
				</div>
			</div>
		</div>
	`

	const viewRoot = root.querySelector('.audio-mixer-view')
	const addInputBtn = root.querySelector('.audio-mixer-view__add-input-btn')
	if (addInputBtn) {
		addInputBtn.onclick = () => {
			void showLiveAudioMixerModal(stateStore)
		}
	}

	void refreshLiveAudioConfigured(stateStore)

	mountAudioMixerViewConsole(stateStore, {
		root: viewRoot,
		tabPaneEl: root,
		inputsListEl: root.querySelector('.audio-mixer-view__inputs-list'),
		mastersListEl: root.querySelector('.audio-mixer-view__masters-list'),
	})
}

