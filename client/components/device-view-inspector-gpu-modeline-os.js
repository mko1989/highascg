/**
 * OS / xrandr patch helpers for GPU video modeline inspector.
 */
import { resolveGpuScreenNumber } from './device-view-inspector-gpu-resolve.js'
import { gpuPhysicalPortCableId } from '../lib/device-view-gpu-port-list.js'
import { casparVideoModeToOsModeAndRate } from './device-view-destinations-inspector-modes.js'
import { resolveDefaultVideoMode } from '../lib/project-fps.js'

export function resolveMainScreenCount(cs, currentSettings) {
	return Math.max(1, Math.min(4, parseInt(String(currentSettings?.screen_count ?? cs?.screen_count ?? 1), 10) || 1))
}

export function readPortOsValue(cs, currentSettings, screenN, suffix) {
	const n = Math.max(1, Math.min(4, Number(screenN) || 1))
	const k = `screen_${n}_${suffix}`
	return cs[k] ?? currentSettings?.casparServer?.[k] ?? currentSettings?.[k]
}

export function buildPerPortOsSettingsPatch(osScreenN, fields, { systemId } = {}) {
	const n = Math.max(1, Math.min(4, Number(osScreenN) || 1))
	const patch = {
		[`screen_${n}_os_mode`]: fields.os_mode,
		[`screen_${n}_os_rate`]: fields.os_rate,
		[`screen_${n}_os_backend`]: fields.os_backend,
		[`screen_${n}_os_timing_source`]: fields.os_timing_source,
		[`screen_${n}_os_mode_source`]: fields.os_mode_source,
		[`screen_${n}_force_os_resolution`]: fields.force_os_resolution,
	}
	const sid = String(systemId || '').trim()
	if (sid) patch[`screen_${n}_system_id`] = sid
	return patch
}

export function buildGlobalOsFieldsFromUi(overrideResIn, timingSel, osBackendSel, readOsResolutionFromUi) {
	const backend = osBackendSel.value === 'nvidia' ? 'nvidia' : 'xrandr'
	const ts = timingSel.value === 'gtf' ? 'gtf' : timingSel.value === 'cvt_r' ? 'cvt_r' : 'cvt'
	const force = !!overrideResIn.checked
	const os = readOsResolutionFromUi()
	return {
		os_mode: os.mode,
		os_rate: os.rate,
		os_mode_source: os.source,
		os_backend: backend,
		os_timing_source: ts,
		force_os_resolution: force,
	}
}

/** Expand to all main screens for POST /api/settings/apply-os only. */
export function expandBlanketOsPatch(cs, currentSettings, fields) {
	const patch = {}
	const count = resolveMainScreenCount(cs, currentSettings)
	for (let n = 1; n <= count; n++) {
		for (const [suffix, val] of Object.entries(fields)) {
			if (val === undefined) continue
			patch[`screen_${n}_${suffix}`] = val
		}
	}
	return patch
}

export function readScreenCasparOsDims(cs, currentSettings, screenN) {
	const n = Math.max(1, Math.min(4, Number(screenN) || 1))
	const modeKey = `screen_${n}_mode`
	const wKey = `screen_${n}_custom_width`
	const hKey = `screen_${n}_custom_height`
	const fpsKey = `screen_${n}_custom_fps`
	const projectMode = resolveDefaultVideoMode(currentSettings)
	const modeId = String(cs[modeKey] ?? currentSettings?.casparServer?.[modeKey] ?? currentSettings?.[modeKey] ?? projectMode).trim() || projectMode
	return casparVideoModeToOsModeAndRate(modeId, {
		customWidth: Math.max(64, parseInt(String(cs[wKey] ?? currentSettings?.casparServer?.[wKey] ?? 1920), 10) || 1920),
		customHeight: Math.max(64, parseInt(String(cs[hKey] ?? currentSettings?.casparServer?.[hKey] ?? 1080), 10) || 1080),
		customFps: Math.max(1, parseFloat(String(cs[fpsKey] ?? currentSettings?.casparServer?.[fpsKey] ?? 50)) || 50),
	})
}

export function listSiblingGpuPortsOnCasparScreen(conn, lastPayload, casparScreenN) {
	const sug = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	return sug
		.filter((c) => c?.kind === 'gpu_out' && String(c?.id || '') !== String(conn?.id || ''))
		.filter((c) => resolveGpuScreenNumber(c, lastPayload) === casparScreenN)
		.map((c) => gpuPhysicalPortCableId(c.id) || c.label || c.id)
}
