/**
 * Settings Modal — multi-tab UI for application configuration.
 */
import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { mountVariablesPanel } from './variables-panel.js'
import { getOptionalSettingsTabs } from '../lib/optional-modules.js'

import * as Templates from './settings-modal-templates.js'
import * as Logic from './settings-modal-logic.js'
import * as MountHw from './settings-modal-mount-hardware.js'
import { mountLiveAudioSettingsPanel } from './settings-live-audio-panel.js'
export function showSettingsModal(initialTab) {
	if (document.getElementById('settings-modal')) return
	const modal = document.createElement('div')
	modal.id = 'settings-modal'; modal.className = 'modal-overlay'
	modal.innerHTML = Templates.getMainModalHtml()
	document.body.appendChild(modal)

	const optionalTabDefs = getOptionalSettingsTabs()
	const optionalById = new Map(optionalTabDefs.map(t => [t.id, t]))
	const optionalDisposers = []
	const optionalMounted = new Set()
	let liveAudioMounted = false
	/** @type {(() => Promise<void>) | null} */
	let refreshLiveAudioPanel = null
	const tabsRow = modal.querySelector('.settings-tabs'); const varTab = tabsRow?.querySelector('[data-tab="variables"]')
	const panesRow = modal.querySelector('.settings-panes'); const varPane = modal.querySelector('#settings-pane-variables')
	
	optionalTabDefs.forEach(opt => {
		const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'settings-tab'; btn.dataset.tab = opt.id; btn.textContent = opt.label
		if (tabsRow && varTab) tabsRow.insertBefore(btn, varTab)
		const pane = document.createElement('div'); pane.className = 'settings-pane'; pane.id = `settings-pane-${opt.id}`
		if (panesRow && varPane) panesRow.insertBefore(pane, varPane)
	})

	MountHw.wireMediaUsbMountListeners(modal)

	function activateSettingsTab(tabName) {
		const exists = !!modal.querySelector(`.settings-tab[data-tab="${tabName}"]`)
		if (!exists) tabName = 'defaults'
		modal.querySelectorAll('.settings-tab, .settings-pane').forEach(x => x.classList.remove('active'))
		const btn = modal.querySelector(`.settings-tab[data-tab="${tabName}"]`)
		const pane = modal.querySelector(`#settings-pane-${tabName}`)
		if (btn) btn.classList.add('active')
		if (pane) pane.classList.add('active')
		const opt = optionalById.get(tabName)
		if (opt && pane && !optionalMounted.has(tabName)) {
			try {
				const ret = opt.mount(pane)
				optionalMounted.add(tabName)
				if (typeof ret === 'function') optionalDisposers.push(ret)
			} catch (e) {
				console.warn('[settings-modal] optional mount failed:', tabName, e)
			}
		}
		if (tabName === 'media-usb') {
			void MountHw.refreshMediaMountPanel(modal)
			void MountHw.refreshExfatSyncPanel(modal)
		}
		if (tabName === 'system-hardware') void MountHw.refreshSystemHardwarePanel(modal)
		if (tabName === 'decklink') void MountHw.refreshDecklinkPanel(modal)
		if (tabName === 'live-audio' && pane && !liveAudioMounted) {
			liveAudioMounted = true
			void mountLiveAudioSettingsPanel(pane, {
				getLaunchPassword: () => (modal.querySelector('#set-nuclear-action-password') || {}).value || '',
			}).then((refresh) => {
				if (typeof refresh === 'function') refreshLiveAudioPanel = refresh
			})
		}
		if (tabName === 'live-audio' && refreshLiveAudioPanel) void refreshLiveAudioPanel()
	}

	modal.querySelector('#system-hw-nvidia-refresh')?.addEventListener('click', () => void MountHw.refreshSystemHardwarePanel(modal))
	modal.querySelector('#decklink-refresh-btn')?.addEventListener('click', () => void MountHw.refreshDecklinkPanel(modal))

	modal.querySelector('.settings-tabs')?.addEventListener('click', e => {
		const btn = e.target.closest('.settings-tab'); if (btn && modal.contains(btn)) activateSettingsTab(btn.dataset.tab)
	})

	const close = () => {
		optionalDisposers.forEach(d => {
			try {
				d()
			} catch {}
		})
		document.querySelectorAll('[data-media-mount-confirm]').forEach(el => {
			try {
				el.remove()
			} catch {}
		})
		modal.remove()
	}
	modal.querySelector('#settings-close').onclick = close; modal.querySelector('#settings-cancel').onclick = close

	const nuclearStatus = modal.querySelector('#set-nuclear-status')
	const getNuclearPassword = () => (modal.querySelector('#set-nuclear-action-password') || {}).value || ''
	const postNuclear = async (path) => {
		if (nuclearStatus) nuclearStatus.textContent = 'Running...'
		try {
			await api.post(path, { password: getNuclearPassword() })
			if (nuclearStatus) nuclearStatus.textContent = 'Command sent.'
		} catch (e) {
			if (nuclearStatus) nuclearStatus.textContent = e?.message || String(e)
		}
	}
	modal.querySelector('#set-nuclear-restart-wm')?.addEventListener('click', async () => {
		await postNuclear('/api/system/setup/restart-window-manager')
	})
	modal.querySelector('#set-nuclear-reboot')?.addEventListener('click', async () => {
		if (!window.confirm('Reboot host now? This will interrupt all outputs.')) return
		await postNuclear('/api/system/setup/reboot')
	})

	const hwNvStatus = modal.querySelector('#system-hw-nvidia-status')
	const decklinkStatusLine = modal.querySelector('#decklink-status-line')
	async function guiLaunch(action) {
		const st =
			action === 'nvidia-settings' ? hwNvStatus || modal.querySelector('#system-hw-nvidia-status')
			:	decklinkStatusLine || modal.querySelector('#decklink-status-line')
		if (st) st.textContent = 'Launching…'
		try {
			const res = await api.post('/api/system/gui-launch', {
				action,
				password: getNuclearPassword(),
			})
			if (st) st.textContent = res?.exe ? `Started: ${res.exe}` : 'Started.'
		} catch (e) {
			if (st) st.textContent = e?.message || String(e)
		}
	}
	modal.querySelector('#system-hw-nvidia-settings')?.addEventListener('click', () => void guiLaunch('nvidia-settings'))
	modal.querySelector('#decklink-dv-setup')?.addEventListener('click', () => void guiLaunch('DesktopVideoSetup'))
	modal.querySelector('#decklink-dv-updater')?.addEventListener('click', () => void guiLaunch('DesktopVideoUpdater'))

	let autosaveSuspended = true
	const saveStatusEl = modal.querySelector('#settings-save-status')
	let autosaveTimer = null

	async function persistSettings() {
		const settings = Logic.buildSettingsPayload(modal)
		settingsState.notify()
		try {
			const res = await api.post('/api/settings', settings)
			if (res.ok) {
				await settingsState.load()
				document.dispatchEvent(new CustomEvent('highascg-settings-applied', { detail: res }))
				if (saveStatusEl) {
					saveStatusEl.textContent = 'Saved'
					clearTimeout(saveStatusEl._hideT); saveStatusEl._hideT = setTimeout(() => { saveStatusEl.textContent = '' }, 1800)
				}
			}
		} catch (e) { if (saveStatusEl) saveStatusEl.textContent = 'Save failed'; console.error('[Settings]', e) }
	}

	const scheduleSave = () => { if (!autosaveSuspended) { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(persistSettings, 600) } }
	const onSettingsFieldChange = (e) => {
		if (e.target.closest('#settings-pane-variables')) return
		if (e.target.closest('#settings-pane-live-audio')) return
		if (e.target.closest('#settings-pane-defaults')) Logic.syncEditorDefaultsFromModal(modal)
		scheduleSave()
	}
	modal.addEventListener('input', onSettingsFieldChange)
	modal.addEventListener('change', onSettingsFieldChange)

	void (async () => {
		try {
			const cfg = await api.get('/api/settings')
			Logic.hydrateSettings(modal, cfg)
			Logic.syncEditorDefaultsFromModal(modal)
			void mountVariablesPanel(varPane)
			if (initialTab) activateSettingsTab(initialTab)
			autosaveSuspended = false
		} catch (e) { console.error('Load failed:', e) }
	})()
}
