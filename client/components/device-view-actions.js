/**
 * API Actions for Device View.
 */
import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { patchGraphWithMissingCableConnectors } from '../lib/device-view-cable-preflight.js'
import { resolveTopologyForDeviceView } from '../lib/device-view-gpu-port-list.js'

export async function loadDeviceView(opts = {}) {
	const freshGpu = opts?.freshGpu === true || opts?.freshGpu === '1'
	const params = []
	if (freshGpu) params.push('freshGpu=1')
	/* GET /api/device-view answers with `Cache-Control: private, max-age=3`, so for 3s the BROWSER
	 * serves it without contacting the server. Bypassing our own 5s payload cache with forceRefresh
	 * therefore was not enough — a reload right after a mutation could still be handed a pre-change
	 * response by the HTTP cache. api.get takes no fetch options, so bust it in the URL. Only on
	 * explicit fresh reads: ordinary loads should keep the benefit of that 3s window. */
	if (opts?.bustCache === true) params.push(`_ts=${Date.now()}`)
	const q = params.length ? `?${params.join('&')}` : ''
	return await api.get(`/api/device-view${q}`)
}

/**
 * WO-278 (A): warm the server's live-hardware snapshot cache off the critical path.
 * `/api/device-view/snapshot` runs the same buildLiveSnapshot() every cable mutation needs but
 * returns only the live block (~27 KB vs ~37 KB) and skips graph normalize/suggest/ETag work.
 * Fire-and-forget: a failed warm just means the next real request pays the cold price.
 */
export async function prewarmDeviceViewSnapshot() {
	try {
		return await api.get('/api/device-view/snapshot')
	} catch {
		return null
	}
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
	const t = o.type === 'pgm_only'
		? 'pgm_only'
		: (o.type === 'multiview'
			? 'multiview'
			: (o.type === 'host_channel'
				? 'host_channel'
				: (o.type === 'pixelmap'
					? 'pixelmap'
					: (o.type === 'operator_gui' ? 'operator_gui' : 'pgm_prv'))))
	const mainScreenIndex = Number.isFinite(Number(o.mainScreenIndex)) ? Number(o.mainScreenIndex) : undefined
	const addDestination = { type: t }
	if (mainScreenIndex != null) addDestination.mainScreenIndex = Math.max(0, mainScreenIndex)
	if (t === 'host_channel') {
		if (o.id) addDestination.id = String(o.id)
		if (o.hostRole) addDestination.hostRole = String(o.hostRole)
		if (o.casparChannel != null) addDestination.casparChannel = o.casparChannel
		if (o.inputSlot != null) addDestination.inputSlot = o.inputSlot
		if (o.sourceId) addDestination.sourceId = String(o.sourceId)
		if (o.label) addDestination.label = String(o.label)
	}
	return await api.post('/api/device-view', { addDestination })
}

export async function applyCasparConfig(opts = {}) {
	const body = {}
	if (typeof opts.xml === 'string' && opts.xml.trim()) body.xml = opts.xml.trim()
	return await api.post('/api/caspar-config/apply', body)
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
	quality,
	outputId,
	videoCodec,
	videoBitrateKbps,
	encoderPreset,
	audioCodec,
	audioBitrateKbps,
}) {
	// WO-261: the stream key is resolved SERVER-side from the active project — never sent by the client.
	return await api.post('/api/streaming-channel/rtmp', {
		action: 'start',
		rtmpServerUrl,
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

/**
 * WO-261: save RTMP url/key into the ACTIVE project (and only there). Empty streamKey keeps the
 * stored key; clearKey blanks it. The server never returns the raw key.
 */
export async function saveProjectStreamCredentials({
	outputId,
	rtmpServerUrl,
	streamKey,
	clearKey,
	srtPassphrase,
	clearPassphrase,
}) {
	return await api.post('/api/project/streaming-credentials', {
		outputId,
		rtmpServerUrl,
		streamKey,
		clearKey: clearKey === true,
		// WO-307: same empty-keeps/explicit-clear pattern as streamKey, independent of it.
		srtPassphrase,
		clearPassphrase: clearPassphrase === true,
	})
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
 * Ask the playout server to re-query GPU topology discovery.
 * @param {{ persist?: boolean }} [opts]
 */
export async function resetGpuLayout(opts = {}) {
	try {
		return await api.post('/api/system/gpu-ports-reset', opts)
	} catch {
		return null
	}
}

/** Purge playout config and replace the active project with empty Untitled (no looks). */
export async function factoryResetConfig() {
	const { performFactoryReset } = await import('../lib/default-project.js')
	await performFactoryReset()
}
