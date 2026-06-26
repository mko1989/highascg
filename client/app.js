/**
 * CasparCG Web Client — main app entry.
 */
import { WsClient } from './lib/ws-client.js'
import { OscClient } from './lib/osc-client.js'
import { api } from './lib/api-client.js'
import StateStore from './lib/state-store.js'
import { initSourcesPanel } from './components/sources-panel.js'
import { sceneState } from './lib/scene-state.js'
import { applyEditorDefaultsToRuntime } from './lib/editor-defaults.js'
import { setAppRuntime } from './lib/app-runtime.js'
import { initScenesEditor } from './components/scenes-editor.js'
import { initTimelineEditor } from './components/timeline-editor.js'
import { initInspectorPanel } from './components/inspector-panel.js'
import { initMultiviewEditor } from './components/multiview-editor.js'
import { initWorkspaceLayout } from './lib/workspace-layout.js'
import { initHeaderBar } from './components/header-bar.js'
import { projectFileIdFromName } from './lib/project-files.js'
import { initAudioMixerPanel } from './components/audio-mixer-panel.js'
import { refreshLiveAudioConfigured } from './lib/live-audio-state.js'
import { mountPgmTopLayerPlaybackTimer } from './components/playback-timer.js'
import { programOutputState } from './lib/program-output-state.js'
import { applySettingsFromServer, settingsState } from './lib/settings-state.js'
import { streamState, applyBrowserMonitorFromSettings } from './lib/stream-state.js'
import { showSettingsModal } from './components/settings-modal.js'
import { createConnectionEye } from './components/connection-eye.js'
import { showLogsModal } from './components/logs-modal.js'
import { multiviewState } from './lib/multiview-state.js'
import { dmxState } from './lib/dmx-state.js'
import { initPixelMapEditor } from './components/pixel-map-editor.js'

import { getVariableStore } from './lib/variable-state.js'
import { projectState } from './lib/project-state.js'
import { timelineState } from './lib/timeline-state.js'
import { initOptionalModules } from './lib/optional-modules.js'
import { initDeviceView } from './components/device-view.js'
import { initAudioMixerView } from './components/audio-mixer-view.js'
import { placeholderState } from './lib/placeholder-state.js'
import {
	bootstrapFromServer,
	canPushProjectToServer,
	resyncFromServer,
	setOfflineBootstrapMode,
	shouldResyncOnWsConnect,
} from './lib/server-project-sync.js'
import { markLocalProjectSaved } from './lib/project-remote-sync.js'


import * as Status from './lib/app-status.js'
import * as Handlers from './lib/app-ws-handlers.js'
import * as SceneDeck from './lib/app-scene-deck.js'
import * as MvSync from './lib/app-multiview-sync.js'

export const stateStore = new StateStore()
export const ws = new WsClient()
window.placeholderState = placeholderState
settingsState.subscribe(() => applyEditorDefaultsToRuntime(sceneState))
getVariableStore(ws)

let _oscClient = null; let httpConnected = false; let _casparAmcpConnected = false; let connectionEye = null

const serverSyncDeps = {
	stateStore,
	sceneState,
	timelineState,
	multiviewState,
	programOutputState,
	projectState,
	getVariableStore: () => getVariableStore(ws),
	appLogic: /** @type {Record<string, unknown>} */ ({}),
}

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
		if (shouldResyncOnWsConnect()) {
			void resyncFromServer(serverSyncDeps)
		}
	},
	handleWsDisconnect: async (reason) => {
		if (httpConnected) {
			try {
				const st = await api.get('/api/state')
				if (st) stateStore.setState(st)
			} catch {}
			appLogic.updateStatus(true)
		} else appLogic.updateStatus(false, reason)
		appLogic.refreshEye()
	},
}
Object.assign(serverSyncDeps.appLogic, appLogic)

function initTabs() {
	const tabStorageKey = 'highascg_active_tab'
	const activateTab = (target) => {
		document.querySelectorAll('.workspace__tabs .tab').forEach((t) => t.classList.remove('active'))
		document.querySelectorAll('.workspace__content .tab-pane').forEach((p) => {
			p.classList.toggle('active', p.id === `tab-${target}`)
		})
		const tab = document.querySelector(`.workspace__tabs .tab[data-tab="${target}"]`)
		if (tab) tab.classList.add('active')
		try { localStorage.setItem(tabStorageKey, target) } catch { /* ignore */ }
		if (target !== 'pixelmap') {
			window.dispatchEvent(new CustomEvent('highascg-mapping-browser-visibility', { detail: { visible: false } }))
		}
		if (['scenes', 'multiview', 'pixelmap', 'timeline'].includes(target)) requestAnimationFrame(() => document.dispatchEvent(new CustomEvent(`${target === 'pixelmap' ? 'px' : (target === 'multiview' ? 'mv' : target)}-tab-activated`)))
		if (target === 'device-view') initDeviceView(document.getElementById('tab-device-view'))
		if (target === 'audio-mixer-view') initAudioMixerView(document.getElementById('tab-audio-mixer-view'), stateStore)
		window.dispatchEvent(new CustomEvent('highascg-workspace-tab-activated', { detail: { tab: target } }))
	}
	window.highascgActivateWorkspaceTab = activateTab
	const tabBar = document.querySelector('.workspace__tabs')
	if (tabBar) {
		tabBar.addEventListener('click', (e) => {
			const tab = e.target.closest('.tab')
			if (!tab?.dataset?.tab) return
			activateTab(tab.dataset.tab)
		})
	}
	
	window.addEventListener('highascg-open-pixel-mapping', (ev) => {
		const nodeId = ev.detail?.nodeId
		activateTab('device-view')
		window.dispatchEvent(new CustomEvent('highascg-mapping-browser-visibility', { detail: { visible: true, activate: true, nodeId } }))
		// Also trigger the editor component
		window.dispatchEvent(new CustomEvent('highascg-pixel-mapping-open', { detail: { nodeId } }))
	})

	window.addEventListener('highascg-device-view-select-device', (ev) => {
		const deviceId = ev.detail?.deviceId
		activateTab('device-view')
		window.dispatchEvent(new CustomEvent('highascg-device-view-focus-device', { detail: { deviceId } }))
	})

	let initial = ''
	try { initial = localStorage.getItem(tabStorageKey) || '' } catch { /* ignore */ }
	if (!initial || !document.querySelector(`.tab[data-tab="${initial}"]`)) {
		const firstTab = document.querySelector('.workspace__tabs .tab')
		initial = document.querySelector('.workspace__tabs .tab.active')?.dataset.tab || firstTab?.dataset.tab || ''
	}
	if (initial) activateTab(initial)
}

async function init() {
	const eyeContainer = document.getElementById('connection-eye-container')
	if (eyeContainer) {
		eyeContainer.innerHTML = ''
		connectionEye = createConnectionEye(eyeContainer); connectionEye.el.style.cursor = 'pointer'
		connectionEye.el.addEventListener('click', () => showLogsModal())
	}
	window.addEventListener('keydown', e => {
		if (!(e.ctrlKey || e.metaKey) || e.key !== ',' || e.target.closest('input, textarea, select, [contenteditable="true"]')) return
		e.preventDefault(); showSettingsModal()
	})
	initTabs(); initWorkspaceLayout()
	void initOptionalModules({ stateStore, ws, api, sceneState, settingsState, streamState })
	_oscClient = new OscClient({ wsClient: ws })
	window.highascg_osc_client = _oscClient
	setAppRuntime({ ws, osc: _oscClient })

	Handlers.attachWsHandlers(ws, { stateStore, sceneState, timelineState, multiviewState, programOutputState, projectState, dmxState, variableStore: getVariableStore(ws), appLogic })

	let autosaveTimeout = null
	let autosaveInFlight = null
	let autosavePending = false

	async function triggerAutosave() {
		if (!canPushProjectToServer()) return
		if (autosaveInFlight) {
			autosavePending = true
			return autosaveInFlight
		}
		autosaveInFlight = (async () => {
			try {
				const project = projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
				await api.post('/api/project/autosave', { project })
				const d = new Date()
				const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				document.dispatchEvent(new CustomEvent('project-autosaved', { detail: { time: timeStr } }))
			} catch (e) {
				console.warn('[HighAsCG] Auto-save failed:', e.message)
			} finally {
				autosaveInFlight = null
				if (autosavePending) {
					autosavePending = false
					void triggerAutosave()
				}
			}
		})()
		return autosaveInFlight
	}

	/** Debounced autosave for batched editor updates (e.g. timeline nudges). */
	function scheduleAutosave(delayMs = 3000) {
		if (autosaveTimeout) clearTimeout(autosaveTimeout)
		autosaveTimeout = setTimeout(() => {
			autosaveTimeout = null
			void triggerAutosave()
		}, delayMs)
	}

	/** Run autosave now — use when a user action or edit session has finished. */
	function flushAutosave() {
		if (autosaveTimeout) {
			clearTimeout(autosaveTimeout)
			autosaveTimeout = null
		}
		return triggerAutosave()
	}

	function flushAutosaveIfPending() {
		if (!autosaveTimeout) return Promise.resolve()
		return flushAutosave()
	}

	sceneState.on('change', () => {
		appLogic.scheduleSceneDeckSync()
		if (document.querySelector('input:focus, select:focus, textarea:focus')) {
			scheduleAutosave(3000)
		} else {
			void flushAutosave()
		}
	})
	sceneState.on('imported', () => {
		appLogic.scheduleSceneDeckSync()
		void flushAutosave()
	})
	sceneState.on('previewScene', () => {
		appLogic.scheduleSceneDeckSync()
	})
	sceneState.on('softChange', () => {
		appLogic.scheduleSceneDeckSync()
	})
	sceneState.on('editingChange', (id) => {
		if (id == null) void flushAutosave()
	})
	document.addEventListener('highascg-global-border-config-save', () => void flushAutosave())
	sceneState.on('persisted', () => {
		if (!canPushProjectToServer()) return
		appLogic.scheduleSceneDeckSync()
		const project = projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
		const id = projectFileIdFromName(project.name || projectState.getProjectName())
		markLocalProjectSaved()
		api.post('/api/project/save', { project, id })
			.catch(e => console.warn('[HighAsCG] Main save failed:', e.message))
		void flushAutosave()
	})
	timelineState.on('change', scheduleAutosave)
	multiviewState.on('change', scheduleAutosave)

	document.addEventListener('highascg-workspace-tab-activated', () => void flushAutosaveIfPending())
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') void flushAutosaveIfPending()
	})
	window.addEventListener('pagehide', () => void flushAutosaveIfPending())

	window.addEventListener('project-loaded', () => {
		if (canPushProjectToServer()) appLogic.scheduleSceneDeckSync()
	})

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
	mountTimer(); sceneState.on('screenChange', () => pgmHeaderTimerDestroy?.refresh())
	stateStore.on('*', (path) => {
		if (path === 'channelMap') renderPlaybackChannelChips()
		if (['channelMap', 'channels', null].includes(path)) pgmHeaderTimerDestroy?.refresh()
	})

	initSourcesPanel(document.querySelector('#panel-sources .panel__body'), stateStore, { wsClient: ws })
	/** Live tab: POST /api/device-view can return before WS change is applied; bridge for instant list updates. */
	window.__highascgApplyExtraLiveSources = (list) => {
		if (Array.isArray(list)) stateStore.applyChange('extraLiveSources', list)
	}
	initScenesEditor(document.querySelector('#tab-scenes'), stateStore, {
		getOscClient: () => _oscClient,
		getVariableStore: () => getVariableStore(ws),
		flushSceneDeckSync: () => SceneDeck.flushSceneDeckSync(ws, sceneState),
	})
	initTimelineEditor(document.querySelector('#tab-timeline'), stateStore); initMultiviewEditor(document.querySelector('#tab-multiview'), stateStore)
	initPixelMapEditor(document.querySelector('#tab-pixelmap'), stateStore); initInspectorPanel(document.getElementById('panel-inspector-scroll') || document.getElementById('panel-inspector-body') || document.querySelector('#panel-inspector .panel__body'), stateStore)
	initAudioMixerPanel(stateStore, document.getElementById('panel-inspector-audio-mount'))

	settingsState.subscribe(s => {
		applyBrowserMonitorFromSettings(s); const isOffline = !!s.offline_mode
		document.body.classList.toggle('offline-mode', isOffline); if (connectionEye) connectionEye.setOffline(isOffline); stateStore.setOffline(isOffline)
	})

	try {
		const settings = await api.get('/api/settings')
		if (settings) {
			applySettingsFromServer(settings)
			settingsState.notify()
		}
		if (settings?.offline_mode) {
			setOfflineBootstrapMode(true)
			await stateStore.hydrateFromCache()
			httpConnected = true
			appLogic.updateStatus(true)
			appLogic.refreshEye()
		} else {
			const state = await bootstrapFromServer(serverSyncDeps)
			if (state) httpConnected = true
		}
		if (!settings?.offline_mode) void refreshLiveAudioConfigured(stateStore)
	} catch (err) {
		console.warn('[HighAsCG] Bootstrap failed:', err.message)
	}
}

export function getOscClient() { return _oscClient }
init()

document.addEventListener('dblclick', (ev) => {
	const target = ev.target
	if (target && target.tagName === 'INPUT' && target.type === 'range') {
		ev.preventDefault()
		ev.stopPropagation()
		const attrVal = target.getAttribute('value')
		const defVal = attrVal !== null ? attrVal : (target.defaultValue !== undefined ? target.defaultValue : '')
		let val = defVal
		if (val === '') {
			if (target.id === 'cable-messiness') {
				val = '0'
			} else if (target.min === '0.5' && target.max === '3') {
				val = '1'
			} else {
				const min = parseFloat(target.min) || 0
				const max = parseFloat(target.max) || 100
				val = String(min + (max - min) / 2)
			}
		}
		target.value = val
		target.dispatchEvent(new Event('input', { bubbles: true }))
		target.dispatchEvent(new Event('change', { bubbles: true }))
	}
})
