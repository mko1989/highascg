'use strict'

/**
 * WO-637 — GDTF Share (src/fixtures/gdtf-share.js):
 *   GET  /api/fixtures/share/account               → { user, set }  (the password is never returned)
 *   POST /api/fixtures/share/account {user, password} → store it (box-local, 0600)
 *   POST /api/fixtures/share/resolve {ids?}        → each placeholder without an alias → the real GDTF downloaded,
 *        stored and aliased (modes paired by footprint) → { results: [{ id, status, to?, modes?, candidates? }],
 *        offline?, error? }
 */

const share = require('../fixtures/gdtf-share')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })

async function handleResolve(body, ctx, deps = {}) {
	const b = parseBody(body) || {}
	try {
		const out = await share.resolve(Array.isArray(b.ids) ? b.ids : [], deps)
		if (out.results.some((r) => r.status === 'replaced')) ctx?.fixtureService?.reload?.()
		return reply(200, out)
	} catch (e) {
		return reply(502, { error: e.message })
	}
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/fixtures/share/account', () => reply(200, { user: share.account()?.user || '', set: !!share.account() }), opt)
	routes.post('/api/fixtures/share/account', ({ body }) => {
		const b = parseBody(body) || {}
		if (!String(b.user || '').trim() || !String(b.password || '')) return reply(400, { error: 'user and password required' })
		share.setAccount(String(b.user).trim(), String(b.password))
		return reply(200, { user: String(b.user).trim(), set: true })
	}, opt)
	routes.post('/api/fixtures/share/resolve', ({ body, ctx }) => handleResolve(body, ctx), opt)
}

module.exports = { register, handleResolve }
