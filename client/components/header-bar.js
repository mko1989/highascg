/**
 * Header bar with project name, Save, Load, server config comparison strip.
 * @see main_plan.md Prompt 20, FEAT-1
 */

import { projectState } from '../lib/project-state.js'
import { sceneState } from '../lib/scene-state.js'
import { programOutputState } from '../lib/program-output-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { multiviewState } from '../lib/multiview-state.js'
import { api } from '../lib/api-client.js'
import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { showSettingsModal } from './settings-modal.js'
import { settingsState } from '../lib/settings-state.js'
import { showSyncModal } from './sync-modal.js'
import { showPublishModal } from './publish-modal.js'
import { showLedTestModal, getLedTestSettings, getLedTestShowGridForChannel } from './led-test-modal.js'
import { createHeaderAudioMonitor } from './header-bar-audio.js'
import { markLocalProjectSaved } from '../lib/project-remote-sync.js'
import { markServerProjectSynced, resetServerProjectSync } from '../lib/server-project-sync.js'
import { getAppWs } from '../lib/app-runtime.js'
import { flushSceneDeckSync } from '../lib/app-scene-deck.js'
import { initConfigStrip } from './header-bar-config-strip.js'
import { projectFileIdFromName } from '../lib/project-files.js'
import { importProjectWithHardwareReconcile } from '../lib/project-import-flow.js'
import { showLoadProjectModal } from './load-project-modal.js'
import { applyDefaultUntitledProjectLocally } from '../lib/default-project.js'

import { initLedTestCard } from './header-bar-led-test.js'
import { initStreamingBadge } from './header-bar-streaming.js'

/**
 * @param {HTMLElement} headerEl - Header element (contains title + status)
 * @param {HTMLElement} statusEl - Status/ws area
 * @param {import('../lib/state-store.js').StateStore} [stateStore] - for configComparison updates
 */
export function initHeaderBar(headerEl, statusEl, stateStore) {
	const titleEl = headerEl.querySelector('.header__title')
	if (!titleEl) return

	// Project name (editable)
	const nameWrap = document.createElement('div')
	nameWrap.className = 'header-project'
	const nameInp = document.createElement('input')
	nameInp.className = 'header-project__name'
	nameInp.type = 'text'
	nameInp.placeholder = 'Project name'
	nameInp.value = projectState.getProjectName()
	nameInp.title = 'Project name'
	nameInp.addEventListener('change', () => {
		projectState.setProjectName(nameInp.value)
	})
	nameInp.addEventListener('blur', () => {
		projectState.setProjectName(nameInp.value)
	})
	nameWrap.appendChild(nameInp)

	// Save / Load buttons
	const saveBtn = document.createElement('button')
	saveBtn.type = 'button'
	saveBtn.className = 'header-btn header-btn--save'
	saveBtn.innerHTML = `
		<div class="header-btn__icons">
			<img src="assets/arrow-right.svg" class="header-btn__arrow">
			<img src="assets/save.svg" class="header-btn__disk">
		</div>
	`
	saveBtn.title =
		'Save project to server (includes looks + Device View routing via server hardwareConfig). Shift+click = download JSON file only.'

	const loadBtn = document.createElement('button')
	loadBtn.type = 'button'
	loadBtn.className = 'header-btn header-btn--load'
	loadBtn.setAttribute('aria-label', 'Load project')
	loadBtn.innerHTML = `
		<div class="header-btn__icons">
			<img src="assets/arrow-left.svg" class="header-btn__arrow">
			<img src="assets/save.svg" class="header-btn__disk">
		</div>
	`
	loadBtn.title = 'Load project (Shift+click = quick file pick without dialog)'

	const fileInput = document.createElement('input')
	fileInput.type = 'file'
	fileInput.accept = '.json,application/json'
	fileInput.style.display = 'none'

	function showHeaderToast(msg, type = 'info') {
		let container = document.getElementById('header-toast-container')
		if (!container) {
			container = document.createElement('div')
			container.id = 'header-toast-container'
			container.style.cssText =
				'position:fixed;bottom:16px;right:16px;z-index:10000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none;'
			document.body.appendChild(container)
		}
		const toast = document.createElement('div')
		const bg =
			type === 'error' ? '#b91c1c' : type === 'success' ? '#15803d' : '#1d4ed8'
		toast.style.cssText = `padding:8px 14px;border-radius:6px;font-size:13px;font-family:${UI_FONT_FAMILY};max-width:320px;word-break:break-word;box-shadow:0 2px 10px rgba(0,0,0,.35);background:${bg};color:#fff;pointer-events:auto;`
		toast.textContent = msg
		toast.setAttribute('role', 'status')
		container.appendChild(toast)
		setTimeout(() => toast.remove(), type === 'error' ? 6500 : 3800)
	}

	async function saveToServer() {
		const project = projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
		const id = projectFileIdFromName(project.name || projectState.getProjectName())
		try {
			await api.post('/api/project/save', { project, id })
			markLocalProjectSaved()
			markServerProjectSynced()
			showHeaderToast('Saved', 'success')
		} catch (e) {
			showHeaderToast('Save failed: ' + (e?.message || e), 'error')
		}
	}

	function saveToFile() {
		const project = projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
		const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = (project.name || 'project').replace(/\s+/g, '_') + '.json'
		a.click()
		URL.revokeObjectURL(url)
	}

	function loadFromFile(file) {
		const r = new FileReader()
		r.onload = () => {
			void (async () => {
				try {
					const project = JSON.parse(r.result)
					await importProjectWithHardwareReconcile(project, {
						projectState,
						sceneState,
						timelineState,
						multiviewState,
						programOutputState,
						stateStore,
						showToast: showHeaderToast,
						onNameSync: (name) => {
							nameInp.value = name
						},
						source: 'file',
					})
					markServerProjectSynced()
					const appWs = getAppWs()
					if (appWs) flushSceneDeckSync(appWs, sceneState)
				} catch (e) {
					showHeaderToast('Invalid project file: ' + (e?.message || e), 'error')
				}
			})()
		}
		r.readAsText(file)
	}

	saveBtn.addEventListener('click', (e) => {
		if (e.shiftKey) saveToFile()
		else void saveToServer()
	})
	saveBtn.title = 'Save: click = save to server (and Caspar DATA), Shift+click = download JSON file'

	loadBtn.addEventListener('click', (e) => {
		if (e.shiftKey) fileInput.click()
		else {
			showLoadProjectModal({
				showToast: showHeaderToast,
				stateStore,
				onNameSync: (name) => {
					nameInp.value = name
				},
			})
		}
	})
	loadBtn.title = 'Load project (Shift+click = upload JSON without dialog)'

	document.body.appendChild(fileInput)

	const newProjectBtn = document.createElement('button')
	newProjectBtn.type = 'button'
	newProjectBtn.className = 'header-btn'
	newProjectBtn.textContent = 'New project'
	newProjectBtn.title = 'Discard the current project in memory and start empty (save first if you need a file)'
	function startFreshProject() {
		if (!confirm('Start a fresh project? Unsaved changes in memory will be lost.')) return
		resetServerProjectSync()
		applyDefaultUntitledProjectLocally()
		nameInp.value = projectState.getProjectName()
	}
	newProjectBtn.addEventListener('click', (e) => {
		e.preventDefault()
		startFreshProject()
	})

	function updateSyncVisibility(cfg) {
		// Buttons removed as requested (redundant with save/load)
	}
	settingsState.subscribe(updateSyncVisibility)
	updateSyncVisibility(settingsState.getSettings())

	fileInput.addEventListener('change', () => {
		const f = fileInput.files?.[0]
		if (f) loadFromFile(f)
		fileInput.value = ''
	})

	// Server config vs module (FEAT-1)
	const serverBtn = document.createElement('button')
	serverBtn.type = 'button'
	serverBtn.className = 'header-btn header-btn--server'
	serverBtn.textContent = 'Server ▾'
	serverBtn.title = 'Compare running CasparCG config with module screen settings'

	const { renderConfigComparison } = initConfigStrip(headerEl, serverBtn)

	// Settings — directly after Server
	const settingsBtn = document.createElement('button')
	settingsBtn.type = 'button'
	settingsBtn.className = 'header-btn header-btn--settings'
	settingsBtn.innerHTML = '⚙'
	settingsBtn.title = 'Application Settings (Ctrl+,)'
	settingsBtn.setAttribute('aria-label', 'Application settings')
	settingsBtn.addEventListener('click', () => showSettingsModal())


	const ledTestWrap = document.createElement('div')
	ledTestWrap.className = 'header-led-test'
	
	initLedTestCard(ledTestWrap, stateStore)
	initStreamingBadge(ledTestWrap)

	const audioGroup = createHeaderAudioMonitor(stateStore)

	if (stateStore) {
		const apply = () => {
			const c = stateStore.getState()?.configComparison
			if (c) renderConfigComparison(c)
		}
		stateStore.on('*', apply)
		stateStore.on('configComparison', apply)
		apply()
	}

	// Layout: [title] [project · save · load · new · sync] [server · settings] … [headphones · eyes]
	const autosaveIndicator = document.createElement('span')
	autosaveIndicator.className = 'header-autosave-indicator'
	autosaveIndicator.style.cssText = 'font-size: 11px; opacity: 0; color: #a1a1aa; margin-left: 8px; transition: opacity 0.5s ease; white-space: nowrap; user-select: none;'
	window.addEventListener('project-autosaved', (ev) => {
		autosaveIndicator.textContent = 'Autosaved at ' + ev.detail.time
		autosaveIndicator.style.opacity = '1'
	})

	const leftWrap = document.createElement('div')
	leftWrap.className = 'header-left'
	leftWrap.append(nameWrap, saveBtn, loadBtn, newProjectBtn, autosaveIndicator)

	const midWrap = document.createElement('div')
	midWrap.className = 'header-mid'
	midWrap.append(serverBtn, settingsBtn, ledTestWrap)

	const rightWrap = document.createElement('div')
	rightWrap.className = 'header-right'
	rightWrap.append(audioGroup, statusEl)

	titleEl.insertAdjacentElement('afterend', leftWrap)
	leftWrap.insertAdjacentElement('afterend', midWrap)
	midWrap.insertAdjacentElement('afterend', rightWrap)

	projectState.on('change', () => {
		nameInp.value = projectState.getProjectName()
	})
}
