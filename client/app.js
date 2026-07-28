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
import { normalizeProjectMediaRefs } from './lib/project-media-context.js'
import { markLocalProjectSaved } from './lib/project-remote-sync.js'
import { initAudioMixerPanel } from './components/audio-mixer-panel.js'
import { initTimerControlPanel, getScreenTimersSnapshot } from './components/timer-control-panel.js'
import { initPlaylistControlPanel } from './components/playlist-control-panel.js'
import { initShaderLiveEditor } from './components/shader-live-editor.js'
import { refreshLiveAudioConfigured } from './lib/live-audio-state.js'
import { programOutputState } from './lib/program-output-state.js'
import { applySettingsFromServer, settingsState } from './lib/settings-state.js'
import { streamState, applyBrowserMonitorFromSettings } from './lib/stream-state.js'
import { showSettingsModal } from './components/settings-modal.js'
import { createConnectionEye } from './components/connection-eye.js'
import { showLogsModal } from './components/logs-modal.js'
import { multiviewState } from './lib/multiview-state.js'
import { dmxState } from './lib/dmx-state.js'
import { initPixelMapEditor } from './components/pixel-map-editor.js'
import { initTabs } from './lib/app-tabs.js'
import { initPgmHeaderTimer } from './lib/app-pgm-header-timer.js'
import { initRangeInputDblclickReset } from './lib/app-range-dblclick.js'

import { getVariableStore } from './lib/variable-state.js'
import { projectState } from './lib/project-state.js'
import { timelineState } from './lib/timeline-state.js'
import { initOptionalModules } from './lib/optional-modules.js'
import { initCgStudioTab } from './components/cg-studio-tab.js'
import { placeholderState } from './lib/placeholder-state.js'
import {
	bootstrapFromServer,
	canPushProjectToServer,
	markProjectGoneOnServer,
	resyncFromServer,
	setOfflineBootstrapMode,
	shouldResyncOnWsConnect,
} from './lib/server-project-sync.js'

import * as Status from './lib/app-status.js'
import { clearStaleApiOriginOverrideOnPlayoutUi } from './lib/api-origin.js'
import * as Handlers from './lib/app-ws-handlers.js'
import * as SceneDeck from './lib/app-scene-deck.js'
import * as MvSync from './lib/app-multiview-sync.js'
import { initReplicationUiState } from './lib/replication-ui-state.js'
import { showAppToast } from './lib/app-toast.js'
import { applyOperatorGuiHtmlClass, initOperatorGuiRectReporting } from './lib/operator-gui-mode.js'
import { initOperatorGuiInteractionSuppress } from './lib/operator-gui-interaction-suppress.js'
import { initDecklinkInputToasts, initLiveInputFailureToasts } from './lib/decklink-input-toast.js'
import { initMediaExistsIndex } from './lib/media-exists.js'
import { initMediaDurationIndex } from './lib/media-duration.js'

clearStaleApiOriginOverrideOnPlayoutUi()
// WO-243/255: hard-gated on ?operatorGui / legacy ?cefOperator in the query string — no-op
// (removes the class, which is already absent) for every normal browser session.
applyOperatorGuiHtmlClass()
initOperatorGuiInteractionSuppress()

export const stateStore = new StateStore()
initDecklinkInputToasts(stateStore)
/* WO-360 (re-wired 28.07 — the lint census caught these calls lost in a batch edit). */
initMediaExistsIndex(stateStore)
initMediaDurationIndex(stateStore) // WO-370: real clip lengths for playlist rows
initLiveInputFailureToasts(stateStore)
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
	refreshEye: () =>
		Status.refreshCasparConnectionEye(connectionEye, stateStore, {
			wsConnected: ws.connected,
			httpConnected,
		}),
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
	initTabs(stateStore); initWorkspaceLayout()
	initReplicationUiState(ws)
	void initOptionalModules({ stateStore, ws, api, sceneState, settingsState, streamState }).then(() => initCgStudioTab())
	_oscClient = new OscClient({ wsClient: ws })
	window.highascg_osc_client = _oscClient
	setAppRuntime({ ws, osc: _oscClient, stateStore, appLogic, getVariableStore: () => getVariableStore(ws) })

	Handlers.attachWsHandlers(ws, { stateStore, sceneState, timelineState, multiviewState, programOutputState, projectState, dmxState, variableStore: getVariableStore(ws), appLogic })
	// WO-254 T254.2 (kept under the WO-255 rename): re-POST cached merged cell rects on WS
	// reconnect / server nudge / 60s heartbeat. Hard-gated inside — no-op for every normal
	// (non-operator-GUI) session.
	initOperatorGuiRectReporting(ws)

	let autosaveTimeout = null
	let autosaveInFlight = null
	let autosavePending = false
	/* WO-329B: consecutive stale_rev retries. Bounded so two clients hammering each other can't
	 * ping-pong forever; reset on any successful autosave. */
	let autosaveStaleRetries = 0

	async function triggerAutosave() {
		if (!canPushProjectToServer()) return
		if (autosaveInFlight) {
			autosavePending = true
			return autosaveInFlight
		}
		autosaveInFlight = (async () => {
			try {
				let project = projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
				project = normalizeProjectMediaRefs(project, settingsState.getSettings())
				const res = await api.post('/api/project/autosave', { project })
				if (res?.slug && projectState.setProjectSlug) projectState.setProjectSlug(res.slug)
				/* WO-329: adopt the server-issued rev — the next save must echo it or be seen as stale. */
				if (res?.rev != null) projectState.setRev(res.rev)
				autosaveStaleRetries = 0
				/* WO-329B: a CHANGED autosave triggers a project_sync broadcast that includes this
				 * client — latch to skip our own echo (same latch the explicit Save uses). Unchanged
				 * autosaves broadcast nothing; latching then would eat a future real remote sync. */
				if (res?.changed) markLocalProjectSaved()
				const d = new Date()
				const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				document.dispatchEvent(new CustomEvent('project-autosaved', { detail: { time: timeStr } }))
			} catch (e) {
				const reason = e?.body?.reason || e?.reason || e?.message || String(e)
				// WO-311: 410 project_gone means the server deleted this project (factory reset /
				// delete). Retrying would recreate it — the resurrection bug. Latch autosave OFF
				// and tell the operator once; Save As or a reload is the way out.
				// api-client attaches `status` and `reason` to the error (never `body`).
				if (e?.status === 410 || e?.reason === 'project_gone') {
					markProjectGoneOnServer()
					console.warn('[HighAsCG] Auto-save stopped: project was deleted on the server')
					document.dispatchEvent(
						new CustomEvent('project-gone-on-server', {
							detail: { reason: 'project_gone', message: e?.message || '' },
						}),
					)
				} else if (e?.status === 409 && e?.reason === 'stale_rev' && e?.storedRev != null && autosaveStaleRetries < 3) {
					/* WO-329B (owner decision: last write wins): another client bumped the rev.
					 * Adopting the server rev + re-pushing our CURRENT state once makes this client
					 * the last writer instead of stranding it in log-only 409s forever (the exact
					 * "changes just weren't updated" failure). The re-push broadcasts, so the other
					 * client converges to us. Bounded at 3 consecutive conflicts; other 409 reasons
					 * (empty_over_nonempty, unrelated_scene_set) keep the warn-only path — those
					 * mean OUR copy is the wrong one to push. */
					autosaveStaleRetries++
					projectState.setRev(e.storedRev)
					console.warn(`[HighAsCG] Auto-save rev conflict (stored rev ${e.storedRev}) — re-pushing local state, last write wins (attempt ${autosaveStaleRetries}/3)`)
					autosavePending = true
				} else {
					console.warn('[HighAsCG] Auto-save failed:', reason)
					document.dispatchEvent(
						new CustomEvent('project-autosave-failed', {
							detail: { reason, status: e?.status },
						}),
					)
				}
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
		// Defer focus check so blur handlers (e.g. look rename) finish before autosave scheduling.
		queueMicrotask(() => {
			if (document.querySelector('input:focus, select:focus, textarea:focus')) {
				scheduleAutosave(3000)
			} else {
				void flushAutosave()
			}
		})
	})
	/* WO-341 (owner sync principle 2026-07-26): server-originated events (`remote: true` — a ws
	 * project_sync import or a scene.live broadcast) must NEVER write shared state back. Emitting
	 * a deck sync + autosave in reaction to an incoming sync was the primary client↔client echo
	 * loop ("sync errors between clients"). Only actual user interaction writes. */
	sceneState.on('imported', (meta) => {
		if (meta?.remote === true) return
		appLogic.scheduleSceneDeckSync()
		void flushAutosave()
	})
	sceneState.on('previewScene', (meta) => {
		if (meta?.remote === true) return
		appLogic.scheduleSceneDeckSync()
	})
	sceneState.on('softChange', (meta) => {
		if (meta?.remote === true) return
		appLogic.scheduleSceneDeckSync()
	})
	sceneState.on('editingChange', (id) => {
		if (id == null) void flushAutosave()
	})
	document.addEventListener('highascg-global-border-config-save', () => void flushAutosave())
	sceneState.on('persisted', (meta) => {
		/* WO-341 kill #1: an all-remote persist window is server data landing, not a user edit. */
		if (meta?.remote === true) return
		if (!canPushProjectToServer()) return
		appLogic.scheduleSceneDeckSync()
		void flushAutosave()
	})
	timelineState.on('change', scheduleAutosave)
	multiviewState.on('change', scheduleAutosave)

	// activateTab dispatches on window — a document listener would never fire
	window.addEventListener('highascg-workspace-tab-activated', () => void flushAutosaveIfPending())
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') void flushAutosaveIfPending()
	})
	window.addEventListener('pagehide', () => void flushAutosaveIfPending())

	window.addEventListener('project-loaded', (e) => {
		/* WO-341 kill #3: remote ws imports fire this too — only user-initiated loads push. */
		if (e?.detail?.remote === true) return
		if (canPushProjectToServer()) appLogic.scheduleSceneDeckSync()
	})

	const header = document.querySelector('.header'); const statusEl = document.querySelector('.header__status')
	if (header && statusEl) initHeaderBar(header, statusEl, stateStore)

	initPgmHeaderTimer({ stateStore, sceneState, statusEl, getOscClient: () => _oscClient })

	initSourcesPanel(document.querySelector('#panel-sources .panel__body'), stateStore, { wsClient: ws })
	/** Live tab: POST /api/device-view can return before WS change is applied; bridge for instant list updates. */
	window.__highascgApplyExtraLiveSources = (list) => {
		if (Array.isArray(list)) stateStore.applyChange('extraLiveSources', list)
	}
	window.__highascgApplyHostOperatorFullscreen = (hostState) => {
		stateStore.applyChange('hostOperatorFullscreen', hostState)
	}
	initScenesEditor(document.querySelector('#tab-scenes'), stateStore, {
		getOscClient: () => _oscClient,
		getVariableStore: () => getVariableStore(ws),
		flushSceneDeckSync: () => SceneDeck.flushSceneDeckSync(ws, sceneState),
	})
	initTimelineEditor(document.querySelector('#tab-timeline'), stateStore, {
		getOscClient: () => _oscClient,
	}); initMultiviewEditor(document.querySelector('#tab-multiview'), stateStore)
	initPixelMapEditor(document.querySelector('#tab-pixelmap'), stateStore); initInspectorPanel(document.getElementById('panel-inspector-scroll') || document.getElementById('panel-inspector-body') || document.querySelector('#panel-inspector .panel__body'), stateStore)
	initAudioMixerPanel(stateStore, document.getElementById('panel-inspector-audio-mount'))
	initTimerControlPanel(stateStore, document.getElementById('panel-inspector-timer-mount'), { getChannelMap: () => stateStore.getState()?.channelMap || {} })
	initPlaylistControlPanel(document.getElementById('panel-inspector-playlists-mount'))
	initShaderLiveEditor(stateStore)
	// WO-210 T210.8: Register timers snapshot function for look-save integration.
	// Derive the look's target screens from mainScope so the flat {timerId: boolean}
	// snapshot only reflects timers on screens this look actually drives.
	sceneState.setTimersSnapshotFn((scene) => {
		const cm = stateStore.getState()?.channelMap || {}
		const count = Number(cm.screenCount) || 1
		const scope = String(scene?.mainScope || 'all')
		const n = parseInt(scope, 10)
		const idxs =
			scope !== 'all' && Number.isFinite(n) && n >= 0 && n < count
				? [n]
				: Array.from({ length: count }, (_, i) => i)
		return getScreenTimersSnapshot(scene, idxs)
	})

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
		showAppToast(`Failed to load server state: ${err?.message || err}`, 'error')
	}
}

export function getOscClient() { return _oscClient }
init()

initRangeInputDblclickReset()
