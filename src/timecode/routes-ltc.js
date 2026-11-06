'use strict'

/**
 * WO-974 — LTC timecode API.
 *   GET  /api/ltc         status: libltc probe, normalized config, reader (tc, lock state), generator, chase
 *   POST /api/ltc/config  { ltc: {...} } or the ltc object itself — deep-merged over the stored section, persisted
 *                         (general.json) and the service restarted. Answers the new status.
 */

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('../api/response')
const { normalizeLtcConfig } = require('./ltc-config')

function merge(base, patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
	const out = { ...(base && typeof base === 'object' ? base : {}) }
	for (const [k, v] of Object.entries(patch)) {
		out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k], v) : v
	}
	return out
}

function ok(body) {
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(body) }
}

function getStatus(ctx) {
	const svc = ctx._ltcService
	return svc ? svc.status() : { libltc: null, config: normalizeLtcConfig(ctx.config?.ltc), input: null, output: null }
}

function handleConfigPost(body, ctx) {
	const parsed = parseBodyStrict(body)
	if (!parsed.ok) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: parsed.error }) }
	const v = parsed.value || {}
	const patch = v.ltc && typeof v.ltc === 'object' ? v.ltc : v
	const prev = normalizeLtcConfig(ctx.config?.ltc)
	const next = normalizeLtcConfig(merge(prev, patch), prev)
	if (ctx.config) ctx.config.ltc = next
	if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), ltc: next })
	ctx._ltcService?.restart()
	return ok(getStatus(ctx))
}

/** @param {import('../api/route-registry').RouteRegistry} routes */
function register(routes) {
	routes.get('/api/ltc', ({ ctx }) => ok(getStatus(ctx)), { requireCaspar: false })
	routes.post('/api/ltc/config', ({ body, ctx }) => handleConfigPost(body, ctx), { requireCaspar: false })
}

module.exports = { register, getStatus, merge }
