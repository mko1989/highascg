/**
 * Header bar with project name, Save, Load, server config comparison strip.
 * @see main_plan.md Prompt 20, FEAT-1
 */

import { projectState } from '../lib/project-state.js'
import { sceneState } from '../lib/scene-state.js'
import { dashboardState } from '../lib/dashboard-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { multiviewState } from '../lib/multiview-state.js'
import { api } from '../lib/api-client.js'
import { showSettingsModal } from './settings-modal.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'
import { showSyncModal } from './sync-modal.js'
import { showPublishModal } from './publish-modal.js'
import { showLedTestModal, getLedTestSettings } from './led-test-modal.js'

/** Lucide-style headphones (stroke) */
const HEADPHONES_SVG =
	'<svg class="header-audio__icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>'

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

	async function saveToServer() {
		const project = projectState.exportProject(sceneState, timelineState, multiviewState, dashboardState)
		try {
			await api.post('/api/project/save', { project })
			alert('Saved to server')
		} catch (e) {
			alert('Save failed: ' + (e?.message || e))
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
			alert('Loaded from server')
		} catch (e) {
			alert('Load failed: ' + (e?.message || e))
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
				alert('Invalid project file: ' + (e?.message || e))
			}
		}
		r.readAsText(file)
	}

	saveBtn.addEventListener('click', (e) => {
		if (e.shiftKey) saveToServer()
		else saveToFile()
	})
	saveBtn.title = 'Save: click = download file, Shift+click = save to server'

	loadBtn.addEventListener('click', (e) => {
		if (e.shiftKey) loadFromServer()
		else fileInput.click()
	})
	loadBtn.title = 'Load: click = upload file, Shift+click = load from server'

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

	// Monitor: headphones + channel dropdown (stream names match server go2rtc targets)
	const audioGroup = document.createElement('div')
	audioGroup.className = 'header-audio'

	const audioToggle = document.createElement('button')
	audioToggle.type = 'button'
	audioToggle.className = 'header-btn header-audio__toggle'
	audioToggle.innerHTML = HEADPHONES_SVG
	audioToggle.title = 'Monitor audio'
	audioToggle.setAttribute('aria-haspopup', 'true')
	audioToggle.setAttribute('aria-expanded', 'false')

	const dropdown = document.createElement('div')
	dropdown.className = 'header-audio__dropdown'
	dropdown.hidden = true
	dropdown.setAttribute('role', 'menu')

	const channelList = document.createElement('div')
	channelList.className = 'header-audio__channels'
	dropdown.appendChild(channelList)

	const muteRow = document.createElement('label')
	muteRow.className = 'header-audio__mute'
	const muteCb = document.createElement('input')
	muteCb.type = 'checkbox'
	muteRow.appendChild(muteCb)
	muteRow.appendChild(document.createTextNode(' Mute'))
	dropdown.appendChild(muteRow)

	audioGroup.appendChild(audioToggle)
	audioGroup.appendChild(dropdown)

	/** @returns {{ id: string, label: string }[]} */
	function getMonitorChannelOptions() {
		const cm = stateStore?.getState?.()?.channelMap || {}
		const programChannels = cm.programChannels || [1]
		const previewChannels = cm.previewChannels || [2]
		const mvCh = cm.multiviewCh
		const base = [
			{ id: 'pgm_1', label: `PGM · ch ${programChannels[0] ?? 1}` },
			{ id: 'prv_1', label: `PRV · ch ${previewChannels[0] ?? 2}` },
		]
		if (mvCh != null) base.push({ id: 'multiview', label: `Multiview · ch ${mvCh}` })
		const avail = streamState.availableStreams || []
		if (avail.length === 0) return base
		const filtered = base.filter((o) => avail.includes(o.id))
		return filtered.length > 0 ? filtered : base
	}

	function renderChannelMenu() {
		channelList.innerHTML = ''
		const opts = getMonitorChannelOptions()
		for (const o of opts) {
			const b = document.createElement('button')
			b.type = 'button'
			b.className = 'header-audio__channel'
			b.dataset.source = o.id
			b.setAttribute('role', 'menuitemradio')
			b.textContent = o.label
			b.addEventListener('click', (e) => {
				e.stopPropagation()
				streamState.setAudioSource(o.id)
				setDropdownOpen(false)
			})
			channelList.appendChild(b)
		}
		syncChannelHighlight()
	}

	function syncChannelHighlight() {
		const id = streamState.activeAudioSource
		channelList.querySelectorAll('.header-audio__channel').forEach((btn) => {
			const sid = /** @type {HTMLElement} */ (btn).dataset.source
			btn.classList.toggle('header-audio__channel--on', sid === id)
		})
	}

	function setDropdownOpen(open) {
		dropdown.hidden = !open
		audioToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
		if (open) renderChannelMenu()
	}

	audioToggle.addEventListener('click', (e) => {
		e.stopPropagation()
		setDropdownOpen(dropdown.hidden)
	})

	muteCb.addEventListener('change', () => {
		streamState.setMuted(muteCb.checked)
	})

	function onDocClick(e) {
		if (!audioGroup.contains(/** @type {Node} */ (e.target))) setDropdownOpen(false)
	}
	document.addEventListener('click', onDocClick)

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') setDropdownOpen(false)
	})

	function updateAudioUI(state) {
		muteCb.checked = !!state.monitoringMuted
		audioToggle.classList.toggle('header-audio__toggle--muted', !!state.monitoringMuted)
		audioToggle.classList.toggle('header-audio__toggle--active', !state.monitoringMuted)

		if (!dropdown.hidden) renderChannelMenu()
		else syncChannelHighlight()

		audioGroup.style.display = shouldShowLiveVideo() ? 'flex' : 'none'
	}

	streamState.subscribe(updateAudioUI)
	settingsState.subscribe(() => {
		renderChannelMenu()
		updateAudioUI(streamState)
	})
	if (stateStore) {
		const onMap = () => {
			renderChannelMenu()
			updateAudioUI(streamState)
		}
		stateStore.on('*', onMap)
		stateStore.on('channelMap', onMap)
	}
	updateAudioUI(streamState)
	renderChannelMenu()

	if (stateStore) {
		const apply = () => {
			const c = stateStore.getState()?.configComparison
			if (c) renderConfigComparison(c)
		}
		stateStore.on('*', apply)
		stateStore.on('configComparison', apply)
		apply()
	}

	// Layout: [title] [project · save · load · sync] [server · settings] … [headphones · eyes]
	const leftWrap = document.createElement('div')
	leftWrap.className = 'header-left'
	leftWrap.append(nameWrap, saveBtn, loadBtn, syncBtn, publishBtn)

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
