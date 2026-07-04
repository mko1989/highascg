'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const bridge = require('../virtual-output/v4l2-bridge')
const { patchVirtualCameraConfig, normalizeVirtualCameraConfig } = require('../virtual-output/v4l2-bridge-config')
const { validateVirtualCameraConfig } = require('../virtual-output/v4l2-bridge-config-validate')

/**
 * @param {object} ctx
 */
function syncVirtualCameraStatus(ctx) {
	const payload = getStatusPayload(ctx)
	if (ctx) ctx._virtualCameraStatus = payload
	return payload
}

/**
 * @param {object} ctx
 */
function getStatusPayload(ctx) {
	return {
		ok: true,
		...bridge.getV4l2BridgeStats(ctx?.config || {}),
	}
}

/**
 * @param {object} ctx
 * @param {object} patch
 * @param {{ persist?: boolean, validate?: boolean }} [opts]
 */
function applyVirtualCameraConfigPatch(ctx, patch, opts = {}) {
	const next = patchVirtualCameraConfig(ctx.config, patch)
	if (opts.validate !== false) {
		const v = validateVirtualCameraConfig(next)
		if (!v.ok) {
			const err = new Error(v.errors.join('; '))
			err.validation = v
			throw err
		}
	}
	ctx.config.virtualCamera = next
	if (opts.persist && ctx.configManager) {
		ctx.configManager.save({ ...ctx.configManager.get(), virtualCamera: next })
	}
	return next
}

/**
 * @param {number} status
 * @param {object} payload
 */
function respond(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

/**
 * @param {string} path
 * @param {object} ctx
 */
async function handleGet(path, ctx) {
	if (path === '/api/virtual-camera/status' || path === '/api/virtual-camera') {
		return respond(200, syncVirtualCameraStatus(ctx))
	}
	return null
}

/**
 * @param {string} path
 * @param {object} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	if (path === '/api/virtual-camera/config') {
		const b = parseBody(body)
		if (!b || typeof b !== 'object') {
			return respond(400, { ok: false, error: 'Invalid JSON body' })
		}
		const patch = b.virtualCamera && typeof b.virtualCamera === 'object' ? b.virtualCamera : b
		try {
			const next = applyVirtualCameraConfigPatch(ctx, patch, { persist: true })
			const validation = validateVirtualCameraConfig(next)
			if (bridge.isVirtualCameraEnabled(ctx.config)) {
				await bridge.startV4l2Bridge(ctx)
			} else {
				await bridge.stopV4l2Bridge(ctx)
			}
			return respond(200, {
				ok: true,
				virtualCamera: next,
				warnings: validation.warnings,
				...syncVirtualCameraStatus(ctx),
			})
		} catch (e) {
			if (e.validation) {
				return respond(400, { ok: false, error: e.message, ...e.validation })
			}
			return respond(400, { ok: false, error: e?.message || String(e) })
		}
	}

	if (path === '/api/virtual-camera/start') {
		if (!ctx?.amcp?.isConnected) {
			return respond(503, { ok: false, error: 'Caspar not connected', ...getStatusPayload(ctx) })
		}
		const b = parseBody(body)
		const patch = b && typeof b === 'object' ? (b.virtualCamera && typeof b.virtualCamera === 'object' ? b.virtualCamera : b) : {}
		try {
			applyVirtualCameraConfigPatch(ctx, { ...patch, enabled: true }, { persist: !!b?.persist })
		} catch (e) {
			if (e.validation) {
				return respond(400, { ok: false, error: e.message, ...e.validation })
			}
			return respond(400, { ok: false, error: e?.message || String(e) })
		}

		const result = await bridge.startV4l2Bridge(ctx)
		const status = syncVirtualCameraStatus(ctx)
		if (!status.running) {
			ctx.config.virtualCamera = patchVirtualCameraConfig(ctx.config, { enabled: false })
			return respond(502, {
				ok: false,
				started: false,
				error: result?.reason || 'Virtual camera failed to start',
				reason: result?.reason || null,
				...status,
			})
		}
		return respond(200, { ok: true, started: true, reason: result?.reason || 'started', ...status })
	}

	if (path === '/api/virtual-camera/stop') {
		await bridge.stopV4l2Bridge(ctx)
		if (ctx.config?.virtualCamera) {
			ctx.config.virtualCamera = patchVirtualCameraConfig(ctx.config, { enabled: false })
			if (parseBody(body)?.persist && ctx.configManager) {
				ctx.configManager.save({ ...ctx.configManager.get(), virtualCamera: ctx.config.virtualCamera })
			}
		}
		return respond(200, { ok: true, stopped: true, ...syncVirtualCameraStatus(ctx) })
	}

	return null
}

module.exports = {
	handleGet,
	handlePost,
	getStatusPayload,
	syncVirtualCameraStatus,
	normalizeVirtualCameraConfig,
}
