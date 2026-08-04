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
import * as Companion from './settings-modal-companion.js'
import * as SystemUpdates from './settings-modal-system-updates.js'
import { wireDiagnosticsPanel } from './settings-modal-diagnostics.js'
import { wireTailscalePanel } from './settings-modal-tailscale.js'
import { mountLiveAudioSettingsPanel } from './settings-live-audio-panel.js'
import { mountV4l2InputsSettingsPanel } from './settings-v4l2-inputs-panel.js'
import { syncNuclearPasswordVisibility, getNuclearPasswordFromModal } from '../lib/settings-nuclear-shared.js'
export function showSettingsModal(initialTab) {
	if (document.getElementById('settings-modal')) return
	const modal = document.createElement('div')
	modal.id = 'settings-modal'; modal.className = 'modal-overlay'
	modal.innerHTML = Templates.getMainModalHtml()
	document.body.appendChild(modal)
	syncNuclearPasswordVisibility(modal)

	const optionalTabDefs = getOptionalSettingsTabs()
	const optionalById = new Map(optionalTabDefs.map(t => [t.id, t]))
	const optionalDisposers = []
	const optionalMounted = new Set()
	let liveAudioMounted = false
	/** @type {(() => Promise<void>) | null} */
	let refreshLiveAudioPanel = null
	let usbVideoMounted = false
	/** @type {(() => Promise<void>) | null} */
	let refreshUsbVideoPanel = null
	/** @type {ReturnType<typeof Companion.wireCompanionConnectionStatus> | null} */
	let companionConnectionCtl = null
	const tabsRow = modal.querySelector('.settings-tabs'); const varTab = tabsRow?.querySelector('[data-tab="variables"]')
	const panesRow = modal.querySelector('.settings-panes'); const varPane = modal.querySelector('#settings-pane-variables')
	
	optionalTabDefs.forEach(opt => {
		const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'settings-tab'; btn.dataset.tab = opt.id; btn.textContent = opt.label
		if (tabsRow && varTab) tabsRow.insertBefore(btn, varTab)
		const pane = document.createElement('div'); pane.className = 'settings-pane'; pane.id = `settings-pane-${opt.id}`
		if (panesRow && varPane) panesRow.insertBefore(pane, varPane)
	})

	MountHw.wireMediaUsbMountListeners(modal)
	companionConnectionCtl = Companion.wireCompanionConnectionStatus(modal)
	SystemUpdates.wireSystemUpdatesPanel(modal, { getNuclearPassword: () => getNuclearPasswordFromModal(modal) })
	wireDiagnosticsPanel(modal)
	wireTailscalePanel(modal)

	modal.querySelector('#set-compose-preview-mode')?.addEventListener('change', () => Logic.syncComposePreviewModeVisibility(modal))
	modal.querySelector('#set-compose-preview-fps')?.addEventListener('input', () => Logic.syncComposePreviewFpsLabel(modal))
	modal.querySelector('#set-compose-preview-jpeg-q')?.addEventListener('input', () => Logic.syncComposePreviewJpegQualityLabel(modal))
	modal.querySelector('#set-nuclear-require-pass')?.addEventListener('change', () => syncNuclearPasswordVisibility(modal))

	function activateSettingsTab(tabName) {
		const exists = !!modal.querySelector(`.settings-tab[data-tab="${tabName}"]`)
		if (!exists) tabName = 'defaults'
		const prevActive = modal.querySelector('.settings-tab.active')?.dataset?.tab
		if (prevActive === 'companion') companionConnectionCtl?.onTabInactive()
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
		if (tabName === 'media-usb') void MountHw.refreshExfatSyncPanel(modal)
		if (tabName === 'system-updates') void SystemUpdates.refreshSystemUpdatesPanel(modal)
		if (tabName === 'system-hardware') {
			void MountHw.refreshSystemHardwarePanel(modal)
			void MountHw.refreshSystemTimePanel(modal)
			MountHw.wireSystemTimeListeners(modal)
		}
		if (tabName === 'decklink') void MountHw.refreshDecklinkPanel(modal)
		if (tabName === 'live-audio' && pane && !liveAudioMounted) {
			liveAudioMounted = true
			void mountLiveAudioSettingsPanel(pane, {
				getLaunchPassword: () => getNuclearPasswordFromModal(modal),
			}).then((refresh) => {
				if (typeof refresh === 'function') refreshLiveAudioPanel = refresh
			})
		}
		if (tabName === 'live-audio' && refreshLiveAudioPanel) void refreshLiveAudioPanel()
		if (tabName === 'usb-video' && pane && !usbVideoMounted) {
			usbVideoMounted = true
			void mountV4l2InputsSettingsPanel(pane).then((refresh) => {
				if (typeof refresh === 'function') refreshUsbVideoPanel = refresh
			})
		}
		if (tabName === 'usb-video' && refreshUsbVideoPanel) void refreshUsbVideoPanel()
		if (tabName === 'companion') companionConnectionCtl?.onTabActive()
		if (tabName === 'nuclear' && typeof refreshNuclearSetup === 'function') void refreshNuclearSetup()
		modal.dispatchEvent(new CustomEvent('settings-tab-activated', { detail: { tab: tabName } }))
	}

	modal.querySelector('#decklink-refresh-btn')?.addEventListener('click', () => void MountHw.refreshDecklinkPanel(modal))
	modal.querySelector('#system-hw-refresh-btn')?.addEventListener('click', () => void MountHw.refreshSystemHardwarePanel(modal))

	modal.querySelector('.settings-tabs')?.addEventListener('click', e => {
		const btn = e.target.closest('.settings-tab'); if (btn && modal.contains(btn)) activateSettingsTab(btn.dataset.tab)
	})

	const close = () => {
		companionConnectionCtl?.dispose()
		optionalDisposers.forEach(d => {
			try {
				d()
			} catch {}
		})
		modal.remove()
	}
	modal.querySelector('#settings-close').onclick = close; modal.querySelector('#settings-cancel').onclick = close

	const nuclearStatus = modal.querySelector('#set-nuclear-status')
	const casparStatusEl = modal.querySelector('#set-nuclear-caspar-status')
	const installDiskBtn = modal.querySelector('#set-nuclear-install-disk')
	const getNuclearPassword = () => getNuclearPasswordFromModal(modal)
	const postNuclear = async (path) => {
		if (nuclearStatus) nuclearStatus.textContent = 'Running...'
		try {
			await api.post(path, { password: getNuclearPassword() })
			if (nuclearStatus) nuclearStatus.textContent = 'Command sent.'
		} catch (e) {
			if (nuclearStatus) nuclearStatus.textContent = e?.message || String(e)
		}
	}
	const postNuclearJson = async (path) => {
		if (nuclearStatus) nuclearStatus.textContent = 'Running...'
		try {
			const res = await api.post(path, { password: getNuclearPassword() })
			if (nuclearStatus) nuclearStatus.textContent = res?.note || 'Done.'
			return res
		} catch (e) {
			if (nuclearStatus) nuclearStatus.textContent = e?.message || String(e)
			return null
		}
	}
	const refreshNuclearSetup = async () => {
		try {
			const setup = await api.get('/api/system/setup')
			const cal = setup?.calamares || {}
			if (installDiskBtn) {
				const canLaunch = cal.installed === true && cal.sudoLaunchAvailable !== false
				installDiskBtn.disabled = !canLaunch
				if (!cal.installed) {
					installDiskBtn.title = 'Calamares not installed on this system'
				} else if (cal.sudoLaunchAvailable === false) {
					installDiskBtn.title =
						'Passwordless sudo for Calamares not configured — run: sudo bash scripts/setup/12-passwordless-sudo.sh'
				} else {
					installDiskBtn.title = ''
				}
			}
			const cs = setup?.casparService || {}
			if (casparStatusEl) {
				const inh = cs.inhibited ? ' (stopped — autorestart off)' : ''
				casparStatusEl.textContent = `Caspar scanner: ${cs.scanner || '?'} · server: ${cs.server || '?'}${inh}`
			}
		} catch {
			if (casparStatusEl) casparStatusEl.textContent = 'Caspar status: unavailable'
		}
	}
	modal.querySelector('#set-nuclear-restart-wm')?.addEventListener('click', async () => {
		await postNuclear('/api/system/setup/restart-window-manager')
	})
	modal.querySelector('#set-nuclear-reboot')?.addEventListener('click', async () => {
		if (!window.confirm('Reboot host now? This will interrupt all outputs.')) return
		await postNuclear('/api/system/setup/reboot')
	})
	installDiskBtn?.addEventListener('click', async () => {
		/* WO-423 (owner): the launcher stops CasparCG AND this GUI so only the installer is on
		 * the glass; both come back automatically when the installer closes. */
		if (!window.confirm('Open Calamares disk installer on the local display (:0)?\n\nCasparCG and the HighAsCG GUI will CLOSE so only the installer is on screen. They restart when the installer exits.')) return
		await postNuclearJson('/api/system/setup/install')
	})
	modal.querySelector('#set-nuclear-caspar-stop')?.addEventListener('click', async () => {
		if (!window.confirm('Stop CasparCG now? Output stops until you start it again.')) return
		await postNuclearJson('/api/system/setup/caspar/stop')
		setTimeout(() => void refreshNuclearSetup(), 3000)
		setTimeout(() => void refreshNuclearSetup(), 30000)
		setTimeout(() => void refreshNuclearSetup(), 90000)
	})
	modal.querySelector('#set-nuclear-caspar-start')?.addEventListener('click', async () => {
		await postNuclearJson('/api/system/setup/caspar/start')
		void refreshNuclearSetup()
	})
	modal.querySelector('#set-nuclear-caspar-restart')?.addEventListener('click', async () => {
		if (!window.confirm('Restart CasparCG now? Brief output interruption.')) return
		await postNuclearJson('/api/system/setup/caspar/restart')
		setTimeout(() => void refreshNuclearSetup(), 3000)
		setTimeout(() => void refreshNuclearSetup(), 30000)
		setTimeout(() => void refreshNuclearSetup(), 90000)
	})
	void refreshNuclearSetup()

	const decklinkStatusLine = modal.querySelector('#decklink-status-line')
	const operatorStatus = modal.querySelector('#system-hw-operator-status')
	async function guiLaunch(action) {
		const st =
			action === 'firefox' || action === 'file-manager' ? operatorStatus
			:	decklinkStatusLine || modal.querySelector('#decklink-status-line')
		if (st) st.textContent = 'Launching…'
		try {
			const res = await api.post('/api/system/gui-launch', {
				action,
				password: getNuclearPassword(),
			})
			if (st) st.textContent = res?.raised ? 'Raised existing window.' : res?.exe ? `Started: ${res.exe}` : 'Started.'
		} catch (e) {
			if (st) st.textContent = e?.message || String(e)
		}
	}
	modal.querySelector('#system-hw-open-firefox')?.addEventListener('click', () => void guiLaunch('firefox'))
	modal.querySelector('#system-hw-open-file-manager')?.addEventListener('click', () => void guiLaunch('file-manager'))
	modal.querySelector('#decklink-dv-setup')?.addEventListener('click', () => void guiLaunch('desktopvideo_setup'))
	modal.querySelector('#decklink-dv-updater')?.addEventListener('click', () => void guiLaunch('desktop_video_updater'))

	let autosaveSuspended = true
	const saveStatusEl = modal.querySelector('#settings-save-status')
	let autosaveTimer = null

	async function persistSettings() {
		const settings = Logic.buildSettingsPayload(modal)
		if (settings.composePreview) settingsState.settings.composePreview = { ...settings.composePreview }
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
			// Screen labels + streaming channel moved to the Devices tab (owner request 2026-07-18).
		} catch (e) { console.error('Load failed:', e) }
	})()
}
