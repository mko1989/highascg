/**
 * CasparCG Web Client — main app entry.
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
import { initWorkspaceLayout } from './lib/workspace-layout.js'
import { initHeaderBar } from './components/header-bar.js'
import { initAudioMixerPanel } from './components/audio-mixer-panel.js'
import { mountPgmTopLayerPlaybackTimer } from './components/playback-timer.js'
import { dashboardState } from './lib/dashboard-state.js'
import { settingsState } from './lib/settings-state.js'
import { streamState, applyBrowserMonitorFromSettings } from './lib/stream-state.js'
import { showSettingsModal } from './components/settings-modal.js'
import { createConnectionEye } from './components/connection-eye.js'
import { showLogsModal } from './components/logs-modal.js'
import { multiviewState } from './lib/multiview-state.js'
import { dmxState } from './lib/dmx-state.js'
import { initPixelMapEditor } from './components/pixel-map-editor.js'
import { initStreamingPanel } from './components/streaming-panel.js'
import { getVariableStore } from './lib/variable-state.js'
import { projectState } from './lib/project-state.js'
import { timelineState } from './lib/timeline-state.js'
import { initOptionalModules } from './lib/optional-modules.js'
import { initDeviceView } from './components/device-view.js'
import { placeholderState } from './lib/placeholder-state.js'

import * as Status from './lib/app-status.js'
import * as Handlers from './lib/app-ws-handlers.js'
import * as SceneDeck from './lib/app-scene-deck.js'
import * as MvSync from './lib/app-multiview-sync.js'

export const stateStore = new StateStore()
export const ws = new WsClient()
window.placeholderState = placeholderState
getVariableStore(ws)

let _oscClient = null; let httpConnected = false; let _casparAmcpConnected = false; let connectionEye = null

const appLogic = {
	syncMultiviewCanvas: (cm) => MvSync.syncMultiviewCanvasFromChannelMap(cm, multiviewState),
	scheduleMultiviewRefresh: () => MvSync.scheduleMultiviewLayoutRefresh(),
	scheduleSceneDeckSync: () => SceneDeck.scheduleSceneDeckSync(ws, sceneState),
	emitCasparConnectedIfNeeded: (st) => {
		const now = Status.casparAmcpConnectedFromState(st)
		if (now && !_casparAmcpConnected) document.dispatchEvent(new CustomEvent('mv-caspar-amcp-connected'))
		_casparAmcpConnected = now
	},
	refreshEye: () => Status.refreshCasparConnectionEye(connectionEye, stateStore),
	refreshStatusLine: () => Status.refreshStatusLine(stateStore, ws, httpConnected),
	updateStatus: (connected, error) => Status.updateConnectionStatus(connected, error, { ws, httpConnected, stateStore }),
	onConnect: () => {
		settingsState.load().catch(() => {})
		streamState.refreshStreams()
		applyBrowserMonitorFromSettings(settingsState.getSettings())
	},
	handleWsDisconnect: async (reason) => {
		if (httpConnected) {
			try { const st = await api.get('/api/state'); if (st) stateStore.setState(st) } catch {}
			appLogic.updateStatus(true)
		} else appLogic.updateStatus(false, reason)
		appLogic.refreshEye()
	}
}

function initTabs() {
	const tabs = document.querySelectorAll('.tab'); const panes = document.querySelectorAll('.tab-pane')
	const tabStorageKey = 'highascg_active_tab'
	const activateTab = (target) => {
		tabs.forEach(t => t.classList.remove('active'))
		panes.forEach(p => p.classList.toggle('active', p.id === `tab-${target}`))
		const tab = Array.from(tabs).find((t) => t.dataset.tab === target)
		if (tab) tab.classList.add('active')
		try { localStorage.setItem(tabStorageKey, target) } catch { /* ignore */ }
		if (target !== 'pixelmap') {
			window.dispatchEvent(new CustomEvent('highascg-mapping-browser-visibility', { detail: { visible: false } }))
		}
		if (['scenes', 'multiview', 'pixelmap', 'timeline'].includes(target)) requestAnimationFrame(() => document.dispatchEvent(new CustomEvent(`${target === 'pixelmap' ? 'px' : (target === 'multiview' ? 'mv' : target)}-tab-activated`)))
		if (target === 'streaming') initStreamingPanel(document.getElementById('tab-streaming'))
		if (target === 'device-view') initDeviceView(document.getElementById('tab-device-view'))
	}
	tabs.forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)))
	
	window.addEventListener('highascg-open-pixel-mapping', (ev) => {
		const nodeId = ev.detail?.nodeId
		activateTab('pixelmap')
		// The pixelmap editor itself might need the nodeId, handled via dmxState or similar.
		window.dispatchEvent(new CustomEvent('highascg-mapping-browser-visibility', { detail: { visible: true, activate: true, nodeId } }))
	})

	let initial = ''
	try { initial = localStorage.getItem(tabStorageKey) || '' } catch { /* ignore */ }
	if (!initial || !document.querySelector(`.tab[data-tab="${initial}"]`)) {
		initial = document.querySelector('.tab.active')?.dataset.tab || tabs[0]?.dataset.tab || ''
	}
	if (initial) activateTab(initial)
}

async function init() {
	const eyeContainer = document.getElementById('connection-eye-container')
	if (eyeContainer) {
		connectionEye = createConnectionEye(eyeContainer); connectionEye.el.style.cursor = 'pointer'
		connectionEye.el.addEventListener('click', () => showLogsModal())
	}
	window.addEventListener('keydown', e => {
		if (!(e.ctrlKey || e.metaKey) || e.key !== ',' || e.target.closest('input, textarea, select, [contenteditable="true"]')) return
		e.preventDefault(); showSettingsModal()
	})
	initTabs(); initWorkspaceLayout()
	void initOptionalModules({ stateStore, ws, api, sceneState, settingsState, streamState })
	_oscClient = new OscClient({ wsClient: ws }); window.highascg_osc_client = _oscClient

	Handlers.attachWsHandlers(ws, { stateStore, sceneState, timelineState, multiviewState, dashboardState, projectState, dmxState, variableStore: getVariableStore(ws), appLogic })
	sceneState.on('change', () => appLogic.scheduleSceneDeckSync())
	sceneState.on('imported', () => appLogic.scheduleSceneDeckSync())
	sceneState.on('previewScene', () => appLogic.scheduleSceneDeckSync())

	const header = document.querySelector('.header'); const statusEl = document.querySelector('.header__status')
	if (header && statusEl) initHeaderBar(header, statusEl, stateStore)

	let pgmHeaderTimerDestroy = null
	let selectedPlaybackChannel = null
	const playbackChannelStorageKey = 'highascg_header_playback_channel'
	try {
		const saved = parseInt(String(localStorage.getItem(playbackChannelStorageKey) || ''), 10)
		if (Number.isFinite(saved) && saved > 0) selectedPlaybackChannel = saved
	} catch {
		// ignore storage failures
	}
	const getProgramChannels = () => {
		const cm = stateStore.getState()?.channelMap || {}
		const list = cm.playbackChannels || cm.programChannels
		return Array.isArray(list) && list.length ? list.map((v) => parseInt(String(v), 10)).filter((v) => Number.isFinite(v) && v > 0) : [1]
	}
	const ensureSelectedPlaybackChannel = () => {
		const list = getProgramChannels()
		if (!list.includes(selectedPlaybackChannel)) selectedPlaybackChannel = list[0] ?? 1
		return selectedPlaybackChannel
	}
	const persistSelectedPlaybackChannel = () => {
		try { localStorage.setItem(playbackChannelStorageKey, String(selectedPlaybackChannel || '')) } catch { /* ignore */ }
	}
	const renderPlaybackChannelChips = () => {
		const slot = document.getElementById('header-pgm-timer')
		if (!slot) return
		const chips = slot.querySelector('.header-pgm-timer-chips')
		if (!chips) return
		ensureSelectedPlaybackChannel()
		const list = getProgramChannels()
		chips.innerHTML = ''
		list.forEach((ch, idx) => {
			const b = document.createElement('button')
			b.type = 'button'
			b.className = 'header-pgm-timer-chip' + (ch === selectedPlaybackChannel ? ' header-pgm-timer-chip--active' : '')
			b.textContent = `P${idx + 1}`
			b.title = `Show playback timer for channel ${ch}`
			b.addEventListener('click', () => {
				selectedPlaybackChannel = ch
				persistSelectedPlaybackChannel()
				renderPlaybackChannelChips()
				pgmHeaderTimerDestroy?.refresh()
			})
			chips.appendChild(b)
		})
	}
	const mountTimer = () => {
		if (!statusEl || !_oscClient) return
		let slot = document.getElementById('header-pgm-timer') || document.createElement('div')
		if (!slot.id) { slot.id = 'header-pgm-timer'; slot.className = 'header-pgm-timer-wrap'; statusEl.insertBefore(slot, statusEl.firstChild) }
		let chips = slot.querySelector('.header-pgm-timer-chips')
		let timerHost = slot.querySelector('.header-pgm-timer-host')
		if (!chips || !timerHost) {
			slot.innerHTML = ''
			chips = document.createElement('div')
			chips.className = 'header-pgm-timer-chips'
			timerHost = document.createElement('div')
			timerHost.className = 'header-pgm-timer-host'
			slot.append(chips, timerHost)
		}
		if (pgmHeaderTimerDestroy) pgmHeaderTimerDestroy.destroy()
		pgmHeaderTimerDestroy = mountPgmTopLayerPlaybackTimer(timerHost, {
			oscClient: _oscClient, getState: () => stateStore.getState(),
			getChannel: () => ensureSelectedPlaybackChannel(),
		})
		renderPlaybackChannelChips()
	}
	mountTimer(); dashboardState.on('screenChange', () => pgmHeaderTimerDestroy?.refresh()); sceneState.on('screenChange', () => pgmHeaderTimerDestroy?.refresh())
	stateStore.on('*', (path) => {
		if (path === 'channelMap') renderPlaybackChannelChips()
		if (['channelMap', 'channels', null].includes(path)) pgmHeaderTimerDestroy?.refresh()
	})

	initSourcesPanel(document.querySelector('#panel-sources .panel__body'), stateStore, { wsClient: ws })
	initScenesEditor(document.querySelector('#tab-scenes'), stateStore, { getOscClient: () => _oscClient })
	initTimelineEditor(document.querySelector('#tab-timeline'), stateStore); initMultiviewEditor(document.querySelector('#tab-multiview'), stateStore)
	initPixelMapEditor(document.querySelector('#tab-pixelmap'), stateStore); initInspectorPanel(document.getElementById('panel-inspector-scroll') || document.getElementById('panel-inspector-body') || document.querySelector('#panel-inspector .panel__body'), stateStore)
	initAudioMixerPanel(stateStore, document.getElementById('panel-inspector-audio-mount'))

	settingsState.subscribe(s => {
		applyBrowserMonitorFromSettings(s); const isOffline = !!s.offline_mode
		document.body.classList.toggle('offline-mode', isOffline); if (connectionEye) connectionEye.setOffline(isOffline); stateStore.setOffline(isOffline)
	})

	try {
		const settings = await api.get('/api/settings'); if (settings) { Object.assign(settingsState.settings, settings); settingsState.notify() }
		if (settings?.offline_mode) await stateStore.hydrateFromCache()
		const state = await api.get('/api/state'); if (state) {
			stateStore.setState(state); if (state.variables) getVariableStore(ws)?.mergeFromServer(state.variables)
			sceneState.setCanvasResolutions(state.channelMap?.programResolutions); appLogic.syncMultiviewCanvas(state.channelMap)
			appLogic.scheduleMultiviewRefresh(); appLogic.emitCasparConnectedIfNeeded(state)
			if (state.scene?.live) sceneState.applyServerLiveChannels(state.scene.live, state.channelMap)
			httpConnected = true; appLogic.updateStatus(true); appLogic.refreshEye()
		}
		if (!settings?.offline_mode) {
			try {
				const proj = await api.get('/api/project'); if (proj?.version) { projectState.importProject(proj, sceneState, timelineState, multiviewState, dashboardState); window.dispatchEvent(new Event('project-loaded')) }
			} catch {}
		}
	} catch (err) { console.warn('[HighAsCG] Bootstrap failed:', err.message) }
}

export function getOscClient() { return _oscClient }
init()
