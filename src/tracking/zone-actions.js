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
			if (action.target !== 'preview' && cluster?.isClusterFollower(ctx)) {
				// WO-712 R2: a follower's own PGM take is skipped (the master's fan-out drives air): the master takes it.
				const r = await cluster.callOf(ctx).callMaster('look.take', { sceneId: action.sceneId, target: 'program' })
				return { ok: !!r.ok, detail: `look ${action.sceneId} → master${r.ok ? '' : ` (${r.status} ${r.json?.error || r.error || ''})`}` }
			}
			const take = deps.takeLook || require('../api/routes-scene-take-look').handleTakeLook
			const r = await take({ sceneId: action.sceneId, target: action.target }, ctx)
			const ok = !r || !r.status || r.status < 400
			return { ok, detail: `look ${action.sceneId} → ${action.target}${ok ? '' : ` (${r.status} ${bodyError(r)})`}` }
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

function bodyError(r) {
	try {
		return JSON.parse(r.body).error || ''
	} catch (_) {
		return ''
	}
}

module.exports = { parseAction, runAction }
