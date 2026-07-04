'use strict'

const defaults = require('../config/defaults')
const { getChannelMap } = require('../config/routing')
const { listConfiguredV4l2Slots, normalizeV4l2DevicePath } = require('../capture/v4l2-input-config')
const { enumerateV4l2CaptureDevices } = require('../capture/v4l2-enumerate')
const { listV4l2InputBridgeStatuses } = require('../capture/v4l2-input-bridge')
const { validateV4l2CasparSlice } = require('../capture/v4l2-input-config-validate')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

/**
 * @param {string} path
 * @param {string} query
 * @param {object} [ctx]
 */
async function handleGet(path, query, ctx) {
	if (path === '/api/system/v4l2-devices') {
		const refresh = query.refresh === '1' || query.refresh === 'true'
		const data = await enumerateV4l2CaptureDevices({ refresh })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(data) }
	}
	if (path === '/api/v4l2-inputs' || path === '/api/v4l2-inputs/status') {
		const cfg = ctx?.config || {}
		const map = getChannelMap(cfg)
		const configured = listConfiguredV4l2Slots(cfg)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				v4l2InputChannels: map.v4l2InputChannels,
				v4l2InputCount: map.v4l2InputCount,
				configured,
				bridges: listV4l2InputBridgeStatuses(),
				status: ctx?._v4l2InputsStatus ?? null,
			}),
		}
	}
	return null
}

/**
 * @param {string} path
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	if (path === '/api/v4l2-inputs/apply') {
		if (!ctx.amcp) {
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		}
		const { setupV4l2Inputs } = require('../config/routing-setup')
		try {
			await setupV4l2Inputs(ctx)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, status: ctx._v4l2InputsStatus ?? null }),
			}
		} catch (e) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	if (path === '/api/v4l2-inputs/config') {
		const b = parseBody(body)
		if (!b || typeof b !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON body' }) }
		}
		const cs = { ...(ctx.config.casparServer || {}), ...(b.casparServer || {}) }
		if (b.v4l2_input_count != null) cs.v4l2_input_count = b.v4l2_input_count
		for (let i = 1; i <= 8; i++) {
			const devKey = `v4l2_input_${i}_device`
			if (b[devKey] != null) cs[devKey] = normalizeV4l2DevicePath(String(b[devKey]))
			const labelKey = `v4l2_input_${i}_label`
			if (b[labelKey] != null) cs[labelKey] = String(b[labelKey]).trim()
			const fmtKey = `v4l2_input_${i}_format`
			if (b[fmtKey] != null) cs[fmtKey] = String(b[fmtKey]).trim()
			const wKey = `v4l2_input_${i}_width`
			if (b[wKey] != null) cs[wKey] = b[wKey]
			const hKey = `v4l2_input_${i}_height`
			if (b[hKey] != null) cs[hKey] = b[hKey]
			const fpsKey = `v4l2_input_${i}_fps`
			if (b[fpsKey] != null) cs[fpsKey] = b[fpsKey]
			const audKey = `v4l2_input_${i}_audio`
			if (b[audKey] != null) cs[audKey] = String(b[audKey]).trim()
		}
		if (b.v4l2_capture_bridge != null) cs.v4l2_capture_bridge = b.v4l2_capture_bridge
		if (b.v4l2_input_channel_mode != null) cs.v4l2_input_channel_mode = String(b.v4l2_input_channel_mode).trim()
		ctx.config.casparServer = { ...defaults.casparServer, ...cs }
		if (ctx.configManager) {
			ctx.configManager.save({ ...ctx.configManager.get(), casparServer: ctx.config.casparServer })
		}
		const warnings = validateV4l2CasparSlice(ctx.config.casparServer).warnings
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, casparServer: ctx.config.casparServer, warnings }),
		}
	}

	return null
}

module.exports = { handleGet, handlePost }
