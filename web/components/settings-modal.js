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

export function showSettingsModal(initialTab) {
	if (document.getElementById('settings-modal')) return
	const modal = document.createElement('div')
	modal.id = 'settings-modal'; modal.className = 'modal-overlay'
	modal.innerHTML = Templates.getMainModalHtml()
	document.body.appendChild(modal)

	const optionalTabDefs = getOptionalSettingsTabs()
	const optionalById = new Map(optionalTabDefs.map(t => [t.id, t]))
	const optionalDisposers = []; const optionalMounted = new Set()
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
		if (!exists) tabName = 'simulation'
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
	}

	modal.querySelector('#system-hw-nvidia-branch')?.addEventListener('change', (e) => {
		const applyBtn = modal.querySelector('#system-hw-nvidia-apply')
		const sel = e?.target || modal.querySelector('#system-hw-nvidia-branch')
		if (applyBtn) applyBtn.disabled = !(sel && sel.value)
	})
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
	modal.querySelector('#system-hw-nvidia-apply')?.addEventListener('click', async () => {
		const branch = modal.querySelector('#system-hw-nvidia-branch')?.value
		if (!branch) return
		if (
			!window.confirm(
				`Apply NVIDIA driver branch ${branch} from the offline pool? This runs apt + DKMS and usually needs a reboot afterward.`,
			)
		)
			return
		if (hwNvStatus) hwNvStatus.textContent = 'Running apply (can take several minutes)…'
		try {
			const res = await api.post('/api/system/gpu-nvidia/apply', {
				branch,
				password: getNuclearPassword(),
			})
			const parts = []
			if (res?.output) parts.push(String(res.output).trim())
			if (res?.error) parts.push(String(res.error))
			const msg =
				parts.filter(Boolean).join('\n\n') || (res?.ok ? 'Apply finished.' : 'Apply finished with warnings.')
			if (hwNvStatus) hwNvStatus.textContent = msg.slice(0, 4000)
			if (res?.rebootLikely && res?.ok)
				window.alert('Reboot the host when ready so the new NVIDIA kernel module loads.')
			await MountHw.refreshSystemHardwarePanel(modal)
		} catch (e) {
			if (hwNvStatus) hwNvStatus.textContent = e?.message || String(e)
		}
	})
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
	modal.querySelector('#decklink-dv-setup')?.addEventListener('click', () => void guiLaunch('desktopvideo_setup'))
	modal.querySelector('#decklink-dv-updater')?.addEventListener('click', () => void guiLaunch('desktop_video_updater'))

	const pluginsListEl = modal.querySelector('#set-plugins-list')
	const pluginsStatusEl = modal.querySelector('#set-plugin-status')
	const pluginAddIdEl = modal.querySelector('#set-plugin-add-id')
	const pluginAddModuleEl = modal.querySelector('#set-plugin-add-module')
	const pluginAddSourceEl = modal.querySelector('#set-plugin-add-source')
	const pluginAddBtn = modal.querySelector('#set-plugin-add-btn')
	const pluginRestartBtn = modal.querySelector('#set-plugin-restart-app')
	const pluginApplyTogglesBtn = modal.querySelector('#set-plugin-apply-toggles')
	const pluginRefreshBtn = modal.querySelector('#set-plugin-refresh')

	function setPluginStatus(msg) {
		if (pluginsStatusEl) pluginsStatusEl.textContent = msg || ''
	}

	function pluginRowHtml(p) {
		const esc = (v) =>
			String(v ?? '')
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;')
		const state = p.status || (p.enabled ? 'enabled' : 'disabled')
		return `
			<div class="settings-group" data-plugin-id="${esc(p.id)}" data-current-enabled="${p.enabled ? '1' : '0'}">
				<label>
					<input type="checkbox" data-plugin-enabled ${p.enabled ? 'checked' : ''}>
					<strong>${esc(p.name || p.id)}</strong>
				</label>
				<div class="settings-note">status: ${esc(state)} · source: ${esc(p.source || 'local')}</div>
			</div>
		`
	}

	async function refreshPlugins() {
		if (!pluginsListEl) return
		try {
			const res = await api.get('/api/plugins')
			const rows = Array.isArray(res?.plugins) ? res.plugins : []
			if (!rows.length) {
				pluginsListEl.innerHTML = '<p class="settings-note">No plugins registered.</p>'
				return
			}
			pluginsListEl.innerHTML = rows.map(pluginRowHtml).join('')
		} catch (e) {
			pluginsListEl.innerHTML = `<p class="settings-note">Failed to load plugins: ${e?.message || e}</p>`
		}
	}

	pluginAddBtn?.addEventListener('click', async () => {
		const id = String(pluginAddIdEl?.value || '').trim()
		if (!id) {
			setPluginStatus('Plugin ID is required.')
			return
		}
		try {
			setPluginStatus('Adding plugin...')
			const res = await api.post('/api/plugins/add', {
				id,
				moduleName: String(pluginAddModuleEl?.value || id).trim() || id,
				source: String(pluginAddSourceEl?.value || 'local').trim() || 'local',
				enabled: true,
			})
			if (pluginAddIdEl) pluginAddIdEl.value = ''
			if (pluginAddModuleEl) pluginAddModuleEl.value = ''
			setPluginStatus(res?.note || 'Plugin added.')
			await refreshPlugins()
		} catch (e) {
			setPluginStatus(`Add failed: ${e?.message || e}`)
		}
	})

	pluginApplyTogglesBtn?.addEventListener('click', async () => {
		if (!pluginsListEl) return
		const rows = Array.from(pluginsListEl.querySelectorAll('[data-plugin-id]'))
		const changed = rows
			.map((row) => {
				const id = row.getAttribute('data-plugin-id')
				const current = row.getAttribute('data-current-enabled') === '1'
				const next = !!row.querySelector('[data-plugin-enabled]')?.checked
				if (!id || current === next) return null
				return { id, action: next ? 'enable' : 'disable' }
			})
			.filter(Boolean)
		if (!changed.length) {
			setPluginStatus('No plugin toggle changes to apply.')
			return
		}
		try {
			setPluginStatus(`Applying ${changed.length} plugin toggle(s)...`)
			const notes = []
			for (const c of changed) {
				const res = await api.post(`/api/plugins/${encodeURIComponent(c.id)}/${c.action}`, {})
				if (res?.note) notes.push(res.note)
			}
			setPluginStatus(notes[notes.length - 1] || `Applied ${changed.length} plugin toggle(s).`)
			await refreshPlugins()
		} catch (err) {
			setPluginStatus(`Apply failed: ${err?.message || err}`)
		}
	})

	pluginRefreshBtn?.addEventListener('click', async () => {
		setPluginStatus('Refreshing plugin list...')
		await refreshPlugins()
		setPluginStatus('')
	})

	pluginRestartBtn?.addEventListener('click', async () => {
		if (!window.confirm('Restart HighAsCG app now? Active operations may be interrupted.')) return
		try {
			const actionPassword = (modal.querySelector('#set-nuclear-action-password') || {}).value || ''
			setPluginStatus('Sending restart signal...')
			const res = await api.post('/api/system/setup/restart-app', { password: actionPassword })
			setPluginStatus(res?.note || 'Restart signal sent.')
		} catch (err) {
			setPluginStatus(`Restart failed: ${err?.message || err}`)
		}
	})

	let autosaveSuspended = true
	const saveStatusEl = modal.querySelector('#settings-save-status')
	let autosaveTimer = null

	async function persistSettings() {
		const settings = Logic.buildSettingsPayload(modal)
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
	modal.addEventListener('input', e => { if (!e.target.closest('#settings-pane-variables')) scheduleSave() })
	modal.addEventListener('change', e => { if (!e.target.closest('#settings-pane-variables')) scheduleSave() })

	void (async () => {
		try {
			const cfg = await api.get('/api/settings')
			Logic.hydrateSettings(modal, cfg)
			await refreshPlugins()
			void mountVariablesPanel(varPane)
			if (initialTab) activateSettingsTab(initialTab)
			autosaveSuspended = false
		} catch (e) { console.error('Load failed:', e) }
	})()
}
