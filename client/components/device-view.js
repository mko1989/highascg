/**
 * Device view orchestrator.
 */
import { showSettingsModal } from './settings-modal.js'
import {
	CASPAR_HOST,
	connectorById,
	connectorRole,
	orderEdgeForDeviceView,
	resolveConnectorId,
	isConnectorVisible,
	resolveDestinationSinkConnectorId,
	friendlyConnectorLabel,
} from './device-view-helpers.js'
import { setStatus, buildInspectorTable, connectorIdFromEvent, renderPreservingFocus } from './device-view-ui-utils.js'
import { renderCableOverlay } from './device-view-cables.js'
import { renderDestinations } from './device-view-destinations-ui.js'
import { renderBands } from './device-view-bands-render.js'
import { renderMatrix } from './device-view-matrix.js'
import { renderDeviceInspector, renderEdgeInspector } from './device-view-inspector-render.js'
import * as Actions from './device-view-actions.js'
import { migrateLegacyGpuLayoutPrefsToServer } from '../lib/device-view-gpu-port-list.js'
import { FACTORY_RESET_GPU_LAYOUT_KEY } from '../lib/device-view-gpu-port-constants.js'
import { settingsState } from '../lib/settings-state.js'
import { gpuTopologyMismatchActive } from '../lib/device-view-gpu-port-topology.js'
import { getStreamingChannelStatus } from '../lib/streaming-channel-state.js'
import { renderConnectorInspector, renderCasparSettingsInspector } from './device-view-inspectors.js'
import { showLogsModal } from './logs-modal.js'
import { describeCableRejection, cableReasonFromError } from '../lib/device-view-cable-messages.js'
import { isUnknownCableConnectorError, resolveCableEdgeIds, findGpuSinkCableConflict } from '../lib/device-view-cable-resolve.js'
import { gpuPhysicalPortCableId } from '../lib/device-view-gpu-port-list.js'
import { findScreenDestinationById, populateDestinationTypeSelect, listHostChannelDestinations, mergeSettingsIntoDeviceViewPayload } from '../lib/device-view-host-channels.js'
import { showCasparConfigModal } from './caspar-config-modal.js'
import { renderDestinationInspector } from './device-view-destinations-inspector.js'
import { openSaveDeviceSnapshotModal, openLoadDeviceSnapshotModal } from './device-view-snapshot-modals.js'
import { resolveGpuPhysicalScreenIndex, resolveGpuScreenNumber } from './device-view-inspector-gpu-resolve.js'
import {
	screenConsumerDefaultsSettingsPatch,
	screenConsumerSeedSettingsPatch,
	shouldSeedScreenConsumerDefaults,
	multiviewConsumerDefaultsSettingsPatch,
	shouldSeedMultiviewAlwaysOnTopDefault,
} from '../lib/screen-consumer-defaults.js'
import { resolveProjectFpsFromSettings, defaultVideoModeForProjectFps } from '../lib/project-fps.js'
import {
	gpuOutputBindingFromCableSource,
	gpuScreenInheritedSettingsPatch,
	mergeSettingsPatches,
	resolveCableSourceResolution,
} from '../lib/device-view-gpu-source-inherit.js'
import { getAppWs } from '../lib/app-runtime.js'
import { readSimpleWiring, writeSimpleWiring } from '../lib/device-view-simple-wiring-prefs.js'
import { saveVirtualCameraConfig, stopVirtualCamera } from '../lib/virtual-camera-state.js'
import { renderLiveSourcesBand, openAddLiveSourceModal } from './device-view-live-sources-render.js'

let mounted = false
let onTabActivated = null

export function onDeviceViewTabActivated() {
	onTabActivated?.()
}

export function initDeviceView(root) {
	if (!root || mounted) return; mounted = true; root.innerHTML = ''
	const wrap = document.createElement('div'); wrap.className = 'device-view'
	const header = document.createElement('div'); header.className = 'device-view__header'
	const actions = document.createElement('div'); actions.className = 'device-view__actions'
	const refreshBtn = document.createElement('button'); refreshBtn.className = 'header-btn'; refreshBtn.textContent = 'Refresh'
	const resetBtn = document.createElement('button'); resetBtn.className = 'header-btn'; resetBtn.textContent = 'Reset all cabling'
	const applyCasparBtn = document.createElement('button'); applyCasparBtn.className = 'header-btn device-view__apply-btn'; applyCasparBtn.textContent = 'Apply Caspar config (restart)'
	const editCasparBtn = document.createElement('button')
	editCasparBtn.type = 'button'
	editCasparBtn.className = 'header-btn device-view__edit-config-btn'
	editCasparBtn.innerHTML = `<svg class="device-view__edit-config-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="12" height="13" rx="1.5"/><line x1="7" y1="12" x2="13" y2="12"/><line x1="7" y1="15" x2="13" y2="15"/><line x1="7" y1="18" x2="10" y2="18"/><line x1="12" y1="3" x2="20" y2="11"/><line x1="19" y1="10" x2="21" y2="12"/><line x1="10" y1="5" x2="12" y2="3"/></svg>`
	editCasparBtn.title = 'View or edit generated Caspar config (advanced)'
	editCasparBtn.setAttribute('aria-label', 'Caspar config editor')
	const saveSnapBtn = document.createElement('button'); saveSnapBtn.className = 'header-btn'; saveSnapBtn.textContent = 'Save snapshot'
	const loadSnapBtn = document.createElement('button'); loadSnapBtn.className = 'header-btn'; loadSnapBtn.textContent = 'Load snapshot'
	actions.append(refreshBtn, saveSnapBtn, loadSnapBtn, resetBtn, applyCasparBtn, editCasparBtn); header.append(Object.assign(document.createElement('h2'), { className: 'device-view__title', textContent: 'Devices' }), actions)
	const cableRow = document.createElement('div'); cableRow.className = 'device-view__toolbar'
	const clearCableBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'header-btn', textContent: 'Cancel cable', style: 'display:none' })
	const messinessLabel = Object.assign(document.createElement('label'), { textContent: 'Cable loops: ', style: 'margin-left: 14px; font-size: 11px; opacity: 0.8' })
	const messinessSlider = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '2', value: '0', id: 'cable-messiness', style: 'width: 40px; height: 8px; cursor: pointer;' })
	const messinessVal = Object.assign(document.createElement('span'), { textContent: '0', style: 'margin-left: 6px; font-size: 11px; font-weight: 600;' })
	messinessSlider.oninput = () => { messinessVal.textContent = messinessSlider.value; updateUI() }
	const messinessWrap = document.createElement('span')
	messinessWrap.className = 'device-view__messiness-wrap'
	messinessWrap.append(messinessLabel, messinessSlider, messinessVal)
	const simpleLabel = Object.assign(document.createElement('label'), {
		className: 'device-view__simple-wiring-toggle',
		title: 'Compact node layout and straight cable lines on the rear panel.',
	})
	const simpleWiringCk = Object.assign(document.createElement('input'), { type: 'checkbox' })
	simpleWiringCk.checked = readSimpleWiring()
	const simpleText = document.createElement('span')
	simpleText.textContent = ' Node view'
	simpleLabel.append(simpleWiringCk, simpleText)

	const matrixLabel = Object.assign(document.createElement('label'), {
		className: 'device-view__matrix-view-toggle',
		title: 'Dense Dante-style routing matrix.',
		style: 'margin-left: 14px;'
	})
	const matrixCk = Object.assign(document.createElement('input'), { type: 'checkbox' })
	matrixCk.checked = window.localStorage.getItem('device-view-matrix') === 'true'
	const matrixText = document.createElement('span')
	matrixText.textContent = ' Matrix view'
	matrixLabel.append(matrixCk, matrixText)
	function syncSimpleWiringMode() {
		const on = !!simpleWiringCk.checked
		writeSimpleWiring(on)
		wrap.classList.toggle('device-view--simple-wiring', on)
		updateMessinessVisibility()
	}
	function beginViewModeTransition() {
		wrap.style.opacity = '0'
	}

	function endViewModeTransition() {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				updateUI()
				wrap.style.opacity = ''
			})
		})
	}

	function applyViewModeChange() {
		beginViewModeTransition()
		syncSimpleWiringMode()
		syncMatrixMode()
		if (lastPayload) {
			renderFromState()
			endViewModeTransition()
		} else {
			void load().then(() => endViewModeTransition())
		}
	}

	simpleWiringCk.addEventListener('change', () => {
		if (simpleWiringCk.checked) matrixCk.checked = false
		applyViewModeChange()
	})
	
	function syncMatrixMode() {
		const on = !!matrixCk.checked
		window.localStorage.setItem('device-view-matrix', on ? 'true' : 'false')
		wrap.classList.toggle('device-view--matrix-view', on)
		if (on) {
			simpleLabel.style.display = 'none'
			matrixHost.style.display = ''
			destPanel.style.display = 'none'
			rearPanel.style.display = 'none'
			mappingPanel.style.display = 'none'
			cableOverlay.style.display = 'none'
		} else {
			simpleLabel.style.display = ''
			matrixHost.style.display = 'none'
			destPanel.style.display = ''
			rearPanel.style.display = ''
			mappingPanel.style.display = ''
			cableOverlay.style.display = ''
		}
		updateMessinessVisibility()
	}
	
	function updateMessinessVisibility() {
		if (matrixCk.checked || simpleWiringCk.checked) {
			messinessWrap.style.display = 'none'
		} else {
			messinessWrap.style.display = ''
		}
	}

	matrixCk.addEventListener('change', () => {
		if (matrixCk.checked) simpleWiringCk.checked = false
		applyViewModeChange()
	})
	

	cableRow.append(clearCableBtn, messinessWrap, simpleLabel, matrixLabel)
	const destPanel = document.createElement('div'); destPanel.className = 'device-view__destinations'
	const destHead = document.createElement('div'); destHead.className = 'device-view__destinations-head'
	const destTitle = Object.assign(document.createElement('span'), { className: 'device-view__note', textContent: 'Screen destinations' })
	const destAdd = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: '+' })
	const destType = document.createElement('select')
	destHead.append(destTitle, destType, destAdd)
	const destBody = document.createElement('div')
	destBody.className = 'device-view__destinations-body'
	const destLiveHost = document.createElement('div')
	destLiveHost.className = 'device-view__live-sources-host'
	destPanel.append(destHead, destBody, destLiveHost)
	const mappingPanel = document.createElement('div'); mappingPanel.className = 'device-view__mappings-column'
	const rearPanel = document.createElement('div'); rearPanel.className = 'device-view__rear-column'
	const cableOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); cableOverlay.classList.add('device-view__cable-overlay'); cableOverlay.innerHTML = '<g data-cable-lines></g>'
	const edgesHost = document.createElement('div'); edgesHost.className = 'device-view__edges-host'
	const matrixHost = document.createElement('div'); matrixHost.className = 'device-view__matrix-host'; matrixHost.style.display = 'none'
	const inspector = document.createElement('div'); inspector.className = 'device-view__inspector'
	const statusEl = document.createElement('div'); statusEl.className = 'device-view__status'
	const layout = document.createElement('div'); layout.className = 'device-view__layout'
	const side = document.createElement('aside'); side.className = 'device-view__side'; side.append(inspector)
	rearPanel.append(edgesHost)
	layout.append(destPanel, mappingPanel, rearPanel, matrixHost, side); wrap.append(cableOverlay, header, cableRow, Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'Cable mode: connect channels to outputs. Apply Caspar config restarts CasparCG.' }), layout, statusEl); root.append(wrap)

	syncSimpleWiringMode()
	syncMatrixMode()

	let lastPayload = null; let selectedKey = null; let selectedConnectorId = null; let selectedEdgeId = null; let selectedDestinationId = null; let selectedDeviceId = null; let cableSourceId = null; let hoveredEdgeId = null; let casparRestartDirty = false
	let cablePointer = null; let suppressDocCableClickUntil = 0; let currentSettings = null; let streamingStatus = null
	let cableOverlayRafPending = false
	const undoStack = []
	function pushUndo() {
		if (!lastPayload?.graph || !currentSettings?.screenDestinations) return
		undoStack.push({
			graph: JSON.parse(JSON.stringify(lastPayload.graph)),
			screenDestinations: JSON.parse(JSON.stringify(currentSettings.screenDestinations || lastPayload.screenDestinations || { version: 1, destinations: [], edidNotes: '' }))
		})
		if (undoStack.length > 50) undoStack.shift()
	}
	async function undoLastCableAction() {
		if (!undoStack.length) { setStatus(statusEl, 'Nothing to undo', false); return }
		const { graph, screenDestinations } = undoStack.pop()
		try {
			await Actions.saveSettingsPatch({ deviceGraph: graph, screenDestinations })
			setCasparRestartDirty(true)
			await load()
			setStatus(statusEl, 'Undo successful', true)
		} catch (e) { setStatus(statusEl, e.message, false) }
	}
	const gHost = document.getElementById('panel-inspector-scroll') || document.getElementById('panel-inspector-body'); if (gHost) wrap.classList.add('device-view--external-inspector')
	const getCOCtx = () => ({
		cableOverlay,
		bands: rearPanel,
		surfaceEl: wrap,
		lastPayload,
		hoveredEdgeId,
		selectedEdgeId,
		selectedConnectorId,
		selectEdgeById,
		cableSourceId,
		cablePointer,
		messiness: messinessSlider.value,
		simpleWiring: simpleWiringCk.checked,
	})
	const rIntoInsp = (fn) => {
		const h = gHost || inspector
		if (gHost) {
			gHost.classList.add('device-view-inspector-host')
			if (gHost.id === 'panel-inspector-scroll') h.classList.add('panel-inspector__scroll')
		}
		renderPreservingFocus(h, () => {
			h.innerHTML = ''
			fn(h)
		})
		if (h !== inspector) inspector.innerHTML = '<p class="device-view__status">Details in right panel.</p>'
	}

	function setCasparRestartDirty(dirty = true) {
		casparRestartDirty = !!dirty
		applyCasparBtn.classList.toggle('device-view__apply-btn--dirty', casparRestartDirty)
	}

	function selectDevice(devId, live) {
		selectedKey = null; selectedConnectorId = null; selectedEdgeId = null; selectedDestinationId = null; selectedDeviceId = devId
		const dev = (lastPayload?.graph?.devices || []).find(d => d.id === devId)
		rIntoInsp(h => {
			if (devId === CASPAR_HOST) {
				renderCasparSettingsInspector(h, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty })
			} else {
				renderDeviceInspector(h, devId, live, dev, { lastPayload, load, setCasparRestartDirty, statusEl })
			}
		})
	}

	function selectKey(key, ctx) {
		const requestedConnectorId = String(
			ctx?.connectorId ||
				ctx?.connector?.id ||
				(typeof key === 'string' && key.startsWith('conn:') ? key.slice(5) : '') ||
				(typeof key === 'string' && key.startsWith('caspar_overlay:') ? key.split(':')[1] : '') ||
				''
		).trim()
		if (!requestedConnectorId) {
			selectedKey = null
			selectedConnectorId = null
			selectedEdgeId = null
			selectedDeviceId = null
			rIntoInsp((h) =>
				h.append(
					Object.assign(document.createElement('p'), {
						className: 'device-view__status',
						textContent: 'Select a valid connector from the current graph snapshot.',
					})
				)
			)
			updateUI()
			return
		}
		selectedKey = key; selectedConnectorId = requestedConnectorId; selectedEdgeId = null; selectedDestinationId = null; selectedDeviceId = null
		let conn = connectorById(lastPayload, selectedConnectorId)
		if (!conn && ctx?.connector?.isVirtual) {
			conn = ctx.connector
		}
		
		if (!conn) {
			rIntoInsp((h) =>
				h.append(
					Object.assign(document.createElement('p'), {
						className: 'device-view__status',
						textContent: `Connector "${String(selectedConnectorId || '')}" is not available in current graph snapshot.`,
					})
				)
			)
			updateUI()
			return
		}
		rIntoInsp((h) =>
			renderConnectorInspector(h, conn, ctx, {
				lastPayload,
				currentSettings,
				streamingStatus,
				statusEl,
				load,
				setCasparRestartDirty,
				onRemoveStreamOutput: removeStreamOutputConnector,
				onRemoveRecordOutput: removeRecordOutputConnector,
				onRemoveAudioOutput: removeAudioOutputConnector,
				onRemoveVirtualCamOutput: removeVirtualCamOutputConnector,
			})
		)
		updateUI()
	}

	function focusConnectorById(connectorId) {
		const cid = String(connectorId || '').trim(); if (!cid) return
		const conn = connectorById(lastPayload, cid); if (!conn) { void load(); return }
		selectedEdgeId = null; selectedKey = `conn:${cid}`; selectKey(selectedKey, { connectorId: cid, connector: conn, type: conn.kind || 'connector' })
	}

	function selectEdgeById(id) {
		const e = (lastPayload?.graph?.edges || []).find(x => x.id === id); if (!e) return; selectedEdgeId = id; selectedConnectorId = null; selectedKey = null; selectedDestinationId = null; selectedDeviceId = null; rIntoInsp(h => renderEdgeInspector(h, e, removeEdge)); updateUI()
	}

	function selectDestinationById(id) {
		const d = findScreenDestinationById(lastPayload, id)
		if (!d) { selectedDestinationId = null; return }
		selectedDestinationId = id; selectedEdgeId = null; selectedConnectorId = null; selectedKey = null; selectedDeviceId = null
		const mode = String(d.mode || 'pgm_prv')
		const intentItems = Array.isArray(lastPayload?.live?.caspar?.destinationIntent?.items) ? lastPayload.live.caspar.destinationIntent.items : []
		const intent = intentItems.find(x => String(x.id) === String(d.id)) || null
		const sinkConnectorId = resolveDestinationSinkConnectorId(lastPayload, d)
		const graphEdges = Array.isArray(lastPayload?.graph?.edges) ? lastPayload.graph.edges : []
		const graphConnectors = Array.isArray(lastPayload?.graph?.connectors) ? lastPayload.graph.connectors : []
		const suggestedConnectors = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
		const connectorById = new Map([...graphConnectors, ...suggestedConnectors].map(c => [String(c?.id || ''), c]))
		const mappedOutputEdges = graphEdges.filter(e => String(e?.sourceId || '') === String(sinkConnectorId || ''))
		
		rIntoInsp(host => renderDestinationInspector({
			host,
			d,
			mode,
			intent,
			mappedOutputEdges,
			connectorById,
			patchDestination: (did, patch) => Actions.patchDestination(did, patch).then(() => { setCasparRestartDirty(true); return load() }),
			removeDestination: (did) => Actions.removeDestination(did).then(() => { selectedDestinationId = null; setCasparRestartDirty(true); return load() }),
			onHostInputRemoved: async (_dest, removeResult) => {
				selectedDestinationId = null
				selectedConnectorId = null
				selectedKey = null
				setCasparRestartDirty(true)
				try {
					await settingsState.load()
				} catch {
					/* best-effort */
				}
				if (removeResult?.payload) {
					lastPayload = mergeSettingsIntoDeviceViewPayload(
						{ ...lastPayload, ...removeResult.payload },
						settingsState.getSettings?.() || currentSettings,
					)
				}
				rIntoInsp((h) => {
					h.replaceChildren(
						Object.assign(document.createElement('p'), {
							className: 'device-view__status',
							textContent: 'DeckLink input removed.',
						}),
					)
				})
				renderFromState({ restoreInspector: false })
				updateUI()
				await load({ restoreInspector: false })
				setStatus(statusEl, 'DeckLink input removed', true)
			},
			currentSettings,
			updateDestinationOutputLayer,
			lastPayload,
			onWebpageHostApplied: () => {
				if (selectedDestinationId) selectDestinationById(selectedDestinationId)
			},
		}))
		updateUI()
	}

	async function removeEdge(id) { try { pushUndo(); const res = await Actions.removeEdge(id); if (res?.graph) lastPayload.graph = res.graph; if (selectedEdgeId === id) selectedEdgeId = null; load() } catch (e) { setStatus(statusEl, e.message, false) } }

	async function resetCabling() {
		if (!confirm('Are you sure you want to remove ALL cable connections?')) return
		try { pushUndo(); const res = await Actions.removeAllEdges(); if (res?.graph) lastPayload.graph = res.graph; selectedEdgeId = null; setCasparRestartDirty(true); load(); setStatus(statusEl, 'All cabling removed', true) } catch (e) { setStatus(statusEl, e.message, false) }
	}

	function updateUI() {
		for (const el of wrap.querySelectorAll('.device-view__port--selected, .device-view__port--cable-armed, .device-view__connector-target--valid, .device-view__connector-target--invalid, .device-view__simple-node--selected, .device-view__simple-node--armed')) {
			el.classList.remove('device-view__port--selected', 'device-view__port--cable-armed', 'device-view__connector-target--valid', 'device-view__connector-target--invalid', 'device-view__simple-node--selected', 'device-view__simple-node--armed')
		}
		if (selectedKey) wrap.querySelector(`[data-port-key="${selectedKey}"]`)?.classList.add('device-view__port--selected')
		if (selectedConnectorId) {
			const sel = wrap.querySelector(`[data-connector-id="${selectedConnectorId}"]`)
			sel?.classList.add('device-view__port--selected')
			sel?.closest('.device-view__simple-node')?.classList.add('device-view__simple-node--selected')
		}
		if (cableSourceId) {
			const armed = wrap.querySelector(`[data-connector-id="${cableSourceId}"]`)
			armed?.classList.add('device-view__port--cable-armed')
			armed?.closest('.device-view__simple-node')?.classList.add('device-view__simple-node--armed')
			const source = String(cableSourceId)
			for (const el of wrap.querySelectorAll('[data-connector-id]')) {
				const targetId = String(el.getAttribute('data-connector-id') || '').trim(); if (!targetId || targetId === source) continue
				const allowed = !!orderEdgeForDeviceView(source, targetId, (cid) => connectorById(lastPayload, cid))
				el.classList.add(allowed ? 'device-view__connector-target--valid' : 'device-view__connector-target--invalid')
			}
		}
		clearCableBtn.style.display = cableSourceId ? '' : 'none'; renderCableOverlay(getCOCtx())
	}

	function beginOrCompleteCable(k, c, d) {
		if (!c) return
		if (cableSourceId && cableSourceId !== c) { tryAddCable(c); return }
		const conn = connectorById(lastPayload, c); const role = connectorRole(conn)
		if (role !== 'destination_out' && role !== 'caspar_out' && role !== 'pixel_mapping_out') { setStatus(statusEl, 'Cable can start only from destination output or output connector.', false); return }
		selectKey(k, { ...d, connectorId: c }); cableSourceId = c; suppressDocCableClickUntil = Date.now() + 100; updateUI(); setStatus(statusEl, 'Cable armed: click another connector dot to connect', true)
	}

	async function tryAddCable(id) {
		const o = orderEdgeForDeviceView(cableSourceId, id, (cid) => connectorById(lastPayload, cid))
		if (!o) {
			setStatus(statusEl, 'These connectors cannot be cabled together (wrong roles or direction).', false)
			cableSourceId = null
			cablePointer = null
			updateUI()
			return
		}
		const resolved = resolveCableEdgeIds(lastPayload, o.sourceId, o.sinkId)
		const sinkConflict = findGpuSinkCableConflict(lastPayload, resolved.sinkId)
		if (sinkConflict) {
			const sinkLabel = friendlyConnectorLabel(lastPayload, resolved.sinkId)
			const srcLabel = friendlyConnectorLabel(lastPayload, sinkConflict.sourceId)
			const clickedPort = gpuPhysicalPortCableId(id)
			const bracketNote =
				clickedPort &&
				resolved.sinkId &&
				clickedPort === resolved.sinkId &&
				/__/.test(String(id))
					? ' (DP A/B names on the same physical socket share one cable slot)'
					: ''
			setStatus(
				statusEl,
				`${sinkLabel} already has a cable from ${srcLabel}. Remove that cable first.${bracketNote}`,
				false,
			)
			cableSourceId = null
			cablePointer = null
			focusConnectorById(id)
			updateUI()
			return
		}
		try {
			pushUndo()
			const preflight = await Actions.ensureCableConnectorsInSavedGraph(
				lastPayload,
				currentSettings,
				resolved.sourceId,
				resolved.sinkId,
			)
			if (preflight?.graph) lastPayload.graph = preflight.graph
			if (preflight?.fresh) {
				lastPayload = {
					...preflight.fresh,
					gpuPhysicalTopology: lastPayload.gpuPhysicalTopology,
				}
			}
			let res
			try {
				res = await Actions.addCable(resolved.sourceId, resolved.sinkId)
			} catch (firstErr) {
				if (!isUnknownCableConnectorError(firstErr?.message || firstErr)) throw firstErr
				const recovered = await Actions.recoverDeviceGraphForCable(
					lastPayload,
					currentSettings,
					resolved.sourceId,
					resolved.sinkId,
				)
				if (recovered.topology) {
					lastPayload = { ...lastPayload, gpuPhysicalTopology: recovered.topology }
					if (currentSettings) {
						currentSettings = { ...currentSettings, gpuPhysicalTopology: recovered.topology }
					}
				}
				if (recovered.fresh) {
					lastPayload = {
						...recovered.fresh,
						gpuPhysicalTopology: recovered.topology || lastPayload.gpuPhysicalTopology,
					}
				} else if (recovered.graph) {
					lastPayload.graph = recovered.graph
				}
				res = await Actions.addCable(resolved.sourceId, resolved.sinkId)
			}
			if (res?.error) {
				setStatus(
					statusEl,
					`${describeCableRejection(res.error)} (${resolved.sourceId} → ${resolved.sinkId})`,
					false,
				)
				cableSourceId = null
				cablePointer = null
				focusConnectorById(id)
				updateUI()
				return
			}
			if (res?.graph) lastPayload.graph = res.graph
			const sinkConn = connectorById(lastPayload, resolved.sinkId)
			if (sinkConn?.kind === 'gpu_out' && currentSettings) {
				const cs =
					currentSettings.casparServer && typeof currentSettings.casparServer === 'object'
						? currentSettings.casparServer
						: {}
				const screenN = resolveGpuScreenNumber(sinkConn, lastPayload)
				const portN = resolveGpuPhysicalScreenIndex(sinkConn, lastPayload)
				const source = resolveCableSourceResolution(lastPayload, resolved.sourceId)
				const outputBinding = gpuOutputBindingFromCableSource(lastPayload, resolved.sourceId)
				const isMultiviewOutput = outputBinding?.type === 'multiview'
				const settingsPatches = []
				if (shouldSeedScreenConsumerDefaults(cs, portN)) {
					settingsPatches.push(screenConsumerSeedSettingsPatch(cs, portN))
				}
				if (isMultiviewOutput && shouldSeedMultiviewAlwaysOnTopDefault(cs)) {
					settingsPatches.push(multiviewConsumerDefaultsSettingsPatch())
				}
				if (source) {
					settingsPatches.push(gpuScreenInheritedSettingsPatch(screenN, source))
				}
				if (settingsPatches.length) {
					await Actions.saveSettingsPatch(mergeSettingsPatches(...settingsPatches))
				}
				if (source) {
					const connectorPatch = { caspar: { mode: source.videoMode } }
					if (outputBinding) connectorPatch.caspar.outputBinding = outputBinding
					await Actions.updateConnector(resolved.sinkId, connectorPatch)
				}
			}
			cableSourceId = null
			cablePointer = null
			setCasparRestartDirty(true)
			load()
		} catch (e) {
			setStatus(statusEl, cableReasonFromError(e), false)
			cableSourceId = null
			cablePointer = null
			focusConnectorById(id)
			updateUI()
		}
	}

	async function updateDestinationOutputLayer(edgeId, outputLayer) {
		if (!lastPayload?.graph || !edgeId) return
		const g = JSON.parse(JSON.stringify(lastPayload.graph)); const edges = Array.isArray(g.edges) ? g.edges : []
		const idx = edges.findIndex((e) => String(e?.id || '') === String(edgeId)); if (idx < 0) return
		edges[idx].note = JSON.stringify({ outputLayer: Math.max(1, parseInt(String(outputLayer || 1), 10) || 1) }); g.edges = edges
		try { await Actions.saveDeviceGraph(g); setCasparRestartDirty(true); load() } catch (e) { setStatus(statusEl, `Output mapping update failed: ${e.message}`, false) }
	}

	async function setDecklinkAsDestinationOutput(connectorId, destination, intent) {
		if (!connectorId) return
		try {
			const mode = String(destination?.mode || intent?.mode || 'pgm_prv')
			const mainIdx = Number.isFinite(intent?.mainScreenIndex) ? intent.mainScreenIndex : Math.max(0, parseInt(String(destination?.mainScreenIndex ?? 0), 10) || 0)
			const outputBinding = mode === 'multiview' ? { type: 'multiview' } : { type: 'screen', index: Math.max(1, mainIdx + 1) }
			await Actions.updateConnector(connectorId, { caspar: { ioDirection: 'out', outputBinding } })
			setStatus(statusEl, `DeckLink ${connectorId} mapped to destination output`, true); setCasparRestartDirty(true); await load()
		} catch (e) { setStatus(statusEl, e.message, false) }
	}

	async function pruneConnectorFromGraph(connectorId) {
		const cid = String(connectorId || '').trim()
		if (!cid || !lastPayload?.graph) return
		const g = JSON.parse(JSON.stringify(lastPayload.graph))
		g.edges = (Array.isArray(g.edges) ? g.edges : []).filter((e) => String(e.sourceId) !== cid && String(e.sinkId) !== cid)
		g.connectors = (Array.isArray(g.connectors) ? g.connectors : []).filter((c) => String(c?.id) !== cid)
		await Actions.saveDeviceGraph(g)
		if (selectedConnectorId === cid) {
			selectedConnectorId = null
			selectedKey = null
		}
	}

	async function removeStreamOutputConnector(id) {
		const cid = String(id || '').trim()
		if (!cid) return
		try {
			const cur = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : []
			await Actions.saveSettingsPatch({ streamOutputs: cur.filter((s) => String(s?.id) !== cid) })
			await pruneConnectorFromGraph(cid)
			setCasparRestartDirty(true)
			setStatus(statusEl, 'Stream output removed', true)
			await load()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	async function removeRecordOutputConnector(id) {
		const cid = String(id || '').trim()
		if (!cid) return
		try {
			const cur = Array.isArray(currentSettings?.recordOutputs) ? currentSettings.recordOutputs : []
			await Actions.saveSettingsPatch({ recordOutputs: cur.filter((s) => String(s?.id) !== cid) })
			await pruneConnectorFromGraph(cid)
			setCasparRestartDirty(true)
			setStatus(statusEl, 'Record output removed', true)
			await load()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	async function removeAudioOutputConnector(id) {
		const cid = String(id || '').trim()
		if (!cid) return
		try {
			const cur = Array.isArray(currentSettings?.audioOutputs) ? currentSettings.audioOutputs : []
			await Actions.saveSettingsPatch({ audioOutputs: cur.filter((s) => String(s?.id) !== cid) })
			await pruneConnectorFromGraph(cid)
			setCasparRestartDirty(true)
			setStatus(statusEl, 'Audio output removed', true)
			await load()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	async function removeVirtualCamOutputConnector(id) {
		const cid = String(id || 'vcam_1').trim() || 'vcam_1'
		try {
			try {
				await stopVirtualCamera({ persist: false })
			} catch {
				/* best-effort stop before hide */
			}
			await saveVirtualCameraConfig({ showInDeviceView: false, enabled: false }, { persist: true })
			await pruneConnectorFromGraph(cid)
			setStatus(statusEl, 'Virtual camera output removed', true)
			await load()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	window.addEventListener('highascg-device-view-update-payload', (ev) => {
		if (ev.detail?.graph) {
			lastPayload = { ...lastPayload, graph: ev.detail.graph }
			renderFromState()
		}
	})

	function renderEdgesList() {
		edgesHost.innerHTML = ''
		const edges = lastPayload?.graph?.edges || []
		if (!edges.length) return edges
		const b = Object.assign(document.createElement('div'), { className: 'device-view__band' })
		b.append(Object.assign(document.createElement('h3'), { textContent: 'Cables' }))
		const ul = Object.assign(document.createElement('ul'), { className: 'device-view__edge-list' })
		edges.forEach((e) => {
			const li = Object.assign(document.createElement('li'), {
				className: `device-view__edge-item ${selectedEdgeId === e.id ? 'device-view__edge-item--selected' : ''}`,
			})
			li.onmouseenter = () => {
				hoveredEdgeId = e.id
				renderCableOverlay(getCOCtx())
			}
			li.onmouseleave = () => {
				hoveredEdgeId = null
				renderCableOverlay(getCOCtx())
			}
			li.onclick = () => selectEdgeById(e.id)
			li.append(
				Object.assign(document.createElement('span'), {
					textContent: `${friendlyConnectorLabel(lastPayload, e.sourceId)} → ${friendlyConnectorLabel(lastPayload, e.sinkId)} `,
				})
			)
			ul.append(li)
		})
		b.append(ul)
		edgesHost.append(b)
		return edges
	}

	function restoreInspectorSelection(edges) {
		const activeInsp = gHost || inspector
		const hasFocus = activeInsp && activeInsp.querySelector('input:focus, select:focus, textarea:focus')
		if (hasFocus) return
		if (selectedEdgeId) {
			if (edges.some((e) => String(e?.id || '') === String(selectedEdgeId))) selectEdgeById(selectedEdgeId)
			else selectedEdgeId = null
		}
		if (!selectedEdgeId && selectedConnectorId) {
			const conn = connectorById(lastPayload, selectedConnectorId)
			if (conn) selectKey(selectedKey || `conn:${selectedConnectorId}`, { connectorId: selectedConnectorId, connector: conn, type: conn.kind || 'connector' })
			else {
				selectedConnectorId = null
				selectedKey = null
			}
		}
		if (!selectedEdgeId && !selectedConnectorId && selectedDestinationId) selectDestinationById(selectedDestinationId)
		if (!selectedEdgeId && !selectedConnectorId && !selectedDestinationId && selectedDeviceId) {
			const dev = (lastPayload?.graph?.devices || []).find((d) => String(d?.id || '') === String(selectedDeviceId))
			if (dev) selectDevice(selectedDeviceId, lastPayload?.live)
			else selectedDeviceId = null
		}
	}

	let topologyBannerEl = null

	function updateTopologyMismatchBanner() {
		if (!wrap || !lastPayload) return
		const show = gpuTopologyMismatchActive(lastPayload)
		if (!show) {
			if (topologyBannerEl) {
				topologyBannerEl.remove()
				topologyBannerEl = null
			}
			return
		}
		if (!topologyBannerEl) {
			topologyBannerEl = Object.assign(document.createElement('div'), {
				className: 'device-view__gpu-topology-banner device-view__note',
				style: 'background:#432;color:#fc9;padding:6px 10px;margin:4px 0;border-radius:4px',
			})
			wrap.insertBefore(topologyBannerEl, layout)
		}
		topologyBannerEl.textContent =
			'Detected GPU wiring differs from saved layout — open a GPU port in the inspector and use the layout editor to review.'
	}

	function renderFromState({ restoreInspector = false } = {}) {
		if (!lastPayload) return
		populateDestinationTypeSelect(destType, lastPayload)
		updateTopologyMismatchBanner()
		renderDestinations({
			destBody,
			lastPayload,
			highlightDestinationIntent: () => {},
			clearChipHighlights: () => {},
			renderIntoInspector: rIntoInsp,
			selectDestinationById,
			patchDestination: (id, p) => Actions.patchDestination(id, p).then(() => { setCasparRestartDirty(true); return load() }),
			removeDestination: (id) => Actions.removeDestination(id).then(() => { selectedDestinationId = null; setCasparRestartDirty(true); return load() }),
			applyPlan: () => Actions.applyDeviceViewPlan({ applyCaspar: true }).then(() => { setCasparRestartDirty(false); return load() }),
			resolveDestinationSinkConnectorId: (d) => resolveDestinationSinkConnectorId(lastPayload, d),
			cableSourceId,
			onDestinationPortClick: (connectorId) => beginOrCompleteCable('dest:' + connectorId, connectorId, {}),
			onDecklinkDropToDestinationOutput: (connectorId, d, intent) => setDecklinkAsDestinationOutput(connectorId, d, intent),
			updateDestinationOutputLayer,
			requestCableOverlayRender: () => renderCableOverlay(getCOCtx()),
		})
		destLiveHost.innerHTML = ''
		destLiveHost.append(
			renderLiveSourcesBand({
				lastPayload,
				selectedKey,
				onPortClick: selectKey,
				onAddLiveSource: () => openAddLiveSourceModal({ load, statusEl, setStatusFn: setStatus }),
			}),
		)
		if (matrixCk.checked) {
			renderMatrix(matrixHost, lastPayload, pushUndo, setCasparRestartDirty, load, selectKey, selectDestinationById)
		} else {
			renderBands(
				mappingPanel,
				rearPanel,
				{
					live: lastPayload.live,
					lastPayload,
					resolveConnectorId: (t, d) => resolveConnectorId(lastPayload, t, d),
					isConnectorVisible: (id) => isConnectorVisible(lastPayload, id),
					selectedKey,
					cableSourceId,
					onPortClick: selectKey,
					onPortStartCable: beginOrCompleteCable,
					selectDevice,
					selectedConnectorId,
					simpleWiring: simpleWiringCk.checked,
				},
				{ currentSettings, statusEl, load, setCasparRestartDirty }
			)
			rearPanel.append(edgesHost)
		}
		const edges = renderEdgesList()
		if (restoreInspector) restoreInspectorSelection(edges)
		requestAnimationFrame(() => updateUI())
	}

	async function load(opts = {}) {
		try {
			getAppWs()?.send?.({ type: 'device_view_subscribe' })
			let freshGpu = opts.freshGpu === true
			try {
				if (!freshGpu && sessionStorage.getItem(FACTORY_RESET_GPU_LAYOUT_KEY)) {
					freshGpu = true
				}
			} catch {
				/* ignore */
			}
			await settingsState.load().catch(() => {})
			if (!freshGpu) {
				await migrateLegacyGpuLayoutPrefsToServer(Actions.saveGpuPhysicalTopology)
			}
			const cachedStream = getStreamingChannelStatus()
			const [payload, settings, stream] = await Promise.all([
				Actions.loadDeviceView({ freshGpu }),
				Actions.loadSettings(),
				cachedStream
					? Promise.resolve(cachedStream)
					: Actions.getStreamingChannelStatus().catch(() => null),
			])
			if (freshGpu) {
				try {
					sessionStorage.removeItem(FACTORY_RESET_GPU_LAYOUT_KEY)
				} catch {
					/* ignore */
				}
			}
			lastPayload = mergeSettingsIntoDeviceViewPayload(
				{ ...payload, gpuPhysicalTopology: settings?.gpuPhysicalTopology || null },
				settings,
			)
			currentSettings = settings
			streamingStatus = stream
			renderFromState({ restoreInspector: opts.restoreInspector !== false })
			setStatus(statusEl, `Updated ${lastPayload?.live?.host?.collectedAt || ''}`, true)
		} catch (e) { setStatus(statusEl, e.message, false) }
	}
	saveSnapBtn.onclick = () =>
		openSaveDeviceSnapshotModal({
			getRearPanelEl: () => wrap.querySelector('.device-view__backpanel--caspar'),
			onStatus: (msg, ok) => setStatus(statusEl, msg, !!ok),
		})
	loadSnapBtn.onclick = () =>
		openLoadDeviceSnapshotModal({
			onApplied: () => {
				void load()
			},
			onStatus: (msg, ok) => setStatus(statusEl, msg, !!ok),
		})
	refreshBtn.onclick = load
	resetBtn.onclick = resetCabling
	applyCasparBtn.onclick = () =>
		Actions.applyCasparConfig()
			.then((r) => {
				setCasparRestartDirty(false)
				setStatus(statusEl, r.message || 'Caspar config applied', true)
			})
			.catch((e) => setStatus(statusEl, e?.message || String(e), false))
	editCasparBtn.onclick = () =>
		showCasparConfigModal({
			onApplied: () => {
				setCasparRestartDirty(false)
				return load()
			},
		})
	window.onresize = () => renderCableOverlay(getCOCtx())
	clearCableBtn.onclick = () => {
		cableSourceId = null
		cablePointer = null
		updateUI()
		setStatus(statusEl, 'Cable mode cancelled', true)
	}
	destAdd.onclick = () => {
		const rawType = destType.value
		if (String(rawType || '').startsWith('host:')) {
			const hostId = rawType.slice(5)
			const host = listHostChannelDestinations(lastPayload).find((h) => String(h?.id || '') === hostId)
			if (!host) {
				setStatus(statusEl, 'Host channel no longer available — refresh and try again.', false)
				return
			}
			void Actions.addDestination({
				type: 'host_channel',
				id: host.id,
				label: host.label,
				hostRole: host.hostRole,
				casparChannel: host.casparChannel,
				inputSlot: host.inputSlot,
				sourceId: host.sourceId,
			}).then(() => load())
			return
		}
		const list = listPersistedScreenDestinationsFromPayload(lastPayload)
		const highest = Math.max(-1, ...list.map((d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0)))
		const type = rawType
		const newMainIdx = type === 'multiview' ? 0 : highest + 1
		const newScreenN = type === 'multiview' ? 0 : newMainIdx + 1
		void Actions.addDestination({
			type,
			mainScreenIndex: newMainIdx,
			videoMode: defaultVideoModeForProjectFps(resolveProjectFpsFromSettings(currentSettings)),
		}).then(async () => {
			if (newScreenN >= 1 && currentSettings) {
				const cs =
					currentSettings.casparServer && typeof currentSettings.casparServer === 'object'
						? currentSettings.casparServer
						: {}
				if (shouldSeedScreenConsumerDefaults(cs, newScreenN)) {
					await Actions.saveSettingsPatch(screenConsumerSeedSettingsPatch(cs, newScreenN, currentSettings))
				}
			}
			setCasparRestartDirty(true)
			load()
		})
	}
	function listPersistedScreenDestinationsFromPayload(payload) {
		return Array.isArray(payload?.screenDestinations?.destinations) ? payload.screenDestinations.destinations : []
	}
	window.addEventListener('pointermove', (ev) => {
		if (!cableSourceId) return
		const br = wrap.getBoundingClientRect()
		cablePointer = { x: ev.clientX - br.left, y: ev.clientY - br.top }
		if (cableOverlayRafPending) return
		cableOverlayRafPending = true
		requestAnimationFrame(() => {
			cableOverlayRafPending = false
			if (cableSourceId) renderCableOverlay(getCOCtx())
		})
	})
	document.addEventListener('keydown', (ev) => {
		const isZ = ev.key?.toLowerCase() === 'z'; const isUndo = isZ && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey
		if (isUndo) { ev.preventDefault(); ev.stopPropagation(); void undoLastCableAction(); return }
		if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedEdgeId) {
			const target = ev.target; if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
			ev.preventDefault(); ev.stopPropagation(); void removeEdge(selectedEdgeId)
		}
	})
	document.addEventListener('click', (ev) => { if (!cableSourceId || Date.now() < suppressDocCableClickUntil) return; const targetId = connectorIdFromEvent(ev, wrap); if (targetId) { if (targetId !== cableSourceId) { ev.preventDefault(); ev.stopPropagation(); void tryAddCable(targetId) }; return }; cableSourceId = null; cablePointer = null; updateUI(); setStatus(statusEl, 'Cable mode cancelled', true) }, true)
	document.addEventListener('highascg-settings-applied', load); 
	window.addEventListener('highascg-device-view-reload', load);
	window.addEventListener('highascg-device-view-focus-connector', (ev) => { const cid = String(ev?.detail?.connectorId || '').trim(); if (cid) focusConnectorById(cid) }); 
	window.addEventListener('highascg-device-view-focus-device', (ev) => { if (ev.detail?.deviceId) selectDevice(ev.detail.deviceId, lastPayload?.live) });
	window.addEventListener('highascg-device-view-focus-server', () => selectDevice(CASPAR_HOST, lastPayload?.live));
	window.addEventListener('highascg-caspar-restart-dirty', () => setCasparRestartDirty(true))
	syncSimpleWiringMode()
	onTabActivated = () => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => renderCableOverlay(getCOCtx()))
		})
	}
	void load()
	getAppWs()?.send?.({ type: 'device_view_subscribe' })
}
