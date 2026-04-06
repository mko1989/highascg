/**
 * GET/POST/PUT/DELETE /api/timelines, /api/timelines/:id, /api/timelines/:id/:action
 * @see companion-module-casparcg-server/src/timeline-routes.js
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const liveSceneState = require('../state/live-scene-state')
const { clearSceneProgramLookStackLayers } = require('../engine/scene-exit-layers')

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
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(eng.update(b.id, b)) }
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(eng.create(b)) }
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
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(tl) }
		}
		if (method === 'DELETE') {
			eng.delete(id)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
		}
	}

	if (method === 'POST') {
		switch (action) {
			case 'play':
				if (b.sendTo && typeof b.sendTo === 'object') eng.setSendTo(b.sendTo)
				eng.play(id, b.from != null ? Number(b.from) : null)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			case 'take': {
				const map = getChannelMap(ctx?.config || {})
				const screenIdx = Math.max(0, parseInt(b.screenIdx, 10) || 0)
				const programCh = map?.programCh?.(screenIdx + 1) ?? 1
				const previewCh = map?.previewCh?.(screenIdx + 1) ?? 2
				if (!ctx.amcp) {
					return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
				}
				const tl = eng.get(id)
				if (!tl) {
					return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Timeline not found' }) }
				}
				// Strip look stacks (1–99, 110–199) so timeline output (100+) is not covered by higher PGM layers.
				await clearSceneProgramLookStackLayers(ctx.amcp, programCh, ctx)
				await clearSceneProgramLookStackLayers(ctx.amcp, previewCh, ctx)

				const pb = eng.getPlayback()
				const pos = pb?.timelineId === id ? pb.position ?? 0 : 0
				eng.setSendTo({ preview: true, program: true, screenIdx })
				eng.setLoop(id, !!pb?.loop)
				eng.play(id, pos)
				await ctx.amcp.mixerCommit(programCh)
				await ctx.amcp.mixerCommit(previewCh)
				liveSceneState.clearChannel(programCh)
				liveSceneState.broadcastSceneLive(ctx)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
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
				eng.seek(id, ms)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			}
			case 'sendto':
				eng.setSendTo(b)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			case 'loop':
				eng.setLoop(id, !!b.loop)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			default:
				break
		}
	}

	if (method === 'GET' && action === 'state') {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(eng.getPlayback()) }
	}

	return null
}

async function handle(method, path, body, ctx) {
	return handleTimelineRoutes(method, path, body, ctx)
}

module.exports = { handle, handleTimelineRoutes }
