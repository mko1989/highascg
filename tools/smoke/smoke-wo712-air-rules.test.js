'use strict'

/**
 * WO-712 R3b/R4 — react: "when look X goes on air → do Y" (src/tracking/air-rules.js), run by the zone service on
 * this server's program (src/cluster/air-state.js, hooked into live-scene-state broadcastSceneLive) and on a linked
 * playout server's (exchange topic `air`, cluster-exchange.js). In-process only: fake duties, a stubbed live store and
 * Companion fetch, never the box's persistence file or a real take.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createAirRules, normalizeAirRules, GUARD_MS } = require('../../src/tracking/air-rules')
const { parseAction, runAction } = require('../../src/tracking/zone-actions')
const { createZoneService } = require('../../src/tracking/zone-service')
const { createExchange, EXPIRE_MS } = require('../../src/cluster/cluster-exchange')
const liveSceneState = require('../../src/state/live-scene-state')
const airState = require('../../src/cluster/air-state')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
const flush = () => new Promise((r) => setImmediate(r))

/** Rules over a fake runner: { air, runs[], logs[], clock, on } (on = the zones duty). */
function rules(list) {
	const s = { runs: [], logs: [], clock: { t: 1_000_000 }, on: true }
	s.air = createAirRules({
		parse: parseAction,
		run: async (a) => (s.runs.push(a), { ok: true, detail: `ran ${a.type}` }),
		allowed: () => s.on,
		now: () => s.clock.t,
		log: (lvl, msg) => s.logs.push(`${lvl} ${msg}`),
	})
	s.air.configure(list)
	s.air.update('self', []) // the seed zone-service does at start
	return s
}
const look = (sceneId, name, channel = 1) => ({ channel, sceneId, name })

describe('WO-712 R4 on-air rules', () => {
	it('normalize: unique ids (taken / blank → airN), trimmed text, on by default, 64 at most', () => {
		const n = normalizeAirRules([
			{ id: 'x', when: ' Intro ', do: 'auto:home' },
			'junk',
			{ id: 'x', when: 'l3', enabled: false },
			{ when: 'a' },
		])
		assert.deepEqual(
			n.map((r) => r.id),
			['x', 'air2', 'air3']
		)
		assert.deepEqual(n[0], { id: 'x', when: 'Intro', do: 'auto:home', enabled: true })
		assert.equal(n[1].enabled, false)
		assert.equal(normalizeAirRules(Array.from({ length: 70 }, (_, i) => ({ when: `l${i}` }))).length, 64)
		assert.deepEqual(normalizeAirRules(null), [])
	})

	it('the grammar: auto:home and fixtures:<look id> are zone actions now', () => {
		assert.deepEqual(parseAction('auto:home'), { type: 'auto-home' })
		assert.deepEqual(parseAction('fixtures:look-2'), { type: 'fixtures', lookId: 'look-2' })
		assert.equal(parseAction('auto:away').type, 'invalid')
		assert.match(parseAction('auto:away').error, /auto:home \| fixtures:<look id>/)
	})

	it('a look newly on air fires its rules (by id, or by name ignoring case); staying on air fires once', async () => {
		const s = rules([
			{ when: 'look-1', do: 'auto:home' },
			{ when: 'intro', do: 'fixtures:look-9' },
			{ when: 'Other', do: 'auto:home' },
		])
		assert.equal(s.air.update('self', [look('look-1', 'x')]).length, 1)
		assert.equal(s.air.update('self', [look('look-1', 'x')]).length, 0, 'still on air')
		await Promise.all(s.air.update('self', [look('look-1', 'x'), look('look-7', 'INTRO', 2)]))
		assert.deepEqual(s.runs, [{ type: 'auto-home' }, { type: 'fixtures', lookId: 'look-9' }])
		assert.deepEqual(s.air.onAir(), { self: ['look-1', 'look-7'] })
		assert.equal(s.air.update('self', []).length, 0)
		const again = s.air.update('self', [look('look-1', 'x')])
		assert.equal(again.length, 1, 'off and on again fires again')
		await Promise.all(again)
		assert.equal(s.air.recent()[0].rule, 'air1')
	})

	it("a source's first update only records (a restart / a newly linked server with a look up fires nothing)", () => {
		const s = rules([{ when: 'look-1', do: 'auto:home' }])
		assert.equal(s.air.update('peer:P', [look('look-1', 'x')]).length, 0)
		assert.deepEqual(s.air.onAir(), { 'peer:P': ['look-1'] })
		assert.equal(s.air.update('peer:P', []).length, 0)
		assert.equal(s.air.update('peer:P', [look('look-1', 'x')]).length, 1)
	})

	it('disabled rules and blank / invalid actions do nothing; zones duty off → logged, not run', async () => {
		const s = rules([
			{ when: 'look-1', do: 'auto:home', enabled: false },
			{ when: 'look-1', do: '' },
			{ when: 'look-1', do: 'nope' },
			{ when: 'look-2', do: 'auto:home' },
		])
		assert.equal(s.air.update('self', [look('look-1', 'x')]).length, 0, 'off, blank and invalid rules fire nothing')
		await flush()
		assert.equal(s.runs.length, 0)
		s.on = false
		s.air.update('self', [])
		const [e] = await Promise.all(s.air.update('self', [look('look-2', 'y')]))
		assert.equal(s.runs.length, 0)
		assert.match(e.detail, /not run: zone actions are off/)
	})

	it("loop guard: the look a rule's own take put on air fires no rules for GUARD_MS", async () => {
		const s = rules([
			{ when: 'a', do: 'look:b' },
			{ when: 'b', do: 'look:a' },
		])
		await Promise.all(s.air.update('self', [look('a', 'A')]))
		assert.equal(s.runs.length, 1)
		assert.equal(s.air.update('self', [look('b', 'B')]).length, 0, 'b came from the rule → no ping-pong')
		s.clock.t += GUARD_MS + 1
		s.air.update('self', [])
		assert.equal(s.air.update('self', [look('b', 'B')]).length, 1, 'after the guard b fires again')
	})

	it('runAction: auto:home and fixtures say so when their engine is not running, else call it', async () => {
		assert.match((await runAction({ type: 'auto-home' }, {}, {})).detail, /auto director not running/)
		assert.match((await runAction({ type: 'fixtures', lookId: 'l' }, {}, {})).detail, /fixture engine not running/)
		const recalled = []
		const ctx = {
			fixtureService: { recallLook: (id, ms) => (recalled.push([id, ms]), id === 'l' ? { ok: true } : null) },
		}
		assert.deepEqual(await runAction({ type: 'fixtures', lookId: 'l' }, ctx, {}), { ok: true, detail: 'fixtures l' })
		const miss = await runAction({ type: 'fixtures', lookId: 'm' }, ctx, {})
		assert.equal(miss.ok, false)
		assert.match(miss.detail, /404 look m stores no fixture state/)
		assert.deepEqual(recalled, [
			['l', 0],
			['m', 0],
		])
	})
})

describe('WO-712 R4 zone service + local air state', () => {
	it('programLooks: every live channel but a preview bus, sorted, with the look name', (t) => {
		t.mock.method(liveSceneState, 'getAll', () => ({
			3: { sceneId: 'direct', scene: { name: 'D' } },
			2: { sceneId: 'p', scene: { name: 'Prv' } },
			1: { sceneId: 'look-1', scene: { name: 'Intro' } },
		}))
		assert.deepEqual(airState.programLooks({ config: {} }), [
			{ channel: 1, sceneId: 'look-1', name: 'Intro' },
			{ channel: 3, sceneId: 'direct', name: 'D' }, // neither program nor preview: a direct-program take (screenCount 0 box)
		])
	})

	it('seeds from what is on air at start, then fires on the next take; Companion over deps.fetch', async (t) => {
		const pressed = []
		let duty = true
		const ctx = { config: {}, log: () => {} }
		const project = { previs: { tracking: { zones: { list: [], on_air: [{ when: 'Intro', do: 'companion:1/2/3' }] } } } }
		const svc = createZoneService(
			ctx,
			{ list: () => [], now: () => 0 },
			{
				project,
				autostart: false,
				duties: { has: () => duty },
				programLooks: () => [look('look-1', 'Intro')],
				fetch: async (url) => (pressed.push(url), { ok: true, status: 200 }),
			}
		)
		t.after(() => svc.stop())
		assert.equal(ctx.zoneService, svc)
		assert.equal(svc.onAir('self', [look('look-1', 'Intro')]).length, 0, 'already on air at start')
		svc.onAir('self', [])
		await Promise.all(svc.onAir('self', [look('look-1', 'Intro')]))
		assert.equal(pressed.length, 1)
		assert.match(pressed[0], /\/api\/location\/1\/2\/3\/press$/)
		assert.deepEqual(svc.status().on_air.now, { self: ['look-1'] })
		duty = false
		svc.onAir('self', [])
		const [e] = await Promise.all(svc.onAir('self', [look('look-1', 'Intro')]))
		assert.match(e.detail, /not run/)
		assert.equal(pressed.length, 1)
		svc.stop()
		assert.equal(ctx.zoneService, undefined)
	})

	it('airChanged feeds the zone service and offers `air` only while servers are linked', (t) => {
		t.mock.method(liveSceneState, 'getAll', () => ({ 1: { sceneId: 'look-1', scene: { name: 'Intro' } } }))
		const seen = []
		const ctx = { config: {}, zoneService: { onAir: (src, looks) => seen.push([src, looks]) } }
		assert.deepEqual(airState.airChanged(ctx), [look('look-1', 'Intro')])
		assert.deepEqual(seen, [['self', [look('look-1', 'Intro')]]])
		assert.equal(ctx._clusterExchange, undefined, 'no cluster → no exchange started')
		assert.deepEqual(airState.airChanged({ config: {} }), [look('look-1', 'Intro')], 'no zone service is fine')
	})
})

describe('WO-712 R3b air exchange', () => {
	/** A server: duties + an exchange whose call goes straight to the other's info list. */
	function pair(mediaZones, trackZones) {
		const clock = { t: 5_000_000 }
		const n = {}
		for (const [id, zones, other] of [
			['M', mediaZones, 'T'],
			['T', trackZones, 'M'],
		]) {
			n[id] = { ws: [], data: [], duties: { zones } }
			n[id].ex = createExchange({
				peers: () => [{ id: other, name: `srv-${other}`, online: true, duties: n[other].duties }],
				has: (d) => !!n[id].duties[d],
				call: async (to, action, args) => {
					const r = await n[to].ex.info[action](JSON.parse(JSON.stringify(args)), { id, name: `srv-${id}` })
					return { ok: r.status < 300, status: r.status, json: r.body }
				},
				broadcast: (type, data) => n[id].ws.push([type, data]),
				onData: (topic, data, source) => n[id].data.push([topic, data, source.id]),
				now: () => clock.t,
				log: () => {},
			})
		}
		return { ...n, clock }
	}
	const AIR = { program: [look('look-1', 'Intro')] }

	it('from the server without zones to the one with zones; the receiver hears it once per change', async () => {
		const s = pair(false, true)
		assert.equal(s.T.ex.offer('air', AIR), 0, 'T has zones itself: sends nothing')
		assert.equal(s.M.ex.offer('air', AIR), 1)
		await flush()
		assert.deepEqual(s.T.data, [['air', AIR, 'M']])
		assert.deepEqual(s.T.ws, [['cluster:air', { ...AIR, source: { id: 'M', name: 'srv-M' } }]])
		s.clock.t += 6000
		s.M.ex.offer('air', AIR)
		await flush()
		assert.equal(s.T.data.length, 1, 'heartbeat with the same data: no new onData')
		assert.deepEqual(s.T.ex.latest('air'), { ...AIR, source: { id: 'M', name: 'srv-M' } })
	})

	it('gone for 15 s → onData hears it empty (its looks leave the air)', async () => {
		const s = pair(false, true)
		s.M.ex.offer('air', AIR)
		await flush()
		s.clock.t += EXPIRE_MS + 1
		s.T.ex.expire()
		assert.deepEqual(s.T.data[1], ['air', { program: [] }, 'M'])
		assert.equal(s.T.ws[1][1].gone, true)
	})

	it('a receiver without the zones duty refuses (409); nobody with zones → nothing is sent', async () => {
		const s = pair(false, false)
		assert.equal(s.M.ex.offer('air', AIR), 0)
		const r = await s.T.ex.info['exchange.air']({ data: AIR }, { id: 'M', name: 'srv-M' })
		assert.deepEqual([r.status, r.body.error], [409, 'zone actions are off on this server'])
	})

	it('wiring: broadcastSceneLive → airChanged; cluster poll heartbeat; onData → zone service; seed at start', () => {
		assert.match(read('src/state/live-scene-state.js'), /require\('\.\.\/cluster\/air-state'\)\.airChanged\(ctx\)/)
		const rc = read('src/api/routes-cluster.js')
		assert.match(
			rc,
			/afterPoll\(async \(\) => \{[\s\S]*?require\('\.\.\/cluster\/air-state'\)\.airChanged\(ctx\)[\s\S]*?\}\)/
		)
		assert.match(
			rc,
			/onData: \(topic, data, source\) => topic === 'air' && ctx\.zoneService\?\.onAir\(`peer:\$\{source\.id\}`, data\.program\)/
		)
		assert.match(
			read('src/tracking/zone-service.js'),
			/air\.update\('self', \(deps\.programLooks \|\| require\('\.\.\/cluster\/air-state'\)\.programLooks\)\(ctx\)\)/
		)
		assert.match(read('godot/client/features/previs/tracking/zones_section.gd'), /data\.on_air = list/)
		assert.match(
			read('godot/client/features/previs/tracking/zone_model.gd'),
			/"on_air": normalize_air\(z\.get\("on_air"\)\)/
		)
	})
})
