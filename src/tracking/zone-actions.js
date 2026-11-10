'use strict'

/**
 * WO-616 T7 — what a trigger-zone transition fires. OpenFollow sends one OSC address per transition; this box has
 * no outbound OSC (PSN / OSC output dropped by the owner, T6), so a zone's four slots name an action instead:
 *
 *   look:<sceneId>            take that stored look to program (the WO-598 take-look path — no second take path);
 *                             on a cluster follower the master takes it (WO-712 R2 signed `look.take`, cluster-call.js)
 *   look:<sceneId>@preview    stage it on preview instead
 *   companion:<page>/<row>/<col>   press that Companion button (the timeline flag's HTTP press, WO-24 / WO-547)
 *   presenter                 WO-675: the actions of the presenter whose marker crossed (zone-service.js, presenters.js)
 *   auto:home                 WO-712 R4: send the Auto fronts home now (the director's POST /api/tracking/auto/home)
 *   fixtures:<lookId>         WO-712 R4: recall the fixture state stored in that look (POST /api/fixtures/looks/recall)
 *   ''                        nothing (the zone still tracks occupancy — OpenFollow's blank destination)
 */

const LOOK = /^look:([^@\s]+)(?:@(program|preview))?$/
const COMPANION = /^companion:(\d{1,3})\/(\d{1,3})\/(\d{1,3})$/
const FIXTURES = /^fixtures:(\S+)$/
const GRAMMAR = 'look:<id>[@preview] | companion:<page>/<row>/<col> | presenter | auto:home | fixtures:<look id>'

/** → null (blank) | { type: 'look', sceneId, target } | { type: 'companion', page, row, col } | { type: 'invalid', error } */
function parseAction(text) {
	const s = String(text ?? '').trim()
	if (!s) return null
	if (s === 'presenter') return { type: 'presenter' }
	if (s === 'auto:home') return { type: 'auto-home' }
	let m = LOOK.exec(s)
	if (m) return { type: 'look', sceneId: m[1], target: m[2] || 'program' }
	m = COMPANION.exec(s)
	if (m) return { type: 'companion', page: Number(m[1]), row: Number(m[2]), col: Number(m[3]) }
	m = FIXTURES.exec(s)
	if (m) return { type: 'fixtures', lookId: m[1] }
	return { type: 'invalid', error: `unknown action "${s}" (${GRAMMAR})` }
}

/**
 * Run one parsed action. → Promise<{ ok, detail }>; never throws.
 * @param {object} ctx  server ctx (config, log …)
 * @param {{ takeLook?: Function, fetch?: Function, cluster?: object }} [deps]  test seams (cluster: routes-cluster.js)
 */
async function runAction(action, ctx, deps = {}) {
	try {
		if (!action) return { ok: true, detail: 'none' }
		if (action.type === 'invalid') return { ok: false, detail: action.error }
		if (action.type === 'look') {
			const cluster = deps.cluster || (ctx?._clusterMaster ? require('../api/routes-cluster') : null)
			// WO-1029 Wave B: channels only where cabled — the take-look path itself sends the look to its screen's owner(s)
			// (dest.take, dest-route.js); the master / owner hand-over below is the flag-off path
			const viaDest = require('../cluster/dest-route').cwcOn(ctx)
			const routed = action.target !== 'preview' && cluster && !viaDest ? await routeLook(action, ctx, cluster, deps) : null
			if (routed && !routed.diverged) return routed
			const take = deps.takeLook || require('../api/routes-scene-take-look').handleTakeLook
			const r = await take({ sceneId: action.sceneId, target: action.target, ...(routed ? { relayed: true } : {}) }, ctx)
			const ok = !r || !r.status || r.status < 400
			const how = routed ? ' (the master did not answer: diverged)' : viaOf(r)
			return { ok, detail: `look ${action.sceneId} → ${action.target}${how}${ok ? '' : ` (${r.status} ${bodyError(r)})`}` }
		}
		if (action.type === 'companion') {
			const { resolveCompanionConfig } = require('../companion/companion-config')
			const { host, port } = resolveCompanionConfig(ctx?.config)
			const loc = `${action.page}/${action.row}/${action.col}`
			const res = await (deps.fetch || fetch)(`http://${host}:${port}/api/location/${loc}/press`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
			})
			return { ok: !!res.ok, detail: `companion ${loc} → ${res.status}` }
		}
		if (action.type === 'auto-home') {
			if (!ctx?.trackingAuto) return { ok: false, detail: 'auto home: auto director not running' }
			const body = JSON.stringify({ now: true })
			const r = require('./auto-routes').handleAuto(ctx.trackingAuto, { method: 'POST', path: '/api/tracking/auto/home', body })
			const ok = !!r && r.status < 400
			return { ok, detail: `auto home${ok ? '' : ` (${r?.status} ${bodyError(r || {})})`}` }
		}
		if (action.type === 'fixtures') {
			if (!ctx?.fixtureService) return { ok: false, detail: `fixtures ${action.lookId}: fixture engine not running` }
			const r = require('../api/routes-fixture-dmx').handleRecallLook({ lookId: action.lookId }, ctx.fixtureService)
			const ok = r.status < 400
			return { ok, detail: `fixtures ${action.lookId}${ok ? '' : ` (${r.status} ${bodyError(r)})`}` }
		}
		return { ok: false, detail: `unhandled action ${action.type}` }
	} catch (e) {
		return { ok: false, detail: String(e?.message || e) }
	}
}

/**
 * R3 — a zone's PROGRAM look on a linked server. WO-1029 2a (rule 4, src/cluster/look-relay.js) by the look's screen:
 * a backup screen → the master (no answer in 1 s → here, `diverged`); a remote screen → the master, else an online
 * owner, else refused; a screen cabled HERE → taken here. A screen nobody is known to own keeps WO-712 R2: a follower
 * hands it to the master (a tracking server usually has no screen of its own). → null (take here), `{ diverged }`, or
 * the zone result.
 */
async function routeLook(action, ctx, cluster, deps) {
	const look = require('../api/routes-scene-take-look')
	const b = { sceneId: action.sceneId, target: 'program' }
	const held = (deps.heldFor || ((x) => look.airHeldForLook(x, ctx)))(b)
	const done = (r, to) => ({ ok: r.status < 400, detail: `look ${action.sceneId} → ${to}${r.status < 400 ? '' : ` (${r.status} ${r.body?.error || ''})`}` })
	if (held) {
		const { relayLook, relayDeps } = require('../cluster/look-relay')
		const r = await relayLook(look.relayArgs(b), held, deps.relay || relayDeps(ctx, cluster))
		if (r?.local) return { diverged: true }
		return done(r, r.body?.via || 'master')
	}
	if (!cluster.isClusterFollower(ctx)) return null
	const here = cluster.ownershipOf ? cluster.ownershipOf(ctx).cabledHere(look.lookProgramChannel(b, ctx)) : false
	if (here) return null
	// WO-712 R2: the master takes it (and forwards it to the screen's owner)
	const r = await cluster.callOf(ctx).callMaster('look.take', b)
	return { ok: !!r.ok, detail: `look ${action.sceneId} → master${r.ok ? '' : ` (${r.status} ${r.json?.error || r.error || ''})`}` }
}

/** Wave B: ' → via highascg5867' when the take ran on other servers (dest-route.js `via`). */
function viaOf(r) {
	try {
		const via = JSON.parse(r.body).via
		return Array.isArray(via) && via.length ? ` via ${via.map((v) => v.name).join(', ')}` : ''
	} catch (_) {
		return ''
	}
}

function bodyError(r) {
	try {
		return JSON.parse(r.body).error || ''
	} catch (_) {
		return ''
	}
}

module.exports = { parseAction, runAction }
