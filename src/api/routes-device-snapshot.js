/**
 * WO-49 — Device-wide snapshot: build envelope, apply validated snapshot.
 */
'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const {
	parseAndValidateDeviceSnapshot,
	applySnapshotToConfigClone,
	diffTopLevelKeys,
	listSectionsTouched,
	buildEnvelopeFromCtx,
	SNAPSHOT_JSON_SCHEMA,
} = require('../config/device-snapshot')
const { pickOscForPersistence, SYSTEM_DISPLAY_KEYS } = require('./settings-os')
const defaults = require('../config/defaults')
const { normalizeRtmpConfig } = require('../config/rtmp-output')
const { normalizeScreenDestinations } = require('../config/screen-destinations')
const { normalizeDeviceGraph } = require('../config/device-graph')

/**
 * Persist full config like settings-post after mutating a working copy `next`.
 * @param {import('../config/config-manager')} cm
 * @param {object} next
 */
function saveFullConfigLikeSettings(cm, next) {
	const cur = cm.get()
	const newConfig = {
		...cur,
		screen_count: next.screen_count,
		caspar: next.caspar,
		streaming: { ...next.streaming },
		periodic_sync_interval_sec: next.periodic_sync_interval_sec,
		periodic_sync_interval_sec_osc: next.periodic_sync_interval_sec_osc,
		osc_info_supplement_ms: next.osc_info_supplement_ms,
		osc: pickOscForPersistence(next.osc),
		ui: next.ui || defaults.ui,
		audioRouting: next.audioRouting || defaults.audioRouting,
		offline_mode: next.offline_mode,
		dmx: { ...defaults.dmx, ...(next.dmx || {}) },
		casparServer: next.casparServer || defaults.casparServer,
		companion: next.companion || { host: '127.0.0.1', port: 8000 },
		screenDestinations: normalizeScreenDestinations(next.screenDestinations),
		deviceGraph: normalizeDeviceGraph(next.deviceGraph),
		gpuPhysicalTopology:
			Array.isArray(next.gpuPhysicalTopology) && next.gpuPhysicalTopology.length
				? next.gpuPhysicalTopology
				: defaults.gpuPhysicalTopology,
		rtmp: normalizeRtmpConfig(next.rtmp),
		usbIngest: { ...defaults.usbIngest, ...(next.usbIngest || {}) },
		streamingChannel: { ...defaults.streamingChannel, ...(next.streamingChannel || {}) },
		streamOutputs: Array.isArray(next.streamOutputs) ? next.streamOutputs : cur.streamOutputs || [],
		recordOutputs: Array.isArray(next.recordOutputs) ? next.recordOutputs : cur.recordOutputs || [],
		audioOutputs: Array.isArray(next.audioOutputs) ? next.audioOutputs : cur.audioOutputs || [],
		local_media_path: next.local_media_path,
		mediaMount: { ...defaults.mediaMount, ...(next.mediaMount || {}) },
	}
	delete newConfig.streaming._effectiveBasePort
	delete newConfig.streaming._casparHost
	for (const k of SYSTEM_DISPLAY_KEYS) {
		if (next[k] !== undefined) newConfig[k] = next[k]
		else delete newConfig[k]
	}
	cm.save(newConfig)
}

/**
 * @param {string} path
 * @param {object} ctx
 */
function handleGet(path, ctx) {
	if (path === '/api/device-snapshot/schema') {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(SNAPSHOT_JSON_SCHEMA) }
	}
	if (path === '/api/device-snapshot/build') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, ...buildEnvelopeFromCtx(ctx) }),
		}
	}
	return null
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(body, ctx) {
	const j = parseBody(body)
	if (!j || typeof j !== 'object') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'Invalid JSON' }) }
	}
	const mode = j.mode === 'graphOnly' ? 'graphOnly' : 'full'
	const dryRun = j.dryRun === true || j.dryRun === 'true'
	const raw = j.snapshot && typeof j.snapshot === 'object' ? j.snapshot : j
	const parsed = parseAndValidateDeviceSnapshot(raw)
	if (!parsed.ok) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: parsed.error, details: parsed.details }),
		}
	}
	const snapshot = /** @type {Record<string, unknown>} */ (parsed.snapshot)
	if (
		mode === 'graphOnly' &&
		(!snapshot.payload || typeof snapshot.payload !== 'object' || snapshot.payload.deviceGraph == null)
	) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: false,
				error: 'graphOnly requires payload.deviceGraph in the snapshot',
			}),
		}
	}
	if (!ctx.configManager || typeof ctx.configManager.get !== 'function') {
		return {
			status: 503,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: 'configManager unavailable' }),
		}
	}
	const cfg0 = ctx.configManager.get()
	const next = { ...cfg0 }
	applySnapshotToConfigClone(next, snapshot, mode)
	const changed = diffTopLevelKeys(cfg0, snapshot, mode)
	const sections = listSectionsTouched(mode)
	if (dryRun) {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				dryRun: true,
				mode,
				sections,
				changedKeys: changed,
			}),
		}
	}
	saveFullConfigLikeSettings(ctx.configManager, next)
	Object.assign(ctx.config, ctx.configManager.get())
	if (typeof ctx._wsBroadcast === 'function') {
		ctx._wsBroadcast('change', { path: 'deviceSnapshot', value: { applied: true, mode } })
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			mode,
			sections,
			changedKeys: changed,
		}),
	}
}

module.exports = { handleGet, handlePost }
