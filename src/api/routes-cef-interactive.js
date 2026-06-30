'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { bridgeEnabledInConfig, notifyCefFocusChanged } = require('../system/cef-interactive-bridge')
const { getCefFocusTarget } = require('../system/cef-focus-registry')
const {
	listCefInteractiveTargets,
	setCefFocusFromSourceId,
	clearCefFocusOnly,
	forwardToCefTarget,
} = require('../system/cef-interactive-forward')

function bridgeDisabled() {
	return {
		status: 503,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: false, error: 'CEF interactive bridge disabled or not configured' }),
	}
}

function apiResult(res, extra = {}) {
	if (res.status) {
		return {
			status: res.status,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: res.error, ...extra }),
		}
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ...res, ...extra }),
	}
}

/**
 * @param {string} path
 * @param {object} ctx
 */
async function handleGet(path, ctx) {
	if (path !== '/api/cef-interactive/targets') return null
	if (!bridgeEnabledInConfig(ctx.config || {})) return bridgeDisabled()
	const targets = await listCefInteractiveTargets(ctx.config || {}, ctx)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			focus: getCefFocusTarget(),
			targets,
		}),
	}
}

/**
 * @param {string} path
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	if (!path.startsWith('/api/cef-interactive/')) return null
	if (!bridgeEnabledInConfig(ctx.config || {})) return bridgeDisabled()

	const j = parseBody(body) || {}
	const log = typeof ctx.log === 'function' ? (level, msg) => ctx.log(level, msg) : undefined

	if (path === '/api/cef-interactive/focus') {
		const sourceId = String(j.sourceId || '').trim()
		if (!sourceId) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'sourceId required' }) }
		}
		const res = await setCefFocusFromSourceId(ctx.config || {}, sourceId, {
			zoneId: j.zoneId,
			log,
		})
		if (res.ok) {
			ctx._cefFocusTarget = res.cefFocusTarget
			notifyCefFocusChanged(log)
			if (typeof ctx._wsBroadcast === 'function') {
				ctx._wsBroadcast('change', { path: 'cefFocusTarget', value: res.cefFocusTarget })
			}
		}
		return apiResult(res)
	}

	if (path === '/api/cef-interactive/mouse') {
		const res = await forwardToCefTarget({
			config: ctx.config,
			sourceId: j.sourceId,
			type: String(j.type || 'mousedown'),
			x: j.x,
			y: j.y,
			button: j.button,
			coordsNormalized: j.coordsNormalized ?? j.normalized,
			log,
		}).catch((e) => ({ ok: false, status: 502, error: e?.message || String(e) }))
		return apiResult(res)
	}

	if (path === '/api/cef-interactive/keyboard') {
		const res = await forwardToCefTarget({
			config: ctx.config,
			sourceId: j.sourceId,
			type: String(j.type || 'keydown'),
			keysym: j.keysym,
			text: j.text,
			key: j.key,
			modifiers: j.modifiers,
			log,
		}).catch((e) => ({ ok: false, status: 502, error: e?.message || String(e) }))
		return apiResult(res)
	}

	if (path === '/api/cef-interactive/eval') {
		const res = await forwardToCefTarget({
			config: ctx.config,
			sourceId: j.sourceId,
			type: 'eval',
			expression: j.expression,
			log,
		}).catch((e) => ({ ok: false, status: 502, error: e?.message || String(e) }))
		return apiResult(res)
	}

	return null
}

/**
 * @param {string} path
 * @param {object} ctx
 */
function handleDelete(path, ctx) {
	if (path !== '/api/cef-interactive/focus') return null
	if (!bridgeEnabledInConfig(ctx.config || {})) return bridgeDisabled()
	const res = clearCefFocusOnly()
	ctx._cefFocusTarget = null
	notifyCefFocusChanged(typeof ctx.log === 'function' ? (level, msg) => ctx.log(level, msg) : undefined)
	if (typeof ctx._wsBroadcast === 'function') {
		ctx._wsBroadcast('change', { path: 'cefFocusTarget', value: null })
	}
	return apiResult(res)
}

module.exports = { handleGet, handlePost, handleDelete }
