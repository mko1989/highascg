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
			case 'stop': {
				/* WO-552: this generic endpoint had two callers — the Timeline Editor's own explicit
				 * Stop button (a deliberate operator action, always allowed) and
				 * scenes-editor-preview-actions.js's incidental cleanup of "whatever timeline is
				 * open in the editor" on every look preview/take, REGARDLESS of whether that
				 * timeline happened to be the one actually live on program. The client has no way to
				 * know the server's routing state at the moment it fires — the server does, so the
				 * guarantee belongs here: stopping a timeline that is currently live on PROGRAM
				 * requires the caller to say so explicitly (`force: true`). Every incidental/ambient
				 * caller (previewing or taking an unrelated look) does not, and is now safely
				 * refused instead of silently taking PGM off air — the owner's own words, "PRV can't
				 * have an effect on PGM," is the acceptance test. */
				/* getPlayback() with NO id reflects the engine's actual current air timeline (and its
				 * live sendTo) — calling it WITH id would instead read that timeline's own stored
				 * sendTo even if it is no longer air, which could be stale and wrongly refuse a stop
				 * that is now perfectly safe. */
				const pbNow = typeof eng.getPlayback === 'function' ? eng.getPlayback() : null
				const isOnProgram = pbNow?.timelineId === id && !!pbNow?.sendTo?.program
				if (isOnProgram && b?.force !== true) {
					return {
						status: 409,
						headers: JSON_HEADERS,
						body: jsonBody({
							error: 'Timeline is live on program — refusing to stop without force:true',
							onProgram: true,
						}),
					}
				}
				eng.stop(id)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			}
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
