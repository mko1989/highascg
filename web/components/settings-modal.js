/**
 * Settings Modal — multi-tab UI for application configuration.
 */
import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { mountVariablesPanel } from './variables-panel.js'
import { getOptionalSettingsTabs } from '../lib/optional-modules.js'

import * as Templates from './settings-modal-templates.js'
import * as Logic from './settings-modal-logic.js'

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

	function activateSettingsTab(tabName) {
		const exists = !!modal.querySelector(`.settings-tab[data-tab="${tabName}"]`)
		if (!exists) tabName = 'streaming'
		modal.querySelectorAll('.settings-tab, .settings-pane').forEach(x => x.classList.remove('active'))
		const btn = modal.querySelector(`.settings-tab[data-tab="${tabName}"]`); const pane = modal.querySelector(`#settings-pane-${tabName}`)
		if (btn) btn.classList.add('active'); if (pane) pane.classList.add('active')
		const opt = optionalById.get(tabName)
		if (opt && pane && !optionalMounted.has(tabName)) {
			try { const ret = opt.mount(pane); optionalMounted.add(tabName); if (typeof ret === 'function') optionalDisposers.push(ret) } catch (e) { console.warn('[settings-modal] optional mount failed:', tabName, e) }
		}
	}

	modal.querySelector('.settings-tabs')?.addEventListener('click', e => {
		const btn = e.target.closest('.settings-tab'); if (btn && modal.contains(btn)) activateSettingsTab(btn.dataset.tab)
	})

	const close = () => { optionalDisposers.forEach(d => { try { d() } catch {} }); modal.remove() }
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
			void mountVariablesPanel(varPane)
			if (initialTab) activateSettingsTab(initialTab)
			autosaveSuspended = false
		} catch (e) { console.error('Load failed:', e) }
	})()
}
