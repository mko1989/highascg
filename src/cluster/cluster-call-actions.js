'use strict'

/**
 * WO-712 R2 — the allow-list a linked server may run here over POST /api/cluster/call (cluster-call.js). Each one
 * goes through the same code as this server's own route, so a remote press is exactly a local press (owner D3):
 *
 *   look.take          { sceneId, target?: 'program'|'preview', mainIdx?, forceCut?, transitionOverride?, timersVisibility? }
 *                      → routes-scene-take-look.handleTakeLook
 *                      A follower does not take program itself on a screen the master drives here (WO-1029: the
 *                      master's fresh report lists it; the take would be refused): it hands the take to the master
 *                      (callMaster), marked `relayed` so it is handed on at most once. Any other screen is taken here.
 *                      WO-1029 2a (rule 4, look-relay.js): a backup screen → the master (1 s, else here + `diverged`);
 *                      a remote screen → the master, else an online owner, else 409 REMOTE_SCREEN; own → here.
 *                      A `relayed` take is always taken HERE (an owner never hands a relayed take on: no loops).
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
 * @param {{ callMaster: Function, isFollower: () => boolean, takeLook?: Function, runAction?: Function,
 *   heldFor?: (args: object) => object|null, call?: Function, owners?: Function, diverge?: Function }} deps
 */
function createCallActions(ctx, deps) {
	const takeLook = deps.takeLook || ((b) => require('../api/routes-scene-take-look').handleTakeLook(b, ctx))
	// WO-1029 B1: is this look's program screen driven by the master right now?
	const heldFor = deps.heldFor || ((a) => require('../api/routes-scene-take-look').airHeldForLook(a, ctx))
	const runAction = deps.runAction || ((a) => require('../tracking/zone-actions').runAction(a, ctx))
	const { relayLook } = require('./look-relay')
	const relayDepsOf = () => ({
		isFollower: deps.isFollower,
		callMaster: deps.callMaster,
		call: deps.call || (async () => ({ ok: false, status: 0, error: 'no call' })),
		owners: deps.owners || (() => []),
		diverge: deps.diverge || ((ch) => ctx?._clusterReport?.diverge?.(ch)),
		log: ctx?.log,
	})
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
			const { relayArgs } = require('../api/routes-scene-take-look')
			const held = target === 'program' && !args.relayed ? heldFor({ ...args, sceneId, target }) : null
			const routed = held ? await relayLook(relayArgs({ ...args, sceneId }), held, relayDepsOf()) : null
			if (routed && !routed.local) {
				const { viaMaster: _v, ...body } = routed.body // R2 answers the master's body as it was
				return { status: routed.status, body }
			}
			// WO-1026: the take's own options travel with it (a follower's relayed press keeps its cut / screen / transition);
			// `relayed` stays on a relayed take, so the take-look path here never hands it on again. WO-1029 2a: a diverged
			// backup take (the master did not answer) runs here as `relayed` too (decided once).
			const { relayed: _r, target: _t, ...opts } = relayArgs({ ...args, sceneId })
			const out = asObj(await takeLook({ ...opts, target, ...(args.relayed || routed ? { relayed: true } : {}) }))
			return routed && out.status < 400 ? { ...out, body: { ...out.body, diverged: true } } : out
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
