/**
 * CRUD operations for Device View (destinations, edges, connectors).
 */
'use strict'

const { normalizeDeviceGraph, validateDeviceGraph, ensureConnectorsFromSuggested, addEdgeToGraph, removeEdgeById, mergeHardwareSync, pruneDestinationFromGraph } = require('../config/device-graph')
const { normalizeScreenDestinations, destinationsFromConfig } = require('../config/screen-destinations')
const { getDestinationOutputWiring } = require('../config/device-graph-destination-wiring')
const { resolveProjectFps, defaultVideoModeForProjectFps } = require('../config/project-fps')
const { STANDARD_VIDEO_MODES } = require('../config/config-modes')
const {
	parseDecklinkDeviceIndex,
	normalizeDecklinkKeyer,
	readDecklinkKeyFillFromConnectorCaspar,
	writeDecklinkKeyFillToCasparServer,
} = require('../config/decklink-key-fill')
const { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } = require('../config/decklink-io-direction')
const { clearDecklinkInputSlot } = require('./device-view-decklink-wiring')

function saveConfig(ctx, patch) {
	if (!ctx.configManager) {
		if (typeof ctx.log === 'function') ctx.log('warn', '[device-view] configManager missing; graph/destination changes are not persisted to disk')
		Object.assign(ctx.config, patch)
	} else {
		ctx.configManager.save({ ...ctx.configManager.get(), ...patch })
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}
	try {
		const { onDeviceConfigSaved } = require('../replication/follower-machine-profile')
		onDeviceConfigSaved(ctx, patch)
	} catch {
		/* optional */
	}
	return true
}

function scheduleDeviceViewCasparSyncIfNeeded(ctx) {
	try {
		const { scheduleDeviceViewCasparSync } = require('./device-view-decklink-wiring')
		scheduleDeviceViewCasparSync(ctx)
	} catch {
		/* optional */
	}
}

function handleAddDestination(j, ctx) {
	const top = normalizeScreenDestinations(ctx.config?.screenDestinations)
	const now = Date.now().toString(36)
	let seq = 1; while (top.destinations.some(d => d.id === `dst_${now}_${seq}`)) seq++
	const reqType = String(j.addDestination.type || 'pgm_prv')

	if (reqType === 'host_channel' || j.addDestination.hostRole) {
		const presetId = String(j.addDestination.id || '').trim()
		const hostRole = String(j.addDestination.hostRole || '').trim()
		const casparChannel = parseInt(String(j.addDestination.casparChannel ?? ''), 10)
		if (!hostRole || !Number.isFinite(casparChannel) || casparChannel < 1) {
			return { error: 'host_channel requires hostRole and casparChannel' }
		}
		const id = presetId || `host_${hostRole}_${casparChannel}`
		if (top.destinations.some((d) => String(d?.id || '') === id)) {
			return { error: 'Host channel already added', id }
		}
		const inputSlot = parseInt(String(j.addDestination.inputSlot ?? ''), 10)
		top.destinations.push({
			id,
			label: String(j.addDestination.label || '').trim() || id,
			mode: 'host_channel',
			hostRole,
			casparChannel,
			virtual: true,
			mainScreenIndex: 0,
			caspar: { bus: 'pgm' },
			...(Number.isFinite(inputSlot) && inputSlot >= 1 ? { inputSlot } : {}),
			...(j.addDestination.sourceId ? { sourceId: String(j.addDestination.sourceId) } : {}),
		})
		const next = normalizeScreenDestinations(top)
		ctx.config.screenDestinations = next
		saveConfig(ctx, { screenDestinations: next })
		return { ok: true, screenDestinations: next, addedId: id }
	}

	const id = `dst_${now}_${seq}`; const nextMain = Math.max(0, parseInt(j.addDestination.mainScreenIndex, 10) || 0)
	const mode =
		reqType === 'pgm_only'
			? 'pgm_only'
			: reqType === 'multiview'
				? 'multiview'
				: reqType === 'stream'
					? 'stream'
					: reqType === 'pixelmap'
						? 'pixelmap'
						: reqType === 'operator_gui'
							? 'operator_gui'
							: 'pgm_prv'
	// WO-243: at most one operator_gui destination — there is only one operator monitor / CEF web-UI.
	if (mode === 'operator_gui' && top.destinations.some((d) => d.mode === 'operator_gui')) {
		return { error: 'At most one Operator GUI destination is allowed' }
	}
	const mvCount = top.destinations.filter(d => d.mode === 'multiview').length
	const streamCount = top.destinations.filter(d => d.mode === 'stream').length
	const pixelmapCount = top.destinations.filter(d => d.mode === 'pixelmap').length
	const defaultLabel =
		mode === 'multiview'
			? `Multiview ${mvCount + 1}`
			: mode === 'stream'
				? `Stream ${streamCount + 1}`
				: mode === 'pgm_only'
					? `PGM ${nextMain + 1}`
					: mode === 'pixelmap'
						? `Pixel Map ${pixelmapCount + 1}`
						: mode === 'operator_gui'
							? 'Operator GUI'
							: `PGM/PRV ${nextMain + 1}`
	const projectFps = resolveProjectFps(ctx.config)
	const defaultMode = defaultVideoModeForProjectFps(projectFps)
	const std = STANDARD_VIDEO_MODES[defaultMode] || STANDARD_VIDEO_MODES['1080p5000']
	// WO-242/WO-243: pixelmap and operator_gui screens default to a raster-exact custom mode (see
	// normalizeDestination) unless the operator explicitly requests a standard videoMode.
	const isCustomByDefault = mode === 'pixelmap' || mode === 'operator_gui'
	const reqVideoMode = String(j.addDestination.videoMode || (isCustomByDefault ? 'custom' : defaultMode)).trim() || defaultMode
	const reqStd = STANDARD_VIDEO_MODES[reqVideoMode] || std
	top.destinations.push({
		id,
		label: String(j.addDestination.label || '').trim() || defaultLabel,
		mainScreenIndex: nextMain,
		caspar: { bus: 'pgm' },
		edidLabel: '',
		mode,
		videoMode: reqVideoMode,
		width: Math.max(64, j.addDestination.width || reqStd.width),
		height: Math.max(64, j.addDestination.height || reqStd.height),
		fps: Math.max(1, j.addDestination.fps || reqStd.fps),
		inheritsProjectFps: j.addDestination.inheritsProjectFps !== false,
		stream: { type: 'rtmp', source: 'program_1', url: '', key: '', quality: 'medium' },
		...(mode === 'pixelmap' ? { artnet: j.addDestination.artnet && typeof j.addDestination.artnet === 'object' ? j.addDestination.artnet : {} } : {}),
		...(mode === 'operator_gui' ? { guiUrl: j.addDestination.guiUrl, physicalPort: j.addDestination.physicalPort } : {}),
	})
	const next = normalizeScreenDestinations(top)
	ctx.config.screenDestinations = next
	saveConfig(ctx, { screenDestinations: next })
	return { ok: true, screenDestinations: next, addedId: id }
}

function handleUpdateDestination(j, ctx) {
	const id = String(j.updateDestination.id)
	const top = normalizeScreenDestinations(ctx.config?.screenDestinations)
	const idx = top.destinations.findIndex(d => d.id === id); if (idx < 0) return { error: 'Not found', id }
	const d0 = top.destinations[idx]; const p = j.updateDestination
	const nextMode =
		p.mode === 'pgm_only' || p.mode === 'pgm_prv' || p.mode === 'multiview' || p.mode === 'stream' || p.mode === 'pixelmap' || p.mode === 'operator_gui'
			? p.mode
			: d0.mode
	// WO-243: at most one operator_gui destination — block switching another destination's mode
	// to operator_gui when one already exists (the add-time guard alone can be bypassed via PATCH).
	if (nextMode === 'operator_gui' && d0.mode !== 'operator_gui' && top.destinations.some((d, i) => i !== idx && d.mode === 'operator_gui')) {
		return { error: 'At most one Operator GUI destination is allowed' }
	}

	let nextWidth = p.width || d0.width
	let nextHeight = p.height || d0.height
	let nextFps = p.fps || d0.fps
	
	if (p.videoMode && p.videoMode !== 'custom') {
		const { STANDARD_VIDEO_MODES } = require('../config/config-modes')
		const std = STANDARD_VIDEO_MODES[p.videoMode]
		if (std) {
			nextWidth = std.width
			nextHeight = std.height
			nextFps = std.fps
		}
	}

	top.destinations[idx] = {
		...d0,
		label: p.label != null ? String(p.label).trim() || d0.label : d0.label,
		mainScreenIndex: p.mainScreenIndex != null ? Math.max(0, parseInt(p.mainScreenIndex, 10) || 0) : d0.mainScreenIndex,
		audioLayout: p.audioLayout != null ? String(p.audioLayout).trim() || d0.audioLayout : d0.audioLayout,
		videoMode: p.videoMode || d0.videoMode,
		width: nextWidth,
		height: nextHeight,
		fps: nextFps,
		mode: nextMode,
		inheritsProjectFps:
			p.inheritsProjectFps != null ? p.inheritsProjectFps !== false : d0.inheritsProjectFps !== false,
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
		// WO-242: merge partial artnet fixture-array patches (rows/cols/ip/universe/…) onto the
		// existing object so per-field edits from the inspector don't clobber sibling fields.
		...(nextMode === 'pixelmap' || d0.mode === 'pixelmap'
			? { artnet: { ...(d0.artnet || {}), ...(p.artnet && typeof p.artnet === 'object' ? p.artnet : {}) } }
			: {}),
		// WO-243: guiUrl/physicalPort single-field edits should not clobber each other.
		...(nextMode === 'operator_gui' || d0.mode === 'operator_gui'
			? {
				guiUrl: p.guiUrl != null ? String(p.guiUrl) : d0.guiUrl,
				// physicalPort: explicit null = "clear back to Auto"; key absent = keep current.
				physicalPort:
					'physicalPort' in p ? (p.physicalPort == null ? undefined : p.physicalPort) : d0.physicalPort,
					// The merge only carries EXPLICITLY-listed patch fields (…d0 keeps the rest), so a
					// boolean toggle must be picked up here or its edit is dropped. autoLaunch was missing
					// → unchecking "Auto-start at boot" never stuck ("can't uncheck autostart gui"). A
					// present key wins (false honoured); an absent key keeps the current value.
					autoLaunch: 'autoLaunch' in p ? p.autoLaunch !== false : d0.autoLaunch,
					headless: 'headless' in p ? p.headless === true : d0.headless,
			}
			: {}),
	}
	const next = normalizeScreenDestinations(top)
	ctx.config.screenDestinations = next
	saveConfig(ctx, { screenDestinations: next })
	return { ok: true, screenDestinations: next, updatedId: id }
}

function handleRemoveDestination(j, ctx) {
	const id = String(j.removeDestination.id)
	const top = normalizeScreenDestinations(ctx.config?.screenDestinations)
	const before = top.destinations.length
	top.destinations = top.destinations.filter(d => d.id !== id)
	if (top.destinations.length === before) return { error: 'Not found', id }
	const next = normalizeScreenDestinations(top)
	ctx.config.screenDestinations = next
	const g0 = normalizeDeviceGraph(ctx.config?.deviceGraph)
	const graph = pruneDestinationFromGraph(g0, id)
	ctx.config.deviceGraph = graph
	saveConfig(ctx, { screenDestinations: next, deviceGraph: graph })
	return { ok: true, screenDestinations: next, removedId: id, graph }
}

function handleAddEdge(j, ctx, liveSnapshot) {
	const suggested = require('../config/device-graph').suggestConnectorsAndDevicesFromLive(liveSnapshot, ctx.config || {})
	const sid = String(j.addEdge.sourceId), tid = String(j.addEdge.sinkId)
	const merged = ensureConnectorsFromSuggested(ctx.config?.deviceGraph, [sid, tid], suggested)
	const res = addEdgeToGraph(merged, sid, tid); if (!res.ok) return { error: res.reason }
	let nextGraph = res.graph
	const wired = require('./device-view-decklink-wiring').applyDecklinkOutputOnDestinationEdge(ctx, nextGraph, sid, tid)
	if (wired.changed) nextGraph = wired.graph
	ctx.config.deviceGraph = nextGraph
	saveConfig(ctx, { deviceGraph: nextGraph, ...(ctx.config.casparServer ? { casparServer: ctx.config.casparServer } : {}) })
	scheduleDeviceViewCasparSyncIfNeeded(ctx)
	if (typeof ctx.augmentGraphWithSources === 'function') ctx.augmentGraphWithSources(res.graph, liveSnapshot)
	// WO-303: `wired.changed` means this cable rewrote casparServer output keys (a destination
	// cabled to a DeckLink port). That used to auto-restart Caspar 1.5 s later; it now only marks
	// the generated Caspar config stale so the operator's Apply & restart button turns orange.
	return { ok: true, graph: res.graph, casparRestartNeeded: !!wired.changed, pendingApply: !!wired.changed }
}

function handleRemoveEdge(j, ctx) {
	const g0 = normalizeDeviceGraph(ctx.config?.deviceGraph); const eid = String(j.removeEdge.id)
	const next = removeEdgeById(g0, eid)
	ctx.config.deviceGraph = next
	saveConfig(ctx, { deviceGraph: next })
	scheduleDeviceViewCasparSyncIfNeeded(ctx)
	if (typeof ctx.augmentGraphWithSources === 'function') {
		const Snapshot = require('./device-view-snapshot')
		Snapshot.buildLiveSnapshot(ctx).then(live => ctx.augmentGraphWithSources(next, live)).catch(() => {})
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
		const dirRaw = String(c1?.caspar?.ioDirection || DECKLINK_IO_UNASSIGNED).toLowerCase()
		const ioDirection =
			dirRaw === 'out' ? 'out' : dirRaw === 'in' ? 'in' : DECKLINK_IO_UNASSIGNED
		c1.caspar = { ...(c1.caspar || {}), ioDirection }
		const m = id.match(/^dlsdi_(\d+)$/)
		if (m) {
			const slot = parseInt(m[1], 10)
			if (Number.isFinite(slot) && slot > 0) {
				const cs = { ...(ctx.config.casparServer || {}) }
				const devNumRaw = parseInt(String(c1?.externalRef ?? c0?.externalRef ?? 0), 10)
				const devNum = Number.isFinite(devNumRaw) && devNumRaw > 0 ? devNumRaw : slot
				if (ioDirection === 'in') {
					cs[`decklink_input_${slot}_direction`] = 'in'
					cs[`decklink_input_${slot}_device`] = devNum
					const { recomputeDecklinkInputCount } = require('../config/decklink-input-slots')
					cs.decklink_input_count = recomputeDecklinkInputCount(cs)
				} else {
					clearDecklinkInputSlot(cs, slot, devNum)
					cs[`decklink_input_${slot}_direction`] = ioDirection
				}
				const outBindPatch = patch?.caspar?.outputBinding
				const inheritedBind = c0?.caspar?.outputBinding
				let outBind =
					outBindPatch && typeof outBindPatch === 'object'
						? outBindPatch
						: inheritedBind && typeof inheritedBind === 'object'
							? inheritedBind
							: null
				// PGM SDI needs screen_N_decklink_device; direction=out alone is not enough for Caspar.
				if (ioDirection === 'out' && (!outBind || typeof outBind !== 'object')) {
					const bus = String(c1?.caspar?.bus || c0?.caspar?.bus || '').toLowerCase()
					const mainIdx = Number.isFinite(Number(c1?.caspar?.mainIndex))
						? Number(c1.caspar.mainIndex)
						: Number.isFinite(Number(c0?.caspar?.mainIndex))
							? Number(c0.caspar.mainIndex)
							: 0
					if (bus === 'multiview') {
						outBind = { type: 'multiview' }
					} else {
						const screen = Math.min(8, Math.max(1, mainIdx + 1))
						outBind = { type: 'screen', index: screen }
					}
				}
				if (ioDirection === 'out' && outBind && typeof outBind === 'object') {
					c1.caspar = { ...(c1.caspar || {}), outputBinding: outBind }
					const keyFill = readDecklinkKeyFillFromConnectorCaspar({ ...(c1.caspar || {}), ...(patch.caspar || {}) })
					if (patch?.caspar?.decklinkKeyFill === false || patch?.caspar?.decklinkKeyFill === 'false') {
						c1.caspar.decklinkKeyFill = false
						c1.caspar.decklinkKeyDevice = 0
					} else if (patch?.caspar?.decklinkKeyDevice != null) {
						const keyDev = parseDecklinkDeviceIndex(patch.caspar.decklinkKeyDevice)
						c1.caspar.decklinkKeyDevice = keyDev
						c1.caspar.decklinkKeyFill = keyDev > 0
						if (patch?.caspar?.decklinkKeyer != null) {
							c1.caspar.decklinkKeyer = normalizeDecklinkKeyer(patch.caspar.decklinkKeyer)
						}
					} else if (keyFill.enabled) {
						c1.caspar.decklinkKeyDevice = keyFill.keyDevice
						c1.caspar.decklinkKeyFill = true
						c1.caspar.decklinkKeyer = keyFill.keyer
					}
					const t = String(outBind.type || '').toLowerCase()
					if (t === 'multiview') {
						cs.multiview_decklink_device = devNum
						writeDecklinkKeyFillToCasparServer(cs, 'multiview_', {
							fillDevice: devNum,
							keyDevice: parseDecklinkDeviceIndex(c1.caspar.decklinkKeyDevice),
							keyer: c1.caspar.decklinkKeyer,
						})
					} else if (t === 'screen') {
						const screen = Math.min(8, Math.max(1, parseInt(String(outBind.index ?? 1), 10) || 1))
						const destList = destinationsFromConfig(ctx.config || {})
						const destIdx = destList.findIndex(
							(d) => (Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) || 0) === screen - 1,
						)
						const dest = destIdx >= 0 ? destList[destIdx] : null
						const wiring = dest ? getDestinationOutputWiring(ctx.config || {}, dest, destIdx) : { gpu: false }
						cs[`screen_${screen}_decklink_device`] = devNum
						cs[`screen_${screen}_decklink_replace_screen`] = !wiring.gpu
						writeDecklinkKeyFillToCasparServer(cs, `screen_${screen}_`, {
							fillDevice: devNum,
							keyDevice: parseDecklinkDeviceIndex(c1.caspar.decklinkKeyDevice),
							keyer: c1.caspar.decklinkKeyer,
						})
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
	const finalDir = c0.kind === 'decklink_io' ? normalizeDecklinkIoDirection(c1.caspar) : null
	const outputTouched =
		c0.kind === 'decklink_io' &&
		(finalDir === 'out' ||
			patch?.caspar?.outputBinding != null ||
			patch?.caspar?.decklinkKeyDevice != null ||
			patch?.caspar?.decklinkKeyFill != null ||
			patch?.caspar?.decklinkKeyer != null ||
			patch?.caspar?.bus != null)
	if (outputTouched) scheduleDeviceViewCasparSyncIfNeeded(ctx)
	if (typeof ctx.augmentGraphWithSources === 'function') ctx.augmentGraphWithSources(ctx.config.deviceGraph, liveSnapshot)
	return { ok: true, graph: ctx.config.deviceGraph, updatedConnectorId: id }
}

function handleRemoveAllEdges(j, ctx) {
	const g0 = normalizeDeviceGraph(ctx.config?.deviceGraph)
	const next = { ...g0, edges: [] }
	ctx.config.deviceGraph = next
	saveConfig(ctx, { deviceGraph: next })
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
				{ id: 'out_1', mode: '1080p5000', label: 'Output 1' },
				{ id: 'out_2', mode: '1080p5000', label: 'Output 2' }
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
