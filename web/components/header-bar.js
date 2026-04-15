/**
 * Header bar with project name, Save, Load, server config comparison strip.
 * @see main_plan.md Prompt 20, FEAT-1
 */

import { projectState } from '../lib/project-state.js'
import { sceneState, defaultTransition } from '../lib/scene-state.js'
import { dashboardState } from '../lib/dashboard-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { multiviewState } from '../lib/multiview-state.js'
import { api } from '../lib/api-client.js'
import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { showSettingsModal } from './settings-modal.js'
import { settingsState } from '../lib/settings-state.js'
import { showSyncModal } from './sync-modal.js'
import { showPublishModal } from './publish-modal.js'
import { showLedTestModal, getLedTestSettings } from './led-test-modal.js'
import { createHeaderAudioMonitor } from './header-bar-audio.js'
import { markLocalProjectSaved } from '../lib/project-remote-sync.js'

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
	saveBtn.className = 'header-btn'
	saveBtn.textContent = 'Save'
	saveBtn.title = 'Save project'
	const loadBtn = document.createElement('button')
	loadBtn.className = 'header-btn'
	loadBtn.textContent = 'Load'
	loadBtn.title = 'Load project'

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
		const project = projectState.exportProject(sceneState, timelineState, multiviewState, dashboardState)
		try {
			await api.post('/api/project/save', { project })
			markLocalProjectSaved()
			showHeaderToast('Saved', 'success')
		} catch (e) {
			showHeaderToast('Save failed: ' + (e?.message || e), 'error')
		}
	}

	function saveToFile() {
		const project = projectState.exportProject(sceneState, timelineState, multiviewState, dashboardState)
		const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = (project.name || 'project').replace(/\s+/g, '_') + '.json'
		a.click()
		URL.revokeObjectURL(url)
	}

	async function loadFromServer() {
		try {
			const res = await api.post('/api/project/load', {})
			// API returns project directly on 200, or { error } on 4xx
			const project = res && typeof res === 'object' && res.version && !res.error ? res : null
			if (!project) throw new Error(res?.error || 'No project stored')
			projectState.importProject(project, sceneState, timelineState, multiviewState, dashboardState)
			nameInp.value = projectState.getProjectName()
			window.dispatchEvent(new Event('project-loaded'))
			showHeaderToast('Loaded', 'success')
		} catch (e) {
			showHeaderToast('Load failed: ' + (e?.message || e), 'error')
		}
	}

	function loadFromFile(file) {
		const r = new FileReader()
		r.onload = () => {
			try {
				const project = JSON.parse(r.result)
				projectState.importProject(project, sceneState, timelineState, multiviewState, dashboardState)
				nameInp.value = projectState.getProjectName()
				window.dispatchEvent(new Event('project-loaded'))
			} catch (e) {
				showHeaderToast('Invalid project file: ' + (e?.message || e), 'error')
			}
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
		else void loadFromServer()
	})
	loadBtn.title = 'Load: click = load from server, Shift+click = upload JSON file'

	const newProjectBtn = document.createElement('button')
	newProjectBtn.className = 'header-btn'
	newProjectBtn.textContent = 'New project'
	newProjectBtn.title = 'Discard the current project in memory and start empty (save first if you need a file)'
	function startFreshProject() {
		if (!confirm('Start a fresh project? Unsaved changes in memory will be lost.')) return
		projectState.setProjectName('Untitled')
		sceneState.loadFromData({
			scenes: [],
			liveSceneId: null,
			previewSceneId: null,
			activeScreenIndex: 0,
			globalDefaultTransition: { ...defaultTransition() },
		})
		sceneState.setEditingScene(null)
		timelineState.loadFromData({ timelines: [], activeId: null })
		multiviewState.clearLayout()
		dashboardState.resetForNewProject()
		nameInp.value = projectState.getProjectName()
		window.dispatchEvent(new Event('project-loaded'))
	}
	newProjectBtn.addEventListener('click', (e) => {
		e.preventDefault()
		startFreshProject()
	})

	// Sync button (for offline-to-local-caspar push)
	const syncBtn = document.createElement('button')
	syncBtn.className = 'header-btn header-btn--sync'
	syncBtn.textContent = 'Sync to Local'
	syncBtn.title = 'Sync offline draft to local CasparCG server'
	syncBtn.style.display = 'none'
	syncBtn.onclick = () => showSyncModal()

	// Publish button (for offline-to-remote-server push)
	const publishBtn = document.createElement('button')
	publishBtn.className = 'header-btn header-btn--publish'
	publishBtn.textContent = 'Publish to Live' 
	publishBtn.title = 'Sequential differential sync to production server'
	publishBtn.style.display = 'none'
	publishBtn.onclick = () => showPublishModal()

	function updateSyncVisibility(cfg) {
		const isOffline = !!cfg?.offline_mode
		syncBtn.style.display = isOffline ? 'inline-block' : 'none'
		publishBtn.style.display = isOffline ? 'inline-block' : 'none'
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

	const strip = document.createElement('div')
	strip.className = 'server-config-strip'
	strip.hidden = true
	strip.innerHTML = `
		<div class="server-config-strip__summary"></div>
		<table class="server-config-strip__table"><thead><tr><th>#</th><th>Module expects</th><th>Server</th></tr></thead><tbody></tbody></table>
		<ul class="server-config-strip__issues"></ul>
		<p class="server-config-strip__hint"></p>
	`
	if (headerEl.parentNode) headerEl.parentNode.insertBefore(strip, headerEl.nextSibling)

	const sumEl = strip.querySelector('.server-config-strip__summary')
	const tbody = strip.querySelector('.server-config-strip__table tbody')
	const issuesEl = strip.querySelector('.server-config-strip__issues')
	const hintEl = strip.querySelector('.server-config-strip__hint')

	function renderConfigComparison(c) {
		if (!c || !sumEl) return
		const phys = c.serverPhysicalScreens || []
		const physIdx = phys.map((s) => s.index).join(', ')
		const physLine =
			phys.length > 0
				? ` Caspar screen outputs: ${phys.length} (ch ${physIdx}). App screens: ${c.moduleScreenCount ?? '—'}.`
				: ''
		const screenWarn = c.screensCountMismatch ? ' Screen count differs from app — check multiview or extra screen consumers.' : ''
		if (c.aligned) {
			sumEl.textContent = `Server config matches module settings (${c.serverChannelCount} channels).${physLine}`
			sumEl.className = 'server-config-strip__summary server-config-strip__summary--ok'
		} else if (!c.serverChannelCount) {
			sumEl.textContent = 'Connect to CasparCG or wait for INFO CONFIG to compare channel layout.'
			sumEl.className = 'server-config-strip__summary server-config-strip__summary--warn'
		} else {
			sumEl.textContent = `Mismatch: server has ${c.serverChannelCount} channel(s), module expects ${c.moduleChannelCount}.${physLine}${screenWarn}`
			sumEl.className = 'server-config-strip__summary server-config-strip__summary--warn'
		}
		tbody.innerHTML = ''
		const rows = Math.max(c.serverChannels?.length || 0, c.moduleChannels?.length || 0)
		for (let i = 0; i < rows; i++) {
			const s = c.serverChannels?.[i]
			const m = c.moduleChannels?.[i]
			const tr = document.createElement('tr')
			tr.innerHTML = `<td>${s?.index ?? m?.index ?? i + 1}</td><td>${m ? `${m.role}: ${m.videoMode || '—'}` : '—'}</td><td>${s ? `${s.videoMode || '—'}${s.hasScreen ? ' (screen)' : ''}` : '—'}</td>`
			tbody.appendChild(tr)
		}
		issuesEl.innerHTML = ''
		;(c.issues || []).forEach((msg) => {
			const li = document.createElement('li')
			li.textContent = msg
			issuesEl.appendChild(li)
		})
		hintEl.textContent = c.hint || ''
	}

	serverBtn.addEventListener('click', () => {
		strip.hidden = !strip.hidden
		serverBtn.textContent = strip.hidden ? 'Server ▾' : 'Server ▴'
	})

	// Settings — directly after Server
	const settingsBtn = document.createElement('button')
	settingsBtn.type = 'button'
	settingsBtn.className = 'header-btn header-btn--settings'
	settingsBtn.innerHTML = '⚙'
	settingsBtn.title = 'Application Settings (Ctrl+,)'
	settingsBtn.setAttribute('aria-label', 'Application settings')
	settingsBtn.addEventListener('click', () => showSettingsModal())

	// LED wall test card (PGM ch · layer 999) — checkbox + setup modal
	const ledTestWrap = document.createElement('div')
	ledTestWrap.className = 'header-led-test'
	const ledTestCb = document.createElement('input')
	ledTestCb.type = 'checkbox'
	ledTestCb.id = 'header-led-test-cb'
	ledTestCb.title = 'Show LED grid test pattern on program output (layer 999)'
	const ledTestLab = document.createElement('label')
	ledTestLab.className = 'header-led-test__label'
	ledTestLab.htmlFor = 'header-led-test-cb'
	ledTestLab.textContent = 'LED test'
	const ledTestBtn = document.createElement('button')
	ledTestBtn.type = 'button'
	ledTestBtn.className = 'header-btn header-btn--led-setup'
	ledTestBtn.textContent = 'Test card…'
	ledTestBtn.title = 'Grid size and labels'
	let ftbBusy = false
	const ftbBtn = document.createElement('button')
	ftbBtn.type = 'button'
	ftbBtn.className = 'header-btn header-btn--ftb'
	ftbBtn.textContent = 'FTB'
	ftbBtn.title = 'Fade to black: fade out all program and preview layers, then clear'
	ledTestWrap.appendChild(ledTestCb)
	ledTestWrap.appendChild(ledTestLab)
	ledTestWrap.appendChild(ledTestBtn)
	ledTestWrap.appendChild(ftbBtn)

	const pgmRecBtn = document.createElement('button')
	pgmRecBtn.type = 'button'
	pgmRecBtn.className = 'header-btn header-btn--pgm-rec'
	pgmRecBtn.textContent = 'Rec PGM'
	const pgmRecTitleIdle =
		'Record PGM on the Caspar host into the media folder (H.264 + AAC). Path comes from INFO PATHS or Local media path in Settings. Toggle to stop.'
	pgmRecBtn.title = pgmRecTitleIdle
	ledTestWrap.appendChild(pgmRecBtn)

	let pgmRecBusy = false
	async function syncPgmRecButton() {
		try {
			const st = await api.get('/api/pgm-record')
			const on = !!(st && st.recording)
			pgmRecBtn.textContent = on ? 'Stop rec' : 'Rec PGM'
			pgmRecBtn.classList.toggle('header-btn--pgm-rec--on', on)
			pgmRecBtn.title = on
				? `Recording to ${st.path || '…'} — click to stop (file is on the Caspar machine)`
				: pgmRecTitleIdle
		} catch {
			/* offline / 503 — leave button idle */
		}
	}
	void syncPgmRecButton()

	pgmRecBtn.addEventListener('click', () => {
		void (async () => {
			if (pgmRecBusy) return
			pgmRecBusy = true
			pgmRecBtn.disabled = true
			try {
				const st = await api.get('/api/pgm-record').catch(() => ({ recording: false }))
				const on = !!(st && st.recording)
				const res = await api.post('/api/pgm-record', { action: on ? 'stop' : 'start' })
				if (res?.path) {
					showHeaderToast(
						res.recording ? 'Recording → ' + res.path : 'Saved: ' + res.path,
						'success'
					)
				}
				await syncPgmRecButton()
			} catch (e) {
				alert('PGM record: ' + (e?.message || e))
				await syncPgmRecButton()
			} finally {
				pgmRecBusy = false
				pgmRecBtn.disabled = false
			}
		})()
	})

	async function applyLedTest(enabled) {
		try {
			const payload = { enabled, ...getLedTestSettings() }
			await api.post('/api/led-test-card', payload)
			localStorage.setItem('highascg_led_test_enabled', enabled ? 'true' : 'false')
		} catch (e) {
			ledTestCb.checked = false
			localStorage.setItem('highascg_led_test_enabled', 'false')
			alert('LED test card: ' + (e?.message || e))
		}
	}

	ledTestCb.addEventListener('change', () => {
		void applyLedTest(!!ledTestCb.checked)
	})
	ledTestBtn.addEventListener('click', () => {
		showLedTestModal(() => {
			if (ledTestCb.checked) void applyLedTest(true)
		})
	})

	ftbBtn.addEventListener('click', () => {
		void (async () => {
			if (ftbBusy) return
			ftbBusy = true
			ftbBtn.disabled = true
			try {
				await api.post('/api/ftb', {})
				ledTestCb.checked = false
				localStorage.setItem('highascg_led_test_enabled', 'false')
			} catch (e) {
				alert('FTB: ' + (e?.message || e))
			} finally {
				ftbBusy = false
				ftbBtn.disabled = false
			}
		})()
	})
	if (localStorage.getItem('highascg_led_test_enabled') === 'true') {
		ledTestCb.checked = true
		void applyLedTest(true)
	}

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
	const leftWrap = document.createElement('div')
	leftWrap.className = 'header-left'
	leftWrap.append(nameWrap, saveBtn, loadBtn, newProjectBtn, syncBtn, publishBtn)

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
