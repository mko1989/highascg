/**
 * Resolve feed resolution from a Device View cable source and seed GPU screen settings.
 */
import {
	CASPAR_VIDEO_MODE_SPECS,
} from '../components/device-view-destinations-inspector.js'
import { videoModeToResolution, resolveMappingOutputResolution } from './mapping-node-service.js'
import { resolveDefaultVideoMode } from './project-fps.js'

/**
 * @param {object | null | undefined} raw
 * @returns {{ id: string, label?: string, videoMode: string, width: number, height: number, fps: number } | null}
 */
function normalizeFeedSource(raw, settings) {
	if (!raw || typeof raw !== 'object') return null
	const id = String(raw.id || '').trim()
	if (!id) return null
	const fallbackMode = resolveDefaultVideoMode(settings)
	const videoMode = String(raw.videoMode || fallbackMode).trim() || fallbackMode
	const spec = CASPAR_VIDEO_MODE_SPECS[videoMode]
	const fallback = videoModeToResolution(videoMode)
	return {
		id,
		label: raw.label != null ? String(raw.label) : undefined,
		videoMode,
		width: Math.max(64, parseInt(String(raw.width ?? spec?.width ?? fallback.w), 10) || 1920),
		height: Math.max(64, parseInt(String(raw.height ?? spec?.height ?? fallback.h), 10) || 1080),
		fps: Math.max(1, parseFloat(String(raw.fps ?? spec?.fps ?? 50)) || 50),
	}
}

/**
 * @param {object | null | undefined} lastPayload
 * @param {string} sourceId
 */
function resolveDestinationFeedSource(lastPayload, sourceId) {
	const sid = String(sourceId || '').trim()
	if (!sid.startsWith('dst_in_')) return null

	const fromGraph = (lastPayload?.graph?.sources || []).find((s) => String(s?.id || '') === sid)
	if (fromGraph) return normalizeFeedSource(fromGraph, lastPayload?._settings)

	const dstId = sid.slice('dst_in_'.length).trim()
	if (!dstId) return null

	const intents = Array.isArray(lastPayload?.live?.caspar?.destinationIntent?.items)
		? lastPayload.live.caspar.destinationIntent.items
		: []
	const intent = intents.find((x) => String(x?.id || '') === dstId)
	if (intent) {
		return normalizeFeedSource({
			id: sid,
			label: intent.label,
			videoMode: intent.videoMode,
			width: intent.width,
			height: intent.height,
			fps: intent.fps,
		}, lastPayload?._settings)
	}

	const dests = Array.isArray(lastPayload?.screenDestinations?.destinations)
		? lastPayload.screenDestinations.destinations
		: []
	const d = dests.find((x) => String(x?.id || '') === dstId)
	if (d) {
		return normalizeFeedSource({
			id: sid,
			label: d.label,
			videoMode: d.videoMode,
			width: d.width,
			height: d.height,
			fps: d.fps,
		}, lastPayload?._settings)
	}

	return null
}

/**
 * @param {object | null | undefined} lastPayload
 * @param {string} sourceId
 */
function resolveMappingOutputFeedSource(lastPayload, sourceId) {
	const sid = String(sourceId || '').trim()
	const conn = (Array.isArray(lastPayload?.graph?.connectors) ? lastPayload.graph.connectors : []).find(
		(c) => String(c?.id || '') === sid,
	)
	if (!conn || conn.kind !== 'pixel_map_out') return null

	const node = (Array.isArray(lastPayload?.graph?.devices) ? lastPayload.graph.devices : []).find(
		(d) => String(d?.id || '') === String(conn.deviceId || ''),
	)
	const outputs = Array.isArray(node?.settings?.outputs) ? node.settings.outputs : []
	const deviceId = String(conn.deviceId || '').trim()
	const outKey =
		deviceId && sid.startsWith(`${deviceId}_`) ? sid.slice(deviceId.length + 1) : ''
	const output =
		outputs.find((o) => String(o?.id || '') === outKey) ||
		outputs[Number.isFinite(Number(conn.index)) ? Number(conn.index) : -1] ||
		null
	/* WO-437: resolveMappingOutputResolution owns the mode-vs-stored-dims precedence (a standard
	 * mode outranks stale stored width/height) — inlining `output.width ?? mode dims` here made
	 * GPU ports report the pre-mode-change size as the incoming signal. */
	const res = resolveMappingOutputResolution(output)

	return normalizeFeedSource({
		id: sid,
		label: output?.label || conn.label,
		videoMode: res.mode,
		width: res.width,
		height: res.height,
		fps: res.fps,
	}, lastPayload?._settings)
}

/**
 * Feed resolution for any cable source endpoint (destination feed or mapping output).
 * @param {object | null | undefined} lastPayload
 * @param {string} sourceId
 */
export function resolveCableSourceResolution(lastPayload, sourceId) {
	return (
		resolveDestinationFeedSource(lastPayload, sourceId) ||
		resolveMappingOutputFeedSource(lastPayload, sourceId)
	)
}

/**
 * @param {object | null | undefined} lastPayload
 * @param {string} sourceId
 */
export function gpuOutputBindingFromCableSource(lastPayload, sourceId, half) {
	const sid = String(sourceId || '').trim()
	if (!sid.startsWith('dst_in_')) return null
	const dstId = sid.slice('dst_in_'.length).trim()
	if (!dstId) return null
	const dests = Array.isArray(lastPayload?.screenDestinations?.destinations)
		? lastPayload.screenDestinations.destinations
		: []
	const d = dests.find((x) => String(x?.id || '') === dstId)
	if (!d) return null
	const mode = String(d.mode || 'pgm_prv').toLowerCase()
	if (mode === 'multiview') return { type: 'multiview' }
	const mainIdx = Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0)
	/* WO-364: a cable armed on the PRV half binds the jack as a PRV head, never as screen_N. */
	if (half === 'prv' && mode === 'pgm_prv') return { type: 'screen_prv', index: Math.max(1, mainIdx + 1) }
	return { type: 'screen', index: Math.max(1, mainIdx + 1) }
}

/**
 * POST /api/settings patch: inherit destination/mapping feed timing on a Caspar screen consumer.
 * @param {number} screenN 1-based screen index
 * @param {{ videoMode: string, width: number, height: number, fps: number }} source
 */
export function gpuScreenInheritedSettingsPatch(screenN, source) {
	const n = Math.max(1, Number(screenN) || 1)
	const mode = String(source?.videoMode || '1080p5000').trim() || '1080p5000'
	const width = Math.max(64, parseInt(String(source?.width ?? 1920), 10) || 1920)
	const height = Math.max(64, parseInt(String(source?.height ?? 1080), 10) || 1080)
	const fps = Math.max(1, parseFloat(String(source?.fps ?? 50)) || 50)
	return {
		casparServer: {
			[`screen_${n}_mode`]: mode,
			[`screen_${n}_custom_width`]: width,
			[`screen_${n}_custom_height`]: height,
			[`screen_${n}_custom_fps`]: fps,
		},
	}
}

/** @param {object[]} patches */
export function mergeSettingsPatches(...patches) {
	const out = { casparServer: {} }
	for (const p of patches) {
		if (!p || typeof p !== 'object') continue
		if (p.casparServer && typeof p.casparServer === 'object') {
			Object.assign(out.casparServer, p.casparServer)
		}
		for (const [k, v] of Object.entries(p)) {
			if (k !== 'casparServer') out[k] = v
		}
	}
	return out
}
