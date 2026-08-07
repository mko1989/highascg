/**
 * GET/POST/PUT/DELETE /api/timelines, /api/timelines/:id, /api/timelines/:id/:action
 * @see companion-module-casparcg-server/src/timeline-routes.js
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { runTimelineDirectTake } = require('../engine/timeline-take')
const { notifyTimelineReplication } = require('../replication/replication-hooks')

/**
 * @param {string} method
 * @param {string} path
 * @param {string} body
 * @param {object} ctx
 * @returns {Promise<object | null>}
 */
async function handleTimelineRoutes(method, path, body, ctx) {
	if (!path.startsWith('/api/timelines')) return null
	const eng = ctx?.timelineEngine
	if (!eng) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Timeline engine not ready' }) }
	}

	const b = parseBody(body)

	if (method === 'GET' && path === '/api/timelines') {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(eng.getAll()) }
	}

	if (method === 'POST' && path === '/api/timelines') {
		if (b.id && eng.get(b.id)) {
			const tl = eng.update(b.id, b)
			notifyTimelineReplication(ctx, b.id, tl)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(tl) }
		}
		const tl = eng.create(b)
		notifyTimelineReplication(ctx, tl.id, tl)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(tl) }
	}

	const m = path.match(/^\/api\/timelines\/([^/]+)(?:\/([^/]+))?$/)
	if (!m) return null
	const [, id, action] = m

	if (!action) {
		if (method === 'GET') {
			const tl = eng.get(id)
			return tl
				? { status: 200, headers: JSON_HEADERS, body: jsonBody(tl) }
				: { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Not found' }) }
		}
		if (method === 'PUT') {
			let tl = eng.update(id, b)
			if (!tl) {
				tl = eng.create({ ...b, id })
			}
			notifyTimelineReplication(ctx, id, tl)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(tl) }
		}
		if (method === 'DELETE') {
			eng.delete(id)
			notifyTimelineReplication(ctx, id, null, { deleted: true })
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
		}
	}

	if (method === 'POST') {
		switch (action) {
			case 'play': {
				const tl = eng.get(id)
				if (!tl) {
					return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Timeline not found' }) }
				}
				if (b.sendTo && typeof b.sendTo === 'object') eng.setSendTo(b.sendTo, id)
				eng.play(id, b.from != null ? Number(b.from) : null)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			}
			case 'take': {
				if (!ctx.amcp) {
					return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
				}
				if (!eng.get(id)) {
					return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Timeline not found' }) }
				}
				try {
					const result = await runTimelineDirectTake(ctx, eng, id, b)
					return { status: 200, headers: JSON_HEADERS, body: jsonBody(result) }
				} catch (err) {
					return {
						status: 500,
						headers: JSON_HEADERS,
						body: jsonBody({ error: err?.message || 'Take failed' }),
					}
				}
			}
			case 'pause':
				eng.pause(id)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			case 'stop':
				eng.stop(id)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			case 'seek': {
				const ms = b.ms != null ? Number(b.ms) : NaN
				if (Number.isNaN(ms) || ms < 0) {
					return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'ms required (number >= 0)' }) }
				}
				if (!eng.get(id)) {
					return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Timeline not found' }) }
				}
				eng.seek(id, ms)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			}
			case 'sendto': {
				if (!eng.get(id)) {
					return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Timeline not found' }) }
				}
				eng.setSendTo(b, id)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			}
			case 'loop':
				eng.setLoop(id, !!b.loop)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			default:
				break
		}
	}

	if (method === 'GET' && action === 'state') {
		if (!eng.get(id)) {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Timeline not found' }) }
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(eng.getPlayback(id)) }
	}

	return null
}

async function handle(method, path, body, ctx) {
	return handleTimelineRoutes(method, path, body, ctx)
}

module.exports = { handle, handleTimelineRoutes }
