'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { handleHostOperatorFullscreen, getHostOperatorFullscreenSnapshot } = require('./host-operator-fullscreen')
const { handleWebpageHostLive } = require('./host-live-webpage')
const { handleNdiHostLive } = require('./host-live-ndi')
const { handleDecklinkHostLive } = require('./host-live-decklink')
const { handleHostLiveLayer } = require('./host-live-layer')
const { handleBrowserDisplayHostLive, handleBrowserDisplayInteract } = require('./host-live-browser')

/**
 * @param {string} path
 * @param {object} ctx
 */
function handleGet(path, ctx) {
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

/**
 * WO-623 D — STOP / CLEAR / PLAY on one host channel-layer, composed server-side.
 * @param {string} body
 * @param {object} ctx
 */
async function handleLayerPost(body, ctx) {
	const res = await handleHostLiveLayer(ctx, parseBody(body) || {})
	if (res.status) {
		return { status: res.status, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: res.error }) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(res) }
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handleBrowserPost(body, ctx) {
	const j = parseBody(body) || {}
	const res = await handleBrowserDisplayHostLive(ctx, j)
	if (res.status) {
		return { status: res.status, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: res.error }) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(res) }
}

/**
 * WO-258 T258.4 — "Interact on operator screen" <-> "Return to background".
 * @param {string} body
 * @param {object} ctx
 */
async function handleBrowserInteractPost(body, ctx) {
	const j = parseBody(body) || {}
	const res = await handleBrowserDisplayInteract(ctx, j)
	if (res.status) {
		return { status: res.status, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: res.error }) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(res) }
}

module.exports = {
	handleGet,
	handlePost,
	handleWebpagePost,
	handleNdiPost,
	handleDecklinkPost,
	handleLayerPost,
	handleBrowserPost,
	handleBrowserInteractPost,
}
