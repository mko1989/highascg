/**
 * Workspace tab switching.
 */
import { initDeviceView, onDeviceViewTabActivated } from '../components/device-view.js'
import { initAudioMixerView } from '../components/audio-mixer-view.js'

export function initTabs(stateStore) {
	const tabStorageKey = 'highascg_active_tab'
	const activateTab = (target) => {
		document.querySelectorAll('.workspace__tabs .tab').forEach((t) => t.classList.remove('active'))
		document.querySelectorAll('.workspace__content .tab-pane').forEach((p) => {
			p.classList.toggle('active', p.id === `tab-${target}`)
		})
		const tab = document.querySelector(`.workspace__tabs .tab[data-tab="${target}"]`)
		if (tab) tab.classList.add('active')
		try { localStorage.setItem(tabStorageKey, target) } catch { /* ignore */ }
		if (target !== 'pixelmap') {
			window.dispatchEvent(new CustomEvent('highascg-mapping-browser-visibility', { detail: { visible: false } }))
		}
		if (['scenes', 'multiview', 'pixelmap', 'timeline'].includes(target)) requestAnimationFrame(() => document.dispatchEvent(new CustomEvent(`${target === 'pixelmap' ? 'px' : (target === 'multiview' ? 'mv' : target)}-tab-activated`)))
		if (target === 'device-view') {
			initDeviceView(document.getElementById('tab-device-view'))
			onDeviceViewTabActivated()
		}
		if (target === 'audio-mixer-view') initAudioMixerView(document.getElementById('tab-audio-mixer-view'), stateStore)
		window.dispatchEvent(new CustomEvent('highascg-workspace-tab-activated', { detail: { tab: target } }))
	}
	window.highascgActivateWorkspaceTab = activateTab
	const tabBar = document.querySelector('.workspace__tabs')
	if (tabBar) {
		tabBar.addEventListener('click', (e) => {
			const tab = e.target.closest('.tab')
			if (!tab?.dataset?.tab) return
			activateTab(tab.dataset.tab)
		})
	}

	window.addEventListener('highascg-open-pixel-mapping', (ev) => {
		const nodeId = ev.detail?.nodeId
		activateTab('device-view')
		window.dispatchEvent(new CustomEvent('highascg-mapping-browser-visibility', { detail: { visible: true, activate: true, nodeId } }))
		// Also trigger the editor component
		window.dispatchEvent(new CustomEvent('highascg-pixel-mapping-open', { detail: { nodeId } }))
	})

	window.addEventListener('highascg-device-view-select-device', (ev) => {
		const deviceId = ev.detail?.deviceId
		activateTab('device-view')
		window.dispatchEvent(new CustomEvent('highascg-device-view-focus-device', { detail: { deviceId } }))
	})

	let initial = ''
	try { initial = localStorage.getItem(tabStorageKey) || '' } catch { /* ignore */ }
	if (!initial || !document.querySelector(`.tab[data-tab="${initial}"]`)) {
		const firstTab = document.querySelector('.workspace__tabs .tab')
		initial = document.querySelector('.workspace__tabs .tab.active')?.dataset.tab || firstTab?.dataset.tab || ''
	}
	if (initial) activateTab(initial)
}
