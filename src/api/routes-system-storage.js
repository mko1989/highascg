/**
 * Block devices + media partition mount APIs (WO-38).
 */
'use strict'

const { parseBody, JSON_HEADERS, jsonBody } = require('./response')
const { listBlockPartitionsForPicker } = require('../system/block-devices')
const {
	getMediaMountStatus,
	mountAndPersistConfiguredPartition,
} = require('../system/media-partition-mount')

async function handleGet(path, ctx) {
	if (path === '/api/system/block-devices') {
		if (process.platform !== 'linux') {
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ devices: [], unsupported: true }) }
		}
		const devices = await listBlockPartitionsForPicker()
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ devices }) }
	}

	if (path === '/api/system/media-mount/status') {
		const st = await getMediaMountStatus()
		const saved = (ctx.config && ctx.config.mediaMount) || {}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				...st,
				savedUuid: String(saved.uuid || '').trim(),
				savedKernelName: String(saved.lastKernelName || '').trim(),
			}),
		}
	}

	return null
}

async function handlePost(path, body, ctx) {
	if (path !== '/api/system/media-mount') return null
	if (!ctx.configManager || typeof ctx.configManager.get !== 'function') {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'No config manager' }) }
	}

	let payload
	try {
		payload = typeof body === 'string' ? parseBody(body) : body || {}
	} catch {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
	}
	if (!payload || typeof payload !== 'object') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid body' }) }
	}

	const logFn = (lvl, msg) => {
		if (typeof ctx.log === 'function') ctx.log(lvl || 'info', msg)
	}

	try {
		const out = await mountAndPersistConfiguredPartition({
			configManager: ctx.configManager,
			uuid: payload.uuid,
			confirm: payload.confirm,
			log: logFn,
		})

		try {
			Object.assign(ctx.config, ctx.configManager.get())
		} catch {}

		if (typeof ctx._wsBroadcast === 'function') {
			ctx._wsBroadcast('media_mount', { ok: true, ...out })
		}

		return { status: 200, headers: JSON_HEADERS, body: jsonBody(out) }
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: msg }) }
	}
}

module.exports = {
	handleGet,
	handlePost,
}
