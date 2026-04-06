/**
 * CasparCG Web Client — main app entry.
 * Connects via WebSocket for real-time state, shows layout shell.
 * @see main_plan.md Prompt 11
 */

import { WsClient } from './lib/ws-client.js'
import { OscClient } from './lib/osc-client.js'
import { api } from './lib/api-client.js'
import StateStore from './lib/state-store.js'
import { initSourcesPanel } from './components/sources-panel.js'
import { sceneState } from './lib/scene-state.js'
import { initScenesEditor } from './components/scenes-editor.js'
import { initTimelineEditor } from './components/timeline-editor.js'
import { initInspectorPanel } from './components/inspector-panel.js'
import { initMultiviewEditor } from './components/multiview-editor.js'
import { initHeaderBar } from './components/header-bar.js'
import { initAudioMixerPanel } from './components/audio-mixer-panel.js'
import { initOscFooterStrip } from './components/osc-footer-strip.js'
import { mountPgmTopLayerPlaybackTimer } from './components/playback-timer.js'
import { dashboardState } from './lib/dashboard-state.js'
import { settingsState } from './lib/settings-state.js'
import { streamState, applyBrowserMonitorFromSettings } from './lib/stream-state.js'
import { showSettingsModal } from './components/settings-modal.js'
import { createConnectionEye } from './components/connection-eye.js'
import { showLogsModal } from './components/logs-modal.js'
import { multiviewState } from './lib/multiview-state.js'

export const stateStore = new StateStore()
export const ws = new WsClient()

/** OSC WebSocket fan-out; shares socket with {@link WsClient}. */
let _oscClient = null

/** Set after successful GET /api/state bootstrap. */
let httpConnected = false

const statusDot = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')
const statusNet = document.getElementById('status-net')
let connectionEye = null

function updateNetworkInfo() {
	if (!statusNet) return
	const host = window.location.hostname
	let type = 'WAN'
	if (host === 'localhost' || host === '127.0.0.1') type = 'Local'
	else if (host.startsWith('192.168.') || host.startsWith('10.') || host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) type = 'LAN'
	else if (host.startsWith('100.')) type = 'Tailscale'
	
	statusNet.textContent = `[${type}]`
	statusNet.className = 'status-net status-net--' + type.toLowerCase()
}

/**
 * Size multiview editor canvas from Caspar INFO CONFIG (multiview channel, else first program).
 */
function syncMultiviewCanvasFromChannelMap(cm) {
	if (!cm) return
	const by = cm.channelResolutionsByChannel || {}
	const mvCh = cm.multiviewCh
	let w
	let h
	if (mvCh != null && by[mvCh]) {
		w = by[mvCh].w
		h = by[mvCh].h
	} else if (cm.programResolutions?.[0]) {
		w = cm.programResolutions[0].w
		h = cm.programResolutions[0].h
	}
	if (w > 0 && h > 0 && (multiviewState.canvasWidth !== w || multiviewState.canvasHeight !== h)) {
		multiviewState.setCanvasSize(w, h)
	}
}

/** Eye indicator: Caspar AMCP TCP (not browser↔HighAsCG). Reads flat `caspar` or nested `caspar.connection` from WS merges. */
function refreshCasparConnectionEye() {
	if (!connectionEye) return
	const st = stateStore.getState()
	const raw = st?.caspar
	const conn =
		raw && typeof raw.connection === 'object' && raw.connection !== null ? raw.connection : raw
	const skipped = !!(conn && conn.skipped)
	const amcpUp = !!(conn && conn.connected) && !skipped
	connectionEye.setConnected(amcpUp)
}

function refreshStatusLine() {
	if (!statusText) return
	const st = stateStore.getState()
	const raw = st?.caspar
	const c =
		raw && typeof raw.connection === 'object' && raw.connection !== null ? raw.connection : raw
	const skipped = !!(c && c.skipped)
	const casparOk = !!(c && c.connected)
	let line = ''
	if (ws.connected) line = 'Live'
	else if (httpConnected) line = 'HTTP'
	else line = 'Connecting…'
	if (skipped) line += ' · no AMCP'
	else if (casparOk) line += ' · Caspar'
	else if (ws.connected || httpConnected) line += ' · Caspar offline'

	const cc = st?.configComparison
	if (casparOk && cc?.serverPhysicalScreens?.length) {
		const n = cc.serverPhysicalScreens.length
		const idx = cc.serverPhysicalScreens.map((s) => s.index).join(', ')
		const m = cc.moduleScreenCount
		if (typeof m === 'number' && m !== n) line += ` · Screens ${n} (ch ${idx}) ≠ app ${m}`
		else line += ` · Screens ${n} (ch ${idx})`
	}

	statusText.textContent = line
	updateNetworkInfo()
}

function updateConnectionStatus(connected, error, isLive = false) {
	updateNetworkInfo()
	if (error) {
		statusDot?.classList.remove('connected', 'disconnected')
		statusDot?.classList.add('error')
		if (statusText) statusText.textContent = error
		return
	}
	if (connected) {
		statusDot?.classList.remove('disconnected', 'error')
		statusDot?.classList.add('connected')
		refreshStatusLine()
	} else {
		statusDot?.classList.remove('connected', 'error')
		statusDot?.classList.add('disconnected')
		if (statusText) statusText.textContent = 'Connecting…'
	}
}

function initPanelResize() {
	const handle = document.getElementById('resize-sources')
	const panel = document.getElementById('panel-sources')
	if (!handle || !panel) return
	const root = document.documentElement
	const minW = 220
	const maxW = 520
	handle.addEventListener('mousedown', (e) => {
		if (e.button !== 0) return
		e.preventDefault()
		const startX = e.clientX
		const startW = panel.getBoundingClientRect().width
		const onMove = (ev) => {
			const dx = ev.clientX - startX
			const w = Math.max(minW, Math.min(maxW, startW + dx))
			root.style.setProperty('--sources-panel-w', `${w}px`)
		}
		const onUp = () => {
			document.removeEventListener('mousemove', onMove)
			document.removeEventListener('mouseup', onUp)
			document.body.style.cursor = ''
			document.body.style.userSelect = ''
		}
		document.body.style.cursor = 'col-resize'
		document.body.style.userSelect = 'none'
		document.addEventListener('mousemove', onMove)
		document.addEventListener('mouseup', onUp)
	})
}

function initTabs() {
	const tabs = document.querySelectorAll('.tab')
	const panes = document.querySelectorAll('.tab-pane')
	tabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			const target = tab.dataset.tab
			tabs.forEach((t) => t.classList.remove('active'))
			panes.forEach((p) => {
				p.classList.toggle('active', p.id === `tab-${target}`)
			})
			tab.classList.add('active')
			if (target === 'scenes') {
				requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('scenes-tab-activated')))
			}
			if (target === 'multiview') {
				requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('mv-tab-activated')))
			}
			if (target === 'timeline') {
				requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('timeline-tab-activated')))
			}
		})
	})
}

async function init() {
	const eyeContainer = document.getElementById('connection-eye-container')
	if (eyeContainer) {
		connectionEye = createConnectionEye(eyeContainer)
		connectionEye.el.style.cursor = 'pointer'
		connectionEye.el.addEventListener('click', (e) => {
			e.preventDefault()
			e.stopPropagation()
			showLogsModal()
		})
	}

	window.addEventListener('keydown', (e) => {
		if (!(e.ctrlKey || e.metaKey) || e.key !== ',') return
		const t = e.target
		if (
			t &&
			(t.isContentEditable ||
				(typeof t.closest === 'function' && t.closest('input, textarea, select, [contenteditable="true"]')))
		) {
			return
		}
		e.preventDefault()
		showSettingsModal()
	})

	initTabs()
	initPanelResize()

	// WebSocket + OSC fan-out (standalone server). Companion HTTP-only: WS may fail; HTTP still works.
	_oscClient = new OscClient({ wsClient: ws })
	ws.on('state', (data) => {
		stateStore.setState(data)
		if (data?.channelMap?.programResolutions)
			sceneState.setCanvasResolutions(data.channelMap.programResolutions)
		syncMultiviewCanvasFromChannelMap(data?.channelMap)
		if (data?.scene?.live) sceneState.applyServerLiveChannels(data.scene.live, data.channelMap)
		updateConnectionStatus(true, null, true)
		refreshStatusLine()
		refreshCasparConnectionEye()
	})
	ws.on('change', (data) => {
		if (data && data.path != null) {
			stateStore.applyChange(data.path, data.value)
			if (data.path === 'scene.live' && data.value) {
				sceneState.applyServerLiveChannels(data.value, stateStore.getState()?.channelMap)
			}
			if (
				data.path === 'caspar.connection' ||
				String(data.path || '').startsWith('caspar.') ||
				data.path === 'configComparison'
			) {
				refreshStatusLine()
				refreshCasparConnectionEye()
			}
		}
	})

	window.addEventListener('casparcg-playback-matrix', (ev) => {
		if (ev?.detail && typeof ev.detail === 'object') {
			stateStore.applyChange('playback.matrix', ev.detail)
		}
	})
	ws.on('timeline.tick', (data) => stateStore.applyChange('timeline.tick', data))
	ws.on('timeline.playback', (pb) => stateStore.applyChange('timeline.playback', pb))
	ws.on('connect', () => {
		updateConnectionStatus(true, null, true)
		refreshCasparConnectionEye()
		// Do not sync multiview layout to the module on every WS connect — that persisted browser
		// defaults and caused Caspar to receive a full multiview apply on next TCP reconnect. Use
		// Multiview tab → Apply to push layout to the server explicitly.
		settingsState.load().catch(() => {})
		streamState.refreshStreams()
		applyBrowserMonitorFromSettings(settingsState.getSettings())
	})
	ws.on('disconnect', async () => {
		if (httpConnected) {
			try {
				const st = await api.get('/api/state')
				if (st && typeof st === 'object') stateStore.setState(st)
			} catch {
				// keep last state
			}
			updateConnectionStatus(true)
		} else {
			updateConnectionStatus(false)
		}
		refreshCasparConnectionEye()
	})
	ws.on('error', async () => {
		if (httpConnected) {
			try {
				const st = await api.get('/api/state')
				if (st && typeof st === 'object') stateStore.setState(st)
			} catch {
				// keep last state
			}
			updateConnectionStatus(true)
		} else {
			updateConnectionStatus(false, 'WebSocket error')
		}
		refreshCasparConnectionEye()
	})

	const header = document.querySelector('.header')
	const statusEl = document.querySelector('.header__status')
	if (header && statusEl) initHeaderBar(header, statusEl, stateStore)

	/** PGM clip time from OSC — topmost layer with file/time on the active program channel. */
	let pgmHeaderTimerDestroy = null
	function mountHeaderPgmPlaybackTimer() {
		if (!statusEl || !_oscClient) return
		let slot = document.getElementById('header-pgm-timer')
		if (!slot) {
			slot = document.createElement('div')
			slot.id = 'header-pgm-timer'
			slot.className = 'header-pgm-timer-wrap'
			statusEl.insertBefore(slot, statusEl.firstChild)
		}
		if (pgmHeaderTimerDestroy) pgmHeaderTimerDestroy.destroy()
		pgmHeaderTimerDestroy = mountPgmTopLayerPlaybackTimer(slot, {
			oscClient: _oscClient,
			getChannel: () => {
				const cm = stateStore.getState()?.channelMap || {}
				const list = cm.programChannels || [1]
				const screenIdx = dashboardState.activeScreenIndex ?? sceneState.activeScreenIndex ?? 0
				const idx = Math.min(Math.max(0, screenIdx), list.length - 1)
				return list[idx] ?? 1
			},
			getState: () => stateStore.getState(),
		})
	}
	mountHeaderPgmPlaybackTimer()
	dashboardState.on('screenChange', () => pgmHeaderTimerDestroy?.refresh())
	sceneState.on('screenChange', () => pgmHeaderTimerDestroy?.refresh())
	stateStore.on('*', (path) => {
		if (path === 'channelMap' || path === 'channels' || path == null) pgmHeaderTimerDestroy?.refresh()
	})

	initAudioMixerPanel(stateStore)
	initSourcesPanel(document.querySelector('#panel-sources .panel__body'), stateStore)
	initScenesEditor(document.querySelector('#tab-scenes'), stateStore, { getOscClient: () => _oscClient })
	initTimelineEditor(document.querySelector('#tab-timeline'), stateStore)
	initMultiviewEditor(document.querySelector('#tab-multiview'), stateStore)
	initInspectorPanel(document.getElementById('panel-inspector-body') || document.querySelector('#panel-inspector .panel__body'), stateStore)
	initOscFooterStrip(() => _oscClient, stateStore)

	settingsState.subscribe((s) => {
		applyBrowserMonitorFromSettings(s)
		const isOffline = !!s.offline_mode
		document.body.classList.toggle('offline-mode', isOffline)
		if (connectionEye) connectionEye.setOffline(isOffline)
		stateStore.setOffline(isOffline)
	})
	document.addEventListener('highascg-settings-applied', (ev) => {
		const s = settingsState.getSettings()
		applyBrowserMonitorFromSettings(s)
		const isOffline = !!s.offline_mode
		document.body.classList.toggle('offline-mode', isOffline)
		if (connectionEye) connectionEye.setOffline(isOffline)
		stateStore.setOffline(isOffline)
	})
	applyBrowserMonitorFromSettings(settingsState.getSettings())

	// Bootstrap state from API (works with Companion HTTP when api_port=0)
	try {
		const settings = await api.get('/api/settings')
		const isOffline = !!settings?.offline_mode
		stateStore.setOffline(isOffline)
		if (connectionEye) connectionEye.setOffline(isOffline)
		document.body.classList.toggle('offline-mode', isOffline)

		if (isOffline) {
			await stateStore.hydrateFromCache()
		}

		const state = await api.get('/api/state')
		if (state && typeof state === 'object') {
			stateStore.setState(state)
			sceneState.setCanvasResolutions(state.channelMap?.programResolutions)
			syncMultiviewCanvasFromChannelMap(state.channelMap)
			if (state.scene?.live) sceneState.applyServerLiveChannels(state.scene.live, state.channelMap)
			httpConnected = true
			updateConnectionStatus(true)
			refreshStatusLine()
			refreshCasparConnectionEye()
		}
		window.dispatchEvent(new CustomEvent('highascg-bootstrap-complete'))
	} catch {
		// API not available, state remains empty or hydrated from cache
	}

	window.addEventListener('project-loaded', async () => {
		try {
			const st = await api.get('/api/state')
			if (st?.scene?.live) sceneState.applyServerLiveChannels(st.scene.live, st.channelMap)
		} catch {
			// ignore
		}
	})
}

/** @returns {import('./lib/osc-client.js').OscClient | null} */
export function getOscClient() {
	return _oscClient
}

init()
