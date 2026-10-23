'use strict'

/**
 * WO-712 R2 — the allow-list a linked server may run here over POST /api/cluster/call (cluster-call.js). Each one
 * goes through the same code as this server's own route, so a remote press is exactly a local press (owner D3):
 *
 *   look.take          { sceneId, target?: 'program'|'preview' }  → routes-scene-take-look.handleTakeLook
 *                      A follower does not take program itself (the follower PGM skip would drop it): it hands the
 *                      take to the master (callMaster), marked `relayed` so it is handed on at most once.
 *   tracking.auto.pin  { key, slot }                → the Auto director's POST /api/tracking/auto/pin (auto-routes.js)
 *   tracking.auto.slot { slot, heads?, ptz? }       → … /slot
 *   tracking.auto.home { after_s?, now? }           → … /home
 *   fixtures.look      { id, fade_ms? }             → POST /api/fixtures/looks/recall (routes-fixture-dmx.js)
 *   companion.press    { page, row, column }        → the zone action's Companion press (zone-actions.js)
 *
 * Every action answers { status, body } with body an object (a route's JSON text is parsed back).
 */

const NO_ENGINE = { error: 'fixture engine not running (tracking module off?)' }

const asObj = (r) => {
	if (!r || typeof r !== 'object') return { status: 200, body: { ok: true } }
	let body = r.body
	if (typeof body === 'string' || Buffer.isBuffer(body)) {
		try {
			body = JSON.parse(String(body))
		} catch {
			body = { text: String(body) }
		}
	}
	return { status: r.status || 200, body: body && typeof body === 'object' ? body : { ok: true } }
}

/**
 * @param {object} ctx  the server ctx (ctx.trackingAuto = the director, ctx.fixtureService = the follow service)
 * @param {{ callMaster: Function, isFollower: () => boolean, takeLook?: Function, runAction?: Function }} deps
 */
function createCallActions(ctx, deps) {
	const takeLook = deps.takeLook || ((b) => require('../api/routes-scene-take-look').handleTakeLook(b, ctx))
	const runAction = deps.runAction || ((a) => require('../tracking/zone-actions').runAction(a, ctx))
	const auto = (op) => async (args) => {
		const { handleAuto } = require('../tracking/auto-routes')
		return asObj(
			handleAuto(ctx?.trackingAuto || null, {
				method: 'POST',
				path: `/api/tracking/auto/${op}`,
				body: JSON.stringify(args),
			})
		)
	}
	return {
		'look.take': async (args) => {
			const sceneId = String(args.sceneId || '').trim()
			if (!sceneId) return { status: 400, body: { error: 'sceneId required' } }
			const target = args.target === 'preview' ? 'preview' : 'program'
			if (target === 'program' && !args.relayed && deps.isFollower()) {
				const r = await deps.callMaster('look.take', { sceneId, target, relayed: true })
				return {
					status: r.status || 502,
					body: r.json && typeof r.json === 'object' ? r.json : { error: r.error || 'master unreachable' },
				}
			}
			return asObj(await takeLook({ sceneId, target }))
		},
		'tracking.auto.pin': auto('pin'),
		'tracking.auto.slot': auto('slot'),
		'tracking.auto.home': auto('home'),
		'fixtures.look': async (args) => {
			const service = ctx?.fixtureService
			if (!service) return { status: 503, body: NO_ENGINE }
			const { handleRecallLook } = require('../api/routes-fixture-dmx')
			return asObj(handleRecallLook({ lookId: args.id, fade_ms: args.fade_ms }, service))
		},
		'companion.press': async (args) => {
			const [page, row, col] = [args.page, args.row, args.column].map(Number)
			if (![page, row, col].every((n) => Number.isInteger(n) && n >= 0 && n < 1000))
				return { status: 400, body: { error: 'page, row, column required (integers)' } }
			const r = await runAction({ type: 'companion', page, row, col })
			return { status: r.ok ? 200 : 502, body: { ok: !!r.ok, detail: r.detail } }
		},
	}
}

module.exports = { createCallActions }
