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
import { setStatus, buildInspectorTable, connectorIdFromEvent } from './device-view-ui-utils.js'
import { renderCableOverlay } from './device-view-cables.js'
import { renderDestinations } from './device-view-destinations-ui.js'
import { renderBands } from './device-view-bands-render.js'
import { renderEdgeInspector } from './device-view-inspector-render.js'
import * as Actions from './device-view-actions.js'
import { SWITCHER_INTEGRATION_DISABLED } from './device-view-switcher-integration-disabled.js'
import { renderConnectorInspector, renderCasparSettingsInspector } from './device-view-inspectors.js'
import { showLogsModal } from './logs-modal.js'

let mounted = false; export function initDeviceView(root) {
	if (!root || mounted) return; mounted = true; root.innerHTML = ''
	const wrap = document.createElement('div'); wrap.className = 'device-view'
	const header = document.createElement('div'); header.className = 'device-view__header'
	const actions = document.createElement('div'); actions.className = 'device-view__actions'
	const refreshBtn = document.createElement('button'); refreshBtn.className = 'header-btn'; refreshBtn.textContent = 'Refresh'
	const resetBtn = document.createElement('button'); resetBtn.className = 'header-btn'; resetBtn.textContent = 'Reset all cabling'
	const applyCasparBtn = document.createElement('button'); applyCasparBtn.className = 'header-btn device-view__apply-btn'; applyCasparBtn.textContent = 'Apply Caspar config (restart)'
	const streamLiveBadge = Object.assign(document.createElement('span'), { className: 'device-view__stream-badge', textContent: 'Str1 ●' })
	streamLiveBadge.style.display = 'none'
	actions.append(streamLiveBadge, refreshBtn, resetBtn, applyCasparBtn); header.append(Object.assign(document.createElement('h2'), { className: 'device-view__title', textContent: 'Devices' }), actions)
	const cableRow = document.createElement('div'); cableRow.className = 'device-view__toolbar'
	const clearCableBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'header-btn', textContent: 'Cancel cable', style: 'display:none' })
	const skipPh = Object.assign(document.createElement('input'), { type: 'checkbox', id: 'device-view-skip-ph' })
	const tandemSync = Object.assign(document.createElement('input'), { type: 'checkbox', id: 'device-view-tandem-sync', checked: true })
	skipPh.checked = SWITCHER_INTEGRATION_DISABLED
	const messinessLabel = Object.assign(document.createElement('label'), { textContent: 'Cable loops: ', style: 'margin-left: 14px; font-size: 11px; opacity: 0.8' })
	const messinessSlider = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '2', value: '0', id: 'cable-messiness', style: 'width: 40px; height: 8px; cursor: pointer;' })
	const messinessVal = Object.assign(document.createElement('span'), { textContent: '0', style: 'margin-left: 6px; font-size: 11px; font-weight: 600;' })
	messinessSlider.oninput = () => { messinessVal.textContent = messinessSlider.value; updateUI() }
	cableRow.append(clearCableBtn, messinessLabel, messinessSlider, messinessVal)
	const destPanel = document.createElement('div'); destPanel.className = 'device-view__destinations'
	const destHead = document.createElement('div'); destHead.className = 'device-view__destinations-head'
	const destTitle = Object.assign(document.createElement('span'), { className: 'device-view__note', textContent: 'Screen destinations' })
	const destAdd = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: '+' }); const destType = document.createElement('select'); destType.innerHTML = '<option value="pgm_prv">PGM/PRV</option><option value="pgm_only">PGM only</option><option value="multiview">Multiview</option>'
	destHead.append(destTitle, destType, destAdd); const destBody = document.createElement('div'); destBody.className = 'device-view__destinations-body'; destPanel.append(destHead, destBody)
	const bands = document.createElement('div'); bands.className = 'device-view__bands'
	const cableOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); cableOverlay.classList.add('device-view__cable-overlay'); cableOverlay.innerHTML = '<g data-cable-lines></g>'
	const edgesHost = document.createElement('div'); edgesHost.className = 'device-view__edges-host'
	const inspector = document.createElement('div'); inspector.className = 'device-view__inspector'
	const statusEl = document.createElement('div'); statusEl.className = 'device-view__status'
	const layout = document.createElement('div'); layout.className = 'device-view__layout'
	const main = document.createElement('div'); main.className = 'device-view__main'; main.append(bands, edgesHost)
	const side = document.createElement('aside'); side.className = 'device-view__side'; side.append(inspector)
	layout.append(main, side); wrap.append(cableOverlay, header, cableRow, Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'Cable mode: connect channels to outputs. Apply Caspar config restarts CasparCG.' }), destPanel, layout, statusEl); root.append(wrap)

	let lastPayload = null; let selectedKey = null; let selectedConnectorId = null; let selectedEdgeId = null; let cableSourceId = null; let hoveredEdgeId = null; let casparRestartDirty = false
	let cablePointer = null; let suppressDocCableClickUntil = 0; let currentSettings = null; let streamingStatus = null
	const undoStack = []
	function pushUndo() {
		if (!lastPayload?.graph || !currentSettings?.tandemTopology) return
		undoStack.push({
			graph: JSON.parse(JSON.stringify(lastPayload.graph)),
			tandemTopology: JSON.parse(JSON.stringify(currentSettings.tandemTopology || lastPayload.tandemTopology || { destinations: [], signalPaths: [] }))
		})
		if (undoStack.length > 50) undoStack.shift()
	}
	async function undoLastCableAction() {
		if (!undoStack.length) { setStatus(statusEl, 'Nothing to undo', false); return }
		const { graph, tandemTopology } = undoStack.pop()
		try {
			await Actions.saveSettingsPatch({ deviceGraph: graph, tandemTopology })
			setCasparRestartDirty(true)
			await load()
			setStatus(statusEl, 'Undo successful', true)
		} catch (e) { setStatus(statusEl, e.message, false) }
	}
	const gHost = document.getElementById('panel-inspector-scroll') || document.getElementById('panel-inspector-body'); if (gHost) wrap.classList.add('device-view--external-inspector')
	const getCOCtx = () => ({ cableOverlay, bands, surfaceEl: wrap, lastPayload, hoveredEdgeId, selectedEdgeId, selectedConnectorId, selectEdgeById, cableSourceId, cablePointer, messiness: messinessSlider.value })
	const rIntoInsp = (fn) => { const h = gHost || inspector; h.innerHTML = ''; fn(h); if (h !== inspector) inspector.innerHTML = '<p class="device-view__status">Details in right panel.</p>' }

	function setCasparRestartDirty(dirty = true) {
		casparRestartDirty = !!dirty
		applyCasparBtn.classList.toggle('device-view__apply-btn--dirty', casparRestartDirty)
	}

	function selectDevice(devId, live) {
		selectedKey = null; selectedConnectorId = null; selectedEdgeId = null; const dev = (lastPayload?.graph?.devices || []).find(d => d.id === devId)
		rIntoInsp(h => {
			if (devId === CASPAR_HOST) {
				renderCasparSettingsInspector(h, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty, showSettingsModal })
			} else {
				renderDeviceInspector(h, devId, live, dev)
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
		selectedKey = key; selectedConnectorId = requestedConnectorId; selectedEdgeId = null
		const conn = connectorById(lastPayload, selectedConnectorId)
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
				skipPh: skipPh.checked,
				statusEl,
				load,
				setCasparRestartDirty,
				onRemoveStreamOutput: removeStreamOutputConnector,
				onRemoveRecordOutput: removeRecordOutputConnector,
				onRemoveAudioOutput: removeAudioOutputConnector,
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
		const e = (lastPayload?.graph?.edges || []).find(x => x.id === id); if (!e) return; selectedEdgeId = id; selectedConnectorId = null; selectedKey = null; rIntoInsp(h => renderEdgeInspector(h, e, removeEdge)); updateUI()
	}

	async function removeEdge(id) { try { pushUndo(); const res = await Actions.removeEdge(id, tandemSync.checked); if (res?.graph) lastPayload.graph = res.graph; if (selectedEdgeId === id) selectedEdgeId = null; load() } catch (e) { setStatus(statusEl, e.message, false) } }

	async function resetCabling() {
		if (!confirm('Are you sure you want to remove ALL cable connections?')) return
		try { pushUndo(); const res = await Actions.removeAllEdges(tandemSync.checked); if (res?.graph) lastPayload.graph = res.graph; selectedEdgeId = null; setCasparRestartDirty(true); load(); setStatus(statusEl, 'All cabling removed', true) } catch (e) { setStatus(statusEl, e.message, false) }
	}

	function updateUI() {
		for (const el of wrap.querySelectorAll('.device-view__port--selected, .device-view__port--cable-armed, .device-view__connector-target--valid, .device-view__connector-target--invalid')) el.classList.remove('device-view__port--selected', 'device-view__port--cable-armed', 'device-view__connector-target--valid', 'device-view__connector-target--invalid')
		if (selectedKey) bands.querySelector(`[data-port-key="${selectedKey}"]`)?.classList.add('device-view__port--selected')
		if (selectedConnectorId) wrap.querySelector(`[data-connector-id="${selectedConnectorId}"]`)?.classList.add('device-view__port--selected')
		if (cableSourceId) {
			wrap.querySelector(`[data-connector-id="${cableSourceId}"]`)?.classList.add('device-view__port--cable-armed')
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
		if (role !== 'destination_out' && role !== 'caspar_out') { setStatus(statusEl, 'Cable can start only from destination output or output connector.', false); return }
		selectKey(k, { ...d, connectorId: c }); cableSourceId = c; suppressDocCableClickUntil = Date.now() + 100; updateUI(); setStatus(statusEl, 'Cable armed: click another connector dot to connect', true)
	}

	async function tryAddCable(id) {
		const o = orderEdgeForDeviceView(cableSourceId, id, (cid) => connectorById(lastPayload, cid))
		if (!o) { setStatus(statusEl, 'Invalid connection', false); cableSourceId = null; cablePointer = null; updateUI(); return }
		try {
			pushUndo()
			const res = await Actions.addCable(o.sourceId, o.sinkId, skipPh.checked, tandemSync.checked)
			if (res?.error) { setStatus(statusEl, `Cable rejected: ${res.error}`, false); cableSourceId = null; cablePointer = null; updateUI(); return }
			if (res?.graph) lastPayload.graph = res.graph; cableSourceId = null; cablePointer = null; setCasparRestartDirty(true); load()
		} catch (e) { setStatus(statusEl, e.message, false) }
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
			await Actions.updateConnector(connectorId, { caspar: { ioDirection: 'out', outputBinding } }, skipPh.checked)
			setStatus(statusEl, `DeckLink ${connectorId} mapped to destination output`, true); setCasparRestartDirty(true); await load()
		} catch (e) { setStatus(statusEl, e.message, false) }
	}

	async function persistDestinationLayout(layoutPatch) {
		const graph = lastPayload?.graph ? JSON.parse(JSON.stringify(lastPayload.graph)) : null; if (!graph || typeof graph !== 'object') return
		graph.layout = layoutPatch && typeof layoutPatch === 'object' ? { ...layoutPatch } : {}; try { const res = await Actions.saveDeviceGraph(graph); if (res?.graph) lastPayload.graph = res.graph } catch (e) { setStatus(statusEl, `Destination layout save failed: ${e.message}`, false) }
	}

	async function resetDestinationLayout() { await persistDestinationLayout({}); setStatus(statusEl, 'Destination layout reset', true); await load() }

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

	async function load() {
		try {
			const [payload, settings, stream] = await Promise.all([Actions.loadDeviceView(skipPh.checked), Actions.loadSettings(), Actions.getStreamingChannelStatus().catch(() => null)])
			lastPayload = payload; currentSettings = settings; streamingStatus = stream; streamLiveBadge.style.display = streamingStatus?.rtmp?.active ? '' : 'none'
			renderDestinations({ destBody, lastPayload, highlightDestinationIntent: () => {}, clearChipHighlights: () => {}, renderIntoInspector: rIntoInsp, patchDestination: (id, p) => Actions.patchDestination(id, p).then(() => { setCasparRestartDirty(true); return load() }), removeDestination: (id) => Actions.removeDestination(id).then(() => { setCasparRestartDirty(true); return load() }), applyPlan: () => Actions.applyDeviceViewPlan({ applyCaspar: true, applyPixelhue: false }).then(() => { setCasparRestartDirty(false); return load() }), resolveDestinationSinkConnectorId: (d) => resolveDestinationSinkConnectorId(lastPayload, d), cableSourceId, onDestinationPortClick: (connectorId) => beginOrCompleteCable('dest:' + connectorId, connectorId, {}), onDecklinkDropToDestinationOutput: (connectorId, d, intent) => setDecklinkAsDestinationOutput(connectorId, d, intent), updateDestinationOutputLayer, persistDestinationLayout, resetDestinationLayout, requestCableOverlayRender: () => renderCableOverlay(getCOCtx()) })
			renderBands(bands, { live: lastPayload.live, lastPayload, resolveConnectorId: (t, d) => resolveConnectorId(lastPayload, t, d), isConnectorVisible: (id) => isConnectorVisible(lastPayload, id), selectedKey, cableSourceId, onPortClick: selectKey, onPortStartCable: beginOrCompleteCable, selectDevice, selectedConnectorId }, { currentSettings, statusEl, load })
			edgesHost.innerHTML = ''; const edges = lastPayload?.graph?.edges || []; if (edges.length) { const b = Object.assign(document.createElement('div'), { className: 'device-view__band' }); b.append(Object.assign(document.createElement('h3'), { textContent: 'Cables' })); const ul = Object.assign(document.createElement('ul'), { className: 'device-view__edge-list' }); edges.forEach(e => { const li = Object.assign(document.createElement('li'), { className: `device-view__edge-item ${selectedEdgeId === e.id ? 'device-view__edge-item--selected' : ''}` }); li.onmouseenter = () => { hoveredEdgeId = e.id; renderCableOverlay(getCOCtx()) }; li.onmouseleave = () => { hoveredEdgeId = null; renderCableOverlay(getCOCtx()) }; li.onclick = () => selectEdgeById(e.id); li.append(Object.assign(document.createElement('span'), { textContent: `${friendlyConnectorLabel(lastPayload, e.sourceId)} → ${friendlyConnectorLabel(lastPayload, e.sinkId)} ` })); ul.append(li) }); b.append(ul); edgesHost.append(b) }
			if (selectedEdgeId) { if (edges.some((e) => String(e?.id || '') === String(selectedEdgeId))) selectEdgeById(selectedEdgeId); else selectedEdgeId = null }
			if (!selectedEdgeId && selectedConnectorId) { const conn = connectorById(lastPayload, selectedConnectorId); if (conn) selectKey(selectedKey || `conn:${selectedConnectorId}`, { connectorId: selectedConnectorId, connector: conn, type: conn.kind || 'connector' }); else { selectedConnectorId = null; selectedKey = null } }
			setStatus(statusEl, `Updated ${lastPayload?.live?.host?.collectedAt || ''}`, true)
			// Ensure cables and highlights are rendered after the DOM has been populated and laid out
			requestAnimationFrame(() => updateUI())
		} catch (e) { setStatus(statusEl, e.message, false) }
	}
	refreshBtn.onclick = load; resetBtn.onclick = resetCabling; applyCasparBtn.onclick = () => Actions.applyCasparConfig().then(r => { setCasparRestartDirty(false); setStatus(statusEl, r.message, true) }); window.onresize = () => renderCableOverlay(getCOCtx()); clearCableBtn.onclick = () => { cableSourceId = null; cablePointer = null; updateUI(); setStatus(statusEl, 'Cable mode cancelled', true) }
	destAdd.onclick = () => { const list = Array.isArray(lastPayload?.tandemTopology?.destinations) ? lastPayload.tandemTopology.destinations : []; const highest = Math.max(-1, ...list.map((d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0))); Actions.addDestination({ type: destType.value, mainScreenIndex: destType.value === 'multiview' ? 0 : highest + 1 }).then(() => { setCasparRestartDirty(true); load() }) }
	window.addEventListener('pointermove', (ev) => { if (cableSourceId) { const br = wrap.getBoundingClientRect(); cablePointer = { x: ev.clientX - br.left, y: ev.clientY - br.top }; renderCableOverlay(getCOCtx()) } })
	document.addEventListener('keydown', (ev) => {
		const isZ = ev.key?.toLowerCase() === 'z'; const isUndo = isZ && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey
		if (isUndo) { ev.preventDefault(); ev.stopPropagation(); void undoLastCableAction(); return }
		if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedEdgeId) {
			const target = ev.target; if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
			ev.preventDefault(); ev.stopPropagation(); void removeEdge(selectedEdgeId)
		}
	})
	document.addEventListener('click', (ev) => { if (!cableSourceId || Date.now() < suppressDocCableClickUntil) return; const targetId = connectorIdFromEvent(ev); if (targetId) { if (targetId !== cableSourceId) { ev.preventDefault(); ev.stopPropagation(); void tryAddCable(targetId) }; return }; cableSourceId = null; cablePointer = null; updateUI(); setStatus(statusEl, 'Cable mode cancelled', true) }, true)
	document.addEventListener('highascg-settings-applied', load); window.addEventListener('highascg-device-view-focus-connector', (ev) => { const cid = String(ev?.detail?.connectorId || '').trim(); if (cid) focusConnectorById(cid) }); void load()
}
