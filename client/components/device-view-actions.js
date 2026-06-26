/**
 * API Actions for Device View.
 */
import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { patchGraphWithMissingCableConnectors } from '../lib/device-view-cable-preflight.js'
import { resolveTopologyForDeviceView } from '../lib/device-view-gpu-port-list.js'

export async function loadDeviceView() {
	return await api.get('/api/device-view')
}

export async function applyDeviceSnapshot(snapshot, opts = {}) {
	return await api.post('/api/device-snapshot/apply', {
		snapshot,
		mode: opts.mode === 'graphOnly' ? 'graphOnly' : 'full',
		dryRun: !!opts.dryRun,
	})
}

export async function buildDeviceSnapshotEnvelope() {
	return await api.get('/api/device-snapshot/build')
}

export async function loadSettings() {
	return await api.get('/api/settings')
}

export async function saveSettingsPatch(patch) {
	const res = await api.post('/api/settings', patch)
	try {
		await settingsState.load()
		document.dispatchEvent(new CustomEvent('highascg-settings-applied', { detail: res }))
	} catch {
		/* settings cache refresh is best-effort */
	}
	return res
}

/** Persist rear-panel DP/HDMI bracket map so server physicalMap matches the layout editor. */
export async function saveGpuPhysicalTopology(topology) {
	if (!Array.isArray(topology) || !topology.length) return null
	return await api.post('/api/settings', { gpuPhysicalTopology: topology })
}

export async function applyOsSettings(patch = {}) {
	return await api.post('/api/settings/apply-os', patch)
}

export async function getModelinePreview({ w, h, rate, type }) {
	const q = new URLSearchParams({
		w: String(Math.round(w)),
		h: String(Math.round(h)),
		rate: String(rate),
		type: String(type || 'cvt'),
	})
	return await api.get(`/api/hardware/modeline-preview?${q.toString()}`)
}

export async function patchDestination(id, patch) {
	return await api.post('/api/device-view', { updateDestination: { id, ...patch } })
}

export async function removeDestination(id) {
	return await api.post('/api/device-view', { removeDestination: { id } })
}

export async function addDestination(typeOrOptions) {
	const o = typeOrOptions && typeof typeOrOptions === 'object' ? typeOrOptions : { type: typeOrOptions }
	const t = o.type === 'pgm_only' ? 'pgm_only' : (o.type === 'multiview' ? 'multiview' : 'pgm_prv')
	const mainScreenIndex = Number.isFinite(Number(o.mainScreenIndex)) ? Number(o.mainScreenIndex) : undefined
	const addDestination = { type: t }
	if (mainScreenIndex != null) addDestination.mainScreenIndex = Math.max(0, mainScreenIndex)
	return await api.post('/api/device-view', { addDestination })
}

export async function applyCasparConfig() {
	return await api.post('/api/caspar-config/apply', {})
}

export async function getCasparConfigOverride() {
	return await api.get('/api/caspar-config/override')
}

export async function saveCasparConfigOverride(override) {
	return await api.post('/api/caspar-config/override', { override })
}

export async function getGeneratedCasparConfig(effective = false) {
	const q = effective ? '?effective=1' : ''
	return await api.get('/api/caspar-config/generate' + q, { type: 'text' })
}

export async function applyDeviceViewPlan(opts = {}) {
	return await api.post('/api/device-view', { applyPlan: opts })
}

export async function saveDeviceGraph(graph) {
	return await api.post('/api/device-view', { deviceGraph: graph })
}

/** Merge live GPU/DeckLink connectors into the saved device graph (server `syncFromLive`). */
export async function syncDeviceGraphFromLive() {
	return await api.post('/api/device-view', { syncFromLive: true })
}

/**
 * Persist topology + materialize missing cable endpoints in the saved graph.
 * Avoids syncFromLive here — it strips gpu_out rows that are not in suggested hardware.
 * @param {object | null | undefined} payload
 * @param {object | null | undefined} settings
 * @param {string} sourceId
 * @param {string} sinkId
 */
export async function recoverDeviceGraphForCable(payload, settings, sourceId, sinkId) {
	const topology = resolveTopologyForDeviceView(payload, settings)
	await saveGpuPhysicalTopology(topology)
	let working = payload
	try {
		const fresh = await loadDeviceView()
		if (fresh) {
			working = { ...fresh, gpuPhysicalTopology: topology }
		}
	} catch {
		/* use payload */
	}
	const materialized = await ensureCableConnectorsInSavedGraph(working, settings, sourceId, sinkId)
	return { topology, fresh: materialized.fresh || working, graph: materialized.graph }
}

/**
 * Write minimal gpu_pN / dst_in_* rows into the persisted graph when absent.
 * @param {object | null | undefined} payload
 * @param {object | null | undefined} settings
 * @param {string} sourceId
 * @param {string} sinkId
 */
export async function ensureCableConnectorsInSavedGraph(payload, settings, sourceId, sinkId) {
	const { graph, addedIds } = patchGraphWithMissingCableConnectors(payload, settings, [
		sourceId,
		sinkId,
	])
	if (!addedIds.length) {
		return { graph: payload?.graph || graph, fresh: payload, addedIds }
	}
	const res = await saveDeviceGraph(graph)
	const saved = res?.graph || graph
	let fresh = null
	try {
		fresh = await loadDeviceView()
		if (fresh?.graph) fresh.graph = saved
	} catch {
		/* saved graph is enough */
	}
	return { graph: saved, fresh: fresh || { ...(payload || {}), graph: saved }, addedIds }
}

export async function addCable(sourceId, sinkId) {
	return await api.post('/api/device-view', { addEdge: { sourceId, sinkId } })
}

export async function removeEdge(edgeId) {
	return await api.post('/api/device-view', { removeEdge: { id: edgeId } })
}

export async function removeAllEdges() {
	return await api.post('/api/device-view', { removeAllEdges: true })
}

export async function updateConnector(id, patch) {
	return await api.post('/api/device-view', { updateConnector: { id, patch } })
}



export async function getStreamingChannelStatus() {
	return await api.get('/api/streaming-channel')
}

export async function startStreamingChannelRtmp({
	rtmpServerUrl,
	streamKey,
	quality,
	outputId,
	videoCodec,
	videoBitrateKbps,
	encoderPreset,
	audioCodec,
	audioBitrateKbps,
}) {
	return await api.post('/api/streaming-channel/rtmp', {
		action: 'start',
		rtmpServerUrl,
		streamKey,
		quality,
		outputId,
		videoCodec,
		videoBitrateKbps,
		encoderPreset,
		audioCodec,
		audioBitrateKbps,
	})
}

export async function stopStreamingChannelRtmp() {
	return await api.post('/api/streaming-channel/rtmp', { action: 'stop' })
}

export async function getPgmRecordStatus() {
	const st = await api.get('/api/streaming-channel')
	return {
		recording: !!st?.record?.active,
		path: st?.record?.path || null,
	}
}

export async function startPgmRecord({
	outputId,
	crf,
	videoCodec,
	videoBitrateKbps,
	encoderPreset,
	audioCodec,
	audioBitrateKbps,
}) {
	return await api.post('/api/streaming-channel/record', {
		action: 'start',
		outputId,
		crf,
		videoCodec,
		videoBitrateKbps,
		encoderPreset,
		audioCodec,
		audioBitrateKbps,
	})
}

export async function stopPgmRecord({ outputId } = {}) {
	return await api.post('/api/streaming-channel/record', { action: 'stop', outputId })
}

export async function addMappingNode() {
	return await api.post('/api/device-view', { addMappingNode: true })
}

/**
 * Ask the playout server to re-query xrandr/DRM (optional). Returns null when the route is missing.
 * Client UI should still clear `gpu_custom_layout` and refresh from `live.gpu` when this fails.
 */
export async function resetGpuLayout() {
	try {
		return await api.post('/api/system/gpu-ports-reset')
	} catch {
		return null
	}
}

/** Purge playout config and replace the active project with empty Untitled (no looks). */
export async function factoryResetConfig() {
	const { performFactoryReset } = await import('../lib/default-project.js')
	await performFactoryReset()
}
