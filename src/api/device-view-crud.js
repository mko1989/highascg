/**
 * CRUD operations for Device View (destinations, edges, connectors).
 */
'use strict'

const { normalizeDeviceGraph, validateDeviceGraph, ensureConnectorsFromSuggested, addEdgeToGraph, removeEdgeById, mergeHardwareSync } = require('../config/device-graph')
const { normalizeTandemTopology } = require('../config/tandem-topology')
const { upsertTandemPathFromCableConnectors, removeTandemPathForCableConnectors, buildTandemPathIdForCable } = require('../config/tandem-from-device-cable')

function saveConfig(ctx, patch) {
	if (!ctx.configManager) {
		if (typeof ctx.log === 'function') ctx.log('warn', '[device-view] configManager missing; graph/tandem changes are not persisted to disk')
		Object.assign(ctx.config, patch)
		return true
	}
	return ctx.configManager.save({ ...ctx.configManager.get(), ...patch })
}

function handleAddDestination(j, ctx) {
	const top = normalizeTandemTopology(ctx.config?.tandemTopology); const now = Date.now().toString(36)
	let seq = 1; while (top.destinations.some(d => d.id === `dst_${now}_${seq}`)) seq++
	const id = `dst_${now}_${seq}`; const nextMain = Math.max(0, parseInt(j.addDestination.mainScreenIndex, 10) || 0)
	const reqType = String(j.addDestination.type || 'pgm_prv')
	const mode =
		reqType === 'pgm_only'
			? 'pgm_only'
			: reqType === 'multiview'
				? 'multiview'
				: reqType === 'stream'
					? 'stream'
					: 'pgm_prv'
	const mvCount = top.destinations.filter(d => d.mode === 'multiview').length
	const streamCount = top.destinations.filter(d => d.mode === 'stream').length
	const defaultLabel =
		mode === 'multiview'
			? `Multiview ${mvCount + 1}`
			: mode === 'stream'
				? `Stream ${streamCount + 1}`
				: mode === 'pgm_only'
					? `PGM ${nextMain + 1}`
					: `PGM/PRV ${nextMain + 1}`
	top.destinations.push({ id, label: String(j.addDestination.label || '').trim() || defaultLabel, mainScreenIndex: nextMain, caspar: { bus: 'pgm' }, pixelhue: { layerId: null, screenGuid: '', role: 'caspar_pgm' }, signalPathId: '', edidLabel: '', mode, videoMode: String(j.addDestination.videoMode || '1080p5000'), width: Math.max(64, j.addDestination.width || 1920), height: Math.max(64, j.addDestination.height || 1080), fps: Math.max(1, j.addDestination.fps || 50), stream: { type: 'rtmp', source: 'program_1', url: '', key: '', quality: 'medium' } })
	ctx.config.tandemTopology = top; saveConfig(ctx, { tandemTopology: top })
	return { ok: true, tandemTopology: top, addedId: id }
}

function handleUpdateDestination(j, ctx) {
	const id = String(j.updateDestination.id); const top = normalizeTandemTopology(ctx.config?.tandemTopology)
	const idx = top.destinations.findIndex(d => d.id === id); if (idx < 0) return { error: 'Not found', id }
	const d0 = top.destinations[idx]; const p = j.updateDestination
	const nextMode = p.mode === 'pgm_only' || p.mode === 'pgm_prv' || p.mode === 'multiview' || p.mode === 'stream' ? p.mode : d0.mode
	top.destinations[idx] = {
		...d0,
		label: p.label != null ? String(p.label).trim() || d0.label : d0.label,
		mainScreenIndex: p.mainScreenIndex != null ? Math.max(0, parseInt(p.mainScreenIndex, 10) || 0) : d0.mainScreenIndex,
		videoMode: p.videoMode || d0.videoMode,
		width: p.width || d0.width,
		height: p.height || d0.height,
		fps: p.fps || d0.fps,
		mode: nextMode,
		stream:
			p.stream && typeof p.stream === 'object'
				? {
					...(d0.stream || { type: 'rtmp', url: '', key: '', quality: 'medium' }),
					type: String(p.stream.type || (d0.stream && d0.stream.type) || 'rtmp') === 'ndi' ? 'ndi' : 'rtmp',
					source: p.stream.source != null ? String(p.stream.source) : String(d0.stream?.source || 'program_1'),
					url: p.stream.url != null ? String(p.stream.url) : String(d0.stream?.url || ''),
					key: p.stream.key != null ? String(p.stream.key) : String(d0.stream?.key || ''),
					quality: p.stream.quality != null ? String(p.stream.quality) : String(d0.stream?.quality || 'medium'),
				}
				: (d0.stream || { type: 'rtmp', source: 'program_1', url: '', key: '', quality: 'medium' }),
	}
	ctx.config.tandemTopology = top; saveConfig(ctx, { tandemTopology: top })
	return { ok: true, tandemTopology: top, updatedId: id }
}

function handleRemoveDestination(j, ctx) {
	const id = String(j.removeDestination.id); const top = normalizeTandemTopology(ctx.config?.tandemTopology)
	const before = top.destinations.length; top.destinations = top.destinations.filter(d => d.id !== id)
	if (top.destinations.length === before) return { error: 'Not found', id }
	ctx.config.tandemTopology = top; saveConfig(ctx, { tandemTopology: top })
	return { ok: true, tandemTopology: top, removedId: id }
}

function handleAddEdge(j, ctx, liveSnapshot) {
	const suggested = require('../config/device-graph').suggestConnectorsAndDevicesFromLive(liveSnapshot, ctx.config || {})
	const sid = String(j.addEdge.sourceId), tid = String(j.addEdge.sinkId)
	const merged = ensureConnectorsFromSuggested(ctx.config?.deviceGraph, [sid, tid], suggested)
	const res = addEdgeToGraph(merged, sid, tid); if (!res.ok) return { error: res.reason }
	let nextTandem = normalizeTandemTopology(ctx.config?.tandemTopology)
	if (j.tandemSync !== false) nextTandem = upsertTandemPathFromCableConnectors(nextTandem, res.graph, sid, tid)
	ctx.config.deviceGraph = res.graph; ctx.config.tandemTopology = nextTandem
	saveConfig(ctx, { deviceGraph: res.graph, tandemTopology: nextTandem })
	const byConn = new Map((res.graph.connectors || []).map(c => [c.id, c]))
	if (typeof ctx.augmentGraphWithSources === 'function') ctx.augmentGraphWithSources(res.graph, liveSnapshot)
	return { ok: true, graph: res.graph, tandemPathId: buildTandemPathIdForCable(byConn.get(sid), byConn.get(tid)) }
}

function handleRemoveEdge(j, ctx) {
	const g0 = normalizeDeviceGraph(ctx.config?.deviceGraph); const eid = String(j.removeEdge.id)
	const edge = (g0.edges || []).find(e => e.id === eid); let nextTandem = normalizeTandemTopology(ctx.config?.tandemTopology)
	if (edge && j.tandemSync !== false) nextTandem = removeTandemPathForCableConnectors(nextTandem, g0, edge.sourceId, edge.sinkId)
	const next = removeEdgeById(g0, eid); ctx.config.deviceGraph = next; ctx.config.tandemTopology = nextTandem
	saveConfig(ctx, { deviceGraph: next, tandemTopology: nextTandem })
	if (typeof ctx.augmentGraphWithSources === 'function') {
		const Snapshot = require('./device-view-snapshot')
		Snapshot.buildLiveSnapshot(ctx, j.pixelhue !== false).then(live => ctx.augmentGraphWithSources(next, live)).catch(() => {})
	}
	return { ok: true, graph: next }
}

function handleUpdateConnector(j, ctx, liveSnapshot) {
	const id = String(j.updateConnector?.id || '').trim()
	if (!id) return { error: 'Missing connector id' }
	const suggested = require('../config/device-graph').suggestConnectorsAndDevicesFromLive(liveSnapshot, ctx.config || {})
	// Keep the full hardware connector set stable when editing one connector.
	// Device View is the source of truth, so single-port edits must not collapse the graph.
	const merged = mergeHardwareSync(ctx.config?.deviceGraph, suggested)
	const idx = (merged.connectors || []).findIndex((c) => String(c?.id || '') === id)
	if (idx < 0) return { error: 'Connector not found', id }
	const c0 = merged.connectors[idx]
	const patch = j.updateConnector?.patch && typeof j.updateConnector.patch === 'object' ? j.updateConnector.patch : {}
	let c1 = { ...c0 }
	if (patch.label != null) c1.label = String(patch.label).trim() || c0.label
	if (patch.caspar && typeof patch.caspar === 'object') c1.caspar = { ...(c0.caspar || {}), ...patch.caspar }
	if (c0.kind === 'decklink_io') {
		const dirRaw = String(c1?.caspar?.ioDirection || 'in').toLowerCase()
		const ioDirection = dirRaw === 'out' ? 'out' : 'in'
		c1.caspar = { ...(c1.caspar || {}), ioDirection }
		const m = id.match(/^dlsdi_(\d+)$/)
		if (m) {
			const slot = parseInt(m[1], 10)
			if (Number.isFinite(slot) && slot > 0) {
				const cs = { ...(ctx.config.casparServer || {}) }
				const currentCount = Math.min(8, Math.max(0, parseInt(String(cs.decklink_input_count ?? 0), 10) || 0))
				const devNumRaw = parseInt(String(c1?.externalRef ?? c0?.externalRef ?? 0), 10)
				const devNum = Number.isFinite(devNumRaw) && devNumRaw > 0 ? devNumRaw : slot
				cs[`decklink_input_${slot}_direction`] = ioDirection
				if (ioDirection === 'in') {
					cs.decklink_input_count = Math.max(currentCount, slot)
					if ((parseInt(String(cs[`decklink_input_${slot}_device`] ?? 0), 10) || 0) <= 0) {
						cs[`decklink_input_${slot}_device`] = devNum
					}
				}
				const outBind = patch?.caspar?.outputBinding
				if (ioDirection === 'out' && outBind && typeof outBind === 'object') {
					const t = String(outBind.type || '').toLowerCase()
					if (t === 'multiview') {
						cs.multiview_decklink_device = devNum
					} else if (t === 'screen') {
						const screen = Math.min(4, Math.max(1, parseInt(String(outBind.index ?? 1), 10) || 1))
						cs[`screen_${screen}_decklink_device`] = devNum
						cs[`screen_${screen}_decklink_replace_screen`] = true
					}
				}
				ctx.config.casparServer = cs
			}
		}
	}
	const next = { ...merged, connectors: [...merged.connectors] }
	next.connectors[idx] = c1
	ctx.config.deviceGraph = normalizeDeviceGraph(next)
	saveConfig(ctx, { deviceGraph: ctx.config.deviceGraph, ...(ctx.config.casparServer ? { casparServer: ctx.config.casparServer } : {}) })
	if (typeof ctx.augmentGraphWithSources === 'function') ctx.augmentGraphWithSources(ctx.config.deviceGraph, liveSnapshot)
	return { ok: true, graph: ctx.config.deviceGraph, updatedConnectorId: id }
}

function handleRemoveAllEdges(j, ctx) {
	const g0 = normalizeDeviceGraph(ctx.config?.deviceGraph)
	const nextTandem = normalizeTandemTopology(ctx.config?.tandemTopology)
	if (j.tandemSync !== false) {
		// Filter out signal paths created from cables (starting with dv_)
		nextTandem.signalPaths = (nextTandem.signalPaths || []).filter((p) => !p?.id || !String(p.id).startsWith('dv_'))
	}
	const next = { ...g0, edges: [] }
	ctx.config.deviceGraph = next
	ctx.config.tandemTopology = nextTandem
	saveConfig(ctx, { deviceGraph: next, tandemTopology: nextTandem })
	return { ok: true, graph: next }
}

function handleAddMappingNode(j, ctx) {
	const g0 = normalizeDeviceGraph(ctx.config?.deviceGraph)
	const now = Date.now().toString(36)
	let seq = 1; while (g0.devices.some(d => d.id === `mapping_${now}_${seq}`)) seq++
	const id = `mapping_${now}_${seq}`
	const label = `Pixel Mapping ${seq}`
	
	const newDevice = {
		id,
		role: 'pixel_mapping',
		label,
		settings: {
			numOutputs: 2,
			outputs: [
				{ id: 'out_1', mode: '1080p50', label: 'Output 1' },
				{ id: 'out_2', mode: '1080p50', label: 'Output 2' }
			],
			mappings: []
		}
	}
	
	const newConnectors = [
		{ id: `${id}_in`, deviceId: id, kind: 'pixel_map_in', label: 'Input Feed' },
		{ id: `${id}_out_1`, deviceId: id, kind: 'pixel_map_out', index: 0, label: 'Output 1' },
		{ id: `${id}_out_2`, deviceId: id, kind: 'pixel_map_out', index: 1, label: 'Output 2' }
	]
	
	const next = {
		...g0,
		devices: [...g0.devices, newDevice],
		connectors: [...g0.connectors, ...newConnectors]
	}
	
	const norm = normalizeDeviceGraph(next)
	ctx.config.deviceGraph = norm
	saveConfig(ctx, { deviceGraph: norm })
	return { ok: true, graph: norm, addedId: id }
}

module.exports = { handleAddDestination, handleUpdateDestination, handleRemoveDestination, handleAddEdge, handleRemoveEdge, handleUpdateConnector, handleRemoveAllEdges, handleAddMappingNode }
