'use strict'

/**
 * WO-1088 — GET /api/health/keeping-up: the keeping-up summary (worst offender label, every check with target vs
 * measured, the last incidents); POST /api/health/keeping-up/report: a client's own check (its fps), which the server
 * journals and shows to the other clients. See keeping-up-service.js.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('../api/response')

const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })

function handleGet(ctx) {
	if (!ctx?.keepingUp) return reply(503, { error: 'keeping-up watch not running' })
	return reply(200, ctx.keepingUp.summary())
}

function handleReport(body, ctx) {
	if (!ctx?.keepingUp) return reply(503, { error: 'keeping-up watch not running' })
	const r = ctx.keepingUp.report(parseBody(body)) // route handlers get the raw JSON string
	return reply(r.ok ? 200 : 400, r)
}

function register(routes) {
	routes.get('/api/health/keeping-up', ({ ctx }) => handleGet(ctx), { requireCaspar: false })
	routes.post('/api/health/keeping-up/report', ({ body, ctx }) => handleReport(body, ctx), { requireCaspar: false })
}

module.exports = { register, handleGet, handleReport }
