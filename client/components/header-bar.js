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
import { createHeaderAudioMonitor } from './header-bar-audio.js'
import { markLocalProjectSaved } from '../lib/project-remote-sync.js'
import { markServerProjectSynced } from '../lib/server-project-sync.js'
import { getAppWs } from '../lib/app-runtime.js'
import { flushSceneDeckSync } from '../lib/app-scene-deck.js'
import { initConfigStrip } from './header-bar-config-strip.js'
import { fetchProjectFileContentById, projectFileIdFromName } from '../lib/project-files.js'
import { normalizeProjectMediaRefs, syncProjectMediaContextFromClient } from '../lib/project-media-context.js'
import { importProjectWithHardwareReconcile } from '../lib/project-import-flow.js'
import { showLoadProjectModal } from './load-project-modal.js'
import { startNewProject } from '../lib/default-project.js'
import { initHeaderBarOperatorHelper } from './header-bar-operator-helper.js'
import { initComposePreviewStreamDriver } from './compose-preview-stream-driver.js'

import { initLedTestCard } from './header-bar-led-test.js'
import { initStreamingBadge } from './header-bar-streaming.js'
import { initReplicationBadge } from './header-bar-replication.js'

/**
 * @param {HTMLElement} headerEl - Header element (contains title + status)
 * @param {HTMLElement} statusEl - Status/ws area
 * @param {import('../lib/state-store.js').StateStore} [stateStore] - for configComparison updates
 */
export function initHeaderBar(headerEl, statusEl, stateStore) {
	const titleEl = headerEl.querySelector('.header__title')
	if (!titleEl) return

	// Owner request 2026-07-26: when GPU is enabled in CEF templates the tiny header mascot wears
	// shades (bunny_glasses). Re-evaluated on every settings sync so toggling the option flips it.
	const applyHeaderLogo = () => {
		const img = document.querySelector('img.header__logo')
		if (!img) return
		const gpuOn = settingsState.getSettings()?.operatorTools?.cefEnableGpu === true
		const want = gpuOn ? 'assets/bunny_glasses.webp' : 'assets/logo.webp'
		if (img.getAttribute('src') !== want) img.setAttribute('src', want)
	}
	applyHeaderLogo()
	settingsState.subscribe(applyHeaderLogo)

	// Project name (editable)
	const nameWrap = document.createElement('div')
	nameWrap.className = 'header-project'
	const nameInp = document.createElement('input')
	nameInp.className = 'header-project__name'
	nameInp.type = 'text'
	nameInp.placeholder = 'Project name'
	nameInp.value = projectState.getProjectName()
	nameInp.title = 'Project name'
	const syncMediaFolderForName = () => {
		syncProjectMediaContextFromClient(settingsState.getSettings())
	}
	nameInp.addEventListener('change', () => {
		projectState.setProjectName(nameInp.value)
		syncMediaFolderForName()
	})
	nameInp.addEventListener('blur', () => {
		projectState.setProjectName(nameInp.value)
		syncMediaFolderForName()
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
		let project = projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
		project = normalizeProjectMediaRefs(project, settingsState.getSettings())
		try {
			const res = await api.post('/api/project/save', { project })
			if (res?.slug) projectState.setProjectSlug(res.slug)
			if (res?.rev != null) projectState.setRev(res.rev)
			markLocalProjectSaved()
			markServerProjectSynced()
			showHeaderToast('Saved', 'success')
		} catch (e) {
			showHeaderToast('Save failed: ' + (e?.message || e), 'error')
		}
	}

	async function saveToFile() {
		const slug = projectState.getProjectSlug() || projectFileIdFromName(projectState.getProjectName())
		try {
			const project = slug ? await fetchProjectFileContentById(slug) : null
			const payload =
				project && typeof project === 'object'
					? project
					: projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
			const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = (payload.name || projectState.getProjectName() || 'project').replace(/\s+/g, '_') + '.json'
			a.click()
			URL.revokeObjectURL(url)
		} catch (e) {
			showHeaderToast('Download failed: ' + (e?.message || e), 'error')
		}
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
	newProjectBtn.title = 'Start a fresh project with empty looks and one PGM screen destination'
	async function startFreshProject() {
		if (!confirm('Start a fresh project? Unsaved changes will be lost. Screen destinations reset to one PGM.')) return
		newProjectBtn.disabled = true
		try {
			await startNewProject({ showToast: (msg, type) => window.showToast?.(msg, type) })
			nameInp.value = projectState.getProjectName()
		} catch (e) {
			window.showToast?.(e?.message || 'New project failed', 'error')
		} finally {
			newProjectBtn.disabled = false
		}
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
	initReplicationBadge(ledTestWrap)

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

	/* Owner (todos27, placement 4): statusEl is a flex ROW — [PGM timer block] [eyes]; the
	 * clock goes BETWEEN them (the timer slot self-inserts at firstChild at runtime, so
	 * inserting before the eye container yields timer → clock → eyes). */
	const wallClock = document.createElement('span')
	wallClock.id = 'header-wall-clock'
	wallClock.className = 'header-wall-clock'
	const tickWallClock = () => {
		wallClock.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false })
	}
	tickWallClock()
	setInterval(tickWallClock, 1000)

	// Layout: [title] [project · save · load · new · sync] [server · settings] … [headphones · eyes]
	const autosaveIndicator = document.createElement('span')
	autosaveIndicator.className = 'header-autosave-indicator'
	autosaveIndicator.style.cssText = 'font-size: 11px; opacity: 0; color: #a1a1aa; margin-left: 8px; transition: opacity 0.5s ease; white-space: nowrap; user-select: none;'
	window.addEventListener('project-autosaved', (ev) => {
		autosaveIndicator.textContent = 'Autosaved at ' + ev.detail.time
		autosaveIndicator.style.color = '#a1a1aa'
		autosaveIndicator.style.opacity = '1'
	})
	window.addEventListener('project-autosave-failed', (ev) => {
		const reason = ev.detail?.reason || 'unknown error'
		autosaveIndicator.textContent = 'Autosave failed: ' + reason
		autosaveIndicator.style.color = '#f87171'
		autosaveIndicator.style.opacity = '1'
	})
	// WO-311: terminal, not a transient failure — autosave has stopped and will not retry, so
	// this message must stay up and tell the operator what to do rather than blink past.
	window.addEventListener('project-gone-on-server', () => {
		autosaveIndicator.textContent = 'Project deleted on server — Save As to keep your copy'
		autosaveIndicator.style.color = '#f87171'
		autosaveIndicator.style.opacity = '1'
	})

	const leftWrap = document.createElement('div')
	leftWrap.className = 'header-left'
	leftWrap.append(nameWrap, saveBtn, loadBtn, newProjectBtn, autosaveIndicator)

	const midWrap = document.createElement('div')
	midWrap.className = 'header-mid'
	midWrap.append(serverBtn, settingsBtn, ledTestWrap)
	// WO-283: operator-GUI-only "Open window ▾" / "Back to GUI". Self-gating — a no-op outside
	// operator-GUI mode, where the Settings modal's launch buttons already cover this.
	initHeaderBarOperatorHelper(midWrap)
	// WO-319 / todos22.07.26: the Live preview stream is now the 'stream' choice in the Compose
	// preview "Preview source" dropdown (Settings), not a header button. This driver mirrors that
	// setting onto the per-client live canvas — no visible control here.
	initComposePreviewStreamDriver()

	const rightWrap = document.createElement('div')
	rightWrap.className = 'header-right'
	const eyeContainerEl = document.getElementById('connection-eye-container')
	if (eyeContainerEl && eyeContainerEl.parentNode === statusEl) statusEl.insertBefore(wallClock, eyeContainerEl)
	else statusEl.appendChild(wallClock)
	rightWrap.append(audioGroup, statusEl)

	titleEl.insertAdjacentElement('afterend', leftWrap)
	leftWrap.insertAdjacentElement('afterend', midWrap)
	midWrap.insertAdjacentElement('afterend', rightWrap)

	projectState.on('change', () => {
		nameInp.value = projectState.getProjectName()
	})
}
