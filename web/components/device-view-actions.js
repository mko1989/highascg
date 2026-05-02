/**
 * API Actions for Device View.
 */
import { api } from '../lib/api-client.js'

export async function loadDeviceView(skipPh) {
	const q = skipPh ? '?pixelhue=0' : ''
	return await api.get('/api/device-view' + q)
}

export async function loadSettings() {
	return await api.get('/api/settings')
}

export async function saveSettingsPatch(patch) {
	return await api.post('/api/settings', patch)
}

export async function applyOsSettings(patch = {}) {
	return await api.post('/api/settings/apply-os', patch)
}

export async function getHardwareDisplays() {
	return await api.get('/api/hardware/displays')
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

export async function applyDeviceViewPlan(opts = {}) {
	return await api.post('/api/device-view', { applyPlan: opts })
}

export async function saveDeviceGraph(graph) {
	return await api.post('/api/device-view', { deviceGraph: graph })
}

export async function syncFromHardware(skipPh) {
	const payload = { syncFromLive: true }
	if (skipPh) payload.pixelhue = false
	return await api.post('/api/device-view', payload)
}

export async function addCable(sourceId, sinkId, skipPh, tandemSync) {
	const body = { addEdge: { sourceId, sinkId } }
	if (skipPh) body.pixelhue = false
	if (!tandemSync) body.tandemSync = false
	return await api.post('/api/device-view', body)
}

export async function removeEdge(edgeId, tandemSync) {
	const body = { removeEdge: { id: edgeId } }
	if (!tandemSync) body.tandemSync = false
	return await api.post('/api/device-view', body)
}

export async function removeAllEdges(tandemSync) {
	const body = { removeAllEdges: true }
	if (!tandemSync) body.tandemSync = false
	return await api.post('/api/device-view', body)
}

export async function updateConnector(id, patch, skipPh) {
	const body = { updateConnector: { id, patch } }
	if (skipPh) body.pixelhue = false
	return await api.post('/api/device-view', body)
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

export async function startPgmRecord({ outputId, crf, videoCodec, videoBitrateKbps, encoderPreset, audioCodec, audioBitrateKbps }) {
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
