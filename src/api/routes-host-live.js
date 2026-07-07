'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { handleHostOperatorFullscreen, getHostOperatorFullscreenSnapshot } = require('./host-operator-fullscreen')
const { migrateHostLiveSourcesConfig } = require('../config/host-live-sources-migrate')
const { enrichExtraLiveSources } = require('../config/extra-live-source-enrich')
const { handleWebpageHostLive } = require('./host-live-webpage')
const { handleNdiHostLive } = require('./host-live-ndi')
const { handleDecklinkHostLive } = require('./host-live-decklink')

/**
 * @param {string} path
 * @param {object} ctx
 */
function handleGet(path, ctx) {
	if (path === '/api/host-live/migration') {
		const mig = migrateHostLiveSourcesConfig(ctx.config || {}, ctx)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				warnings: mig.warnings,
				changed: mig.changed,
				extraLiveSources: enrichExtraLiveSources(mig.extraLiveSources, ctx),
			}),
		}
	}
	if (path !== '/api/host-live/operator-fullscreen') return null
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, ...getHostOperatorFullscreenSnapshot(ctx) }),
	}
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(body, ctx) {
	const j = parseBody(body) || {}
	if (j.migrateHostLiveSources === true) {
		const mig = migrateHostLiveSourcesConfig(ctx.config || {}, ctx)
		if (mig.changed && ctx.configManager) {
			const cur = ctx.configManager.get()
			const patch = {
				extraLiveSources: mig.extraLiveSources,
				...(mig.casparServerPatch && Object.keys(mig.casparServerPatch).length
					? { casparServer: { ...(cur.casparServer || {}), ...mig.casparServerPatch } }
					: {}),
			}
			ctx.configManager.save({ ...cur, ...patch })
			Object.assign(ctx.config, patch)
			if (typeof ctx._wsBroadcast === 'function') {
				ctx._wsBroadcast('change', { path: 'extraLiveSources', value: mig.extraLiveSources })
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				changed: mig.changed,
				warnings: mig.warnings,
				extraLiveSources: enrichExtraLiveSources(mig.extraLiveSources, ctx),
				casparRestartRecommended: mig.changed,
			}),
		}
	}
	if (j.operatorFullscreen != null || j.action != null || j.sourceId != null || j.value != null) {
		const payload = j.operatorFullscreen && typeof j.operatorFullscreen === 'object' ? j.operatorFullscreen : j
		const res = await handleHostOperatorFullscreen(ctx, payload)
		if (res.status) {
			return { status: res.status, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: res.error }) }
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				...res,
				...getHostOperatorFullscreenSnapshot(ctx),
			}),
		}
	}
	return null
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handleWebpagePost(body, ctx) {
	const j = parseBody(body) || {}
	const res = await handleWebpageHostLive(ctx, j)
	if (res.status) {
		return { status: res.status, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: res.error }) }
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody(res),
	}
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handleNdiPost(body, ctx) {
	const j = parseBody(body) || {}
	const res = await handleNdiHostLive(ctx, j)
	if (res.status) {
		return { status: res.status, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: res.error }) }
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody(res),
	}
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handleDecklinkPost(body, ctx) {
	const j = parseBody(body) || {}
	const res = await handleDecklinkHostLive(ctx, j)
	if (res.status) {
		return { status: res.status, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: res.error }) }
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody(res),
	}
}

module.exports = { handleGet, handlePost, handleWebpagePost, handleNdiPost, handleDecklinkPost }
