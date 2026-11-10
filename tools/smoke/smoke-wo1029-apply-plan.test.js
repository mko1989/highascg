'use strict'

/**
 * WO-1029 part 1 — one Apply button for every linked server that needs it, only those (src/cluster/cluster-apply.js).
 * Owner, 10.11: "… also with the harnes to not restart local machine when only dirty config for other box".
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { createClusterApply } = require('../../src/cluster/cluster-apply')

const ok = (o) => ({ status: 200, body: JSON.stringify(o) })

/**
 * self 'me' + peers. `dirty[id]` = what that server answers on /api/caspar-config/dirty
 * (true | false | 'old:aligned' | 'old:differs' | 'old:unknown' | 'down'); `fail[id]` = its apply fails.
 */
function rig({ selfDirty = false, master = 'me', peers = [], dirty = {}, fail = {} } = {}) {
	const calls = []
	const events = []
	const relay = async (method, id, p, body) => {
		calls.push(`${method} ${id} ${p}${body ? ` ${JSON.stringify(body)}` : ''}`)
		const d = dirty[id]
		if (d === 'down') return { status: 502, body: JSON.stringify({ error: `${id}: no answer (timeout)` }) }
		if (p === '/api/caspar-config/dirty') {
			if (String(d).startsWith('old')) return { status: 404, body: JSON.stringify({ error: 'Not found' }) }
			return ok({ dirty: !!d, reasons: d ? [{ code: 'unwritten', text: 'cables changed' }] : [], generatedAt: 1 })
		}
		if (p === '/api/state') {
			if (d === 'old:unknown') return ok({})
			return ok({ configComparison: { serverConfigDriven: true, aligned: d === 'old:aligned', issues: d === 'old:aligned' ? [] : ['Ch 2: DeckLink output is off'] } })
		}
		if (p === '/api/caspar-config/apply') {
			if (fail[id]) return { status: 502, body: JSON.stringify({ ok: false, error: 'Caspar did not come back' }) }
			return ok(String(d).startsWith('old') ? { ok: true, message: 'Caspar restarted' } : { ok: true, restored: { clips: [], ms: 120 }, restored_reason: '' })
		}
		return { status: 404, body: '{}' }
	}
	const a = createClusterApply({
		selfId: () => 'me',
		selfName: () => 'highascg7579',
		peers: () => peers.map((p) => ({ id: p, name: `box-${p}`, online: dirty[p] !== 'offline' })),
		masterId: () => master,
		localDirty: () => ({ dirty: selfDirty, reasons: selfDirty ? [{ code: 'pending', text: 'restart needed' }] : [] }),
		localApply: async (body) => {
			calls.push(`LOCAL apply ${JSON.stringify(body)}`)
			return fail.me ? { status: 502, body: JSON.stringify({ ok: false, error: 'local restart failed' }) } : ok({ ok: true, restored: { ms: 80 }, restored_reason: '' })
		},
		relay,
		screens: () => ({ me: ['LED wall'], b: ['Projector'] }),
		broadcast: (d) => events.push(d),
		now: () => 1000,
	})
	return { a, calls, events }
}

const applies = (calls) => calls.filter((c) => /apply/.test(c))

describe('WO-1029 GET /api/cluster/apply-plan', () => {
	it('each server says itself; followers first, the master last; screens per server', async () => {
		const { a } = rig({ peers: ['b', 'c'], dirty: { b: true, c: false } })
		const plan = await a.plan()
		assert.deepEqual(plan.map((r) => [r.id, r.master, r.dirty, r.apply]), [['b', false, true, true], ['c', false, false, false], ['me', true, false, false]])
		assert.deepEqual(plan[0].screens, ['Projector'])
		assert.equal(plan[0].reason, 'cables changed')
	})

	it('offline and older-build peers: offline → null; old build falls back to configComparison; unknown → null', async () => {
		const { a, calls } = rig({ master: 'b', peers: ['b', 'c', 'd', 'e'], dirty: { b: 'old:differs', c: 'offline', d: 'old:unknown', e: 'down' } })
		const plan = await a.plan()
		const by = Object.fromEntries(plan.map((r) => [r.id, r]))
		assert.deepEqual([by.b.build, by.b.dirty, by.b.apply], ['old', true, true])
		assert.deepEqual([by.c.online, by.c.dirty, by.c.reason], [false, null, 'offline'])
		assert.deepEqual([by.d.build, by.d.dirty, by.d.apply], ['old', null, false])
		assert.deepEqual([by.e.reachable, by.e.dirty], [false, null])
		assert.ok(!calls.some((c) => / c /.test(c)), 'an offline server is not even asked')
		assert.deepEqual(plan.map((r) => r.id), ['c', 'd', 'e', 'me', 'b'], 'the master (b) last')
	})
})

describe('WO-1029 POST /api/cluster/apply', () => {
	it('only the dirty server is applied; this box clean → NO local apply call at all', async () => {
		const { a, calls } = rig({ peers: ['b'], dirty: { b: true } })
		const r = await a.apply({})
		assert.equal(r.status, 200)
		assert.deepEqual(applies(calls), ['POST b /api/caspar-config/apply {"force":true}'])
		assert.ok(!calls.some((c) => c.startsWith('LOCAL')), 'the local Caspar is untouched')
		assert.deepEqual(r.body.results.map((x) => [x.id, x.applied, x.skipped, x.ok]), [['b', true, null, true], ['me', false, 'clean', true]])
		assert.deepEqual(r.body.results[0].restored, { clips: [], ms: 120 })
	})

	it('both dirty: the follower first, the master (this box) last', async () => {
		const { a, calls, events } = rig({ selfDirty: true, peers: ['b'], dirty: { b: true } })
		await a.apply({})
		assert.deepEqual(applies(calls), ['POST b /api/caspar-config/apply {"force":true}', 'LOCAL apply {"force":true}'])
		assert.deepEqual(events.map((e) => `${e.phase}${e.state ? `:${e.state}:${e.id}` : ''}`), ['start', 'server:applying:b', 'server:done:b', 'server:applying:me', 'server:done:me', 'done'])
	})

	it('a peer master is last too: this box before it', async () => {
		const { a, calls } = rig({ selfDirty: true, master: 'b', peers: ['b'], dirty: { b: true } })
		await a.apply({})
		assert.deepEqual(applies(calls), ['LOCAL apply {"force":true}', 'POST b /api/caspar-config/apply {"force":true}'])
	})

	it('offline / old-build-unknown peers are skipped with the reason; never applied by default', async () => {
		const { a, calls } = rig({ selfDirty: true, peers: ['c', 'd'], dirty: { c: 'offline', d: 'old:unknown' } })
		const r = await a.apply({})
		assert.deepEqual(applies(calls), ['LOCAL apply {"force":true}'])
		assert.deepEqual(r.body.results.map((x) => [x.id, x.skipped]), [['c', 'offline'], ['d', 'old build'], ['me', null]])
	})

	it('an old-build peer known dirty (configComparison) is applied; its answer has no snapshot', async () => {
		const { a } = rig({ peers: ['b'], dirty: { b: 'old:differs' } })
		const r = await a.apply({})
		assert.deepEqual([r.body.results[0].ok, r.body.results[0].restored, r.body.results[0].restored_reason], [true, null, 'older build: no air snapshot'])
	})

	it('one linked server failing does not stop the next; this box failing stops the rest', async () => {
		let { a, calls } = rig({ selfDirty: true, peers: ['b', 'c'], dirty: { b: true, c: true }, fail: { b: true } })
		let r = await a.apply({})
		assert.deepEqual(applies(calls).map((c) => c.split(' ')[1]), ['b', 'c', 'apply'])
		assert.equal(r.body.ok, false)
		assert.match(r.body.results[0].error, /did not come back/)
		;({ a, calls } = rig({ selfDirty: true, master: 'c', peers: ['c'], dirty: { c: true }, fail: { me: true } }))
		r = await a.apply({})
		assert.deepEqual(applies(calls), ['LOCAL apply {"force":true}'])
		assert.equal(r.body.results.find((x) => x.id === 'c').skipped, 'stopped')
	})

	it('a forced `servers` list is honoured: a clean named server is applied, the dirty unnamed one is not', async () => {
		const { a, calls } = rig({ selfDirty: false, peers: ['b', 'c'], dirty: { b: true, c: false } })
		const r = await a.apply({ servers: ['c', 'self'] })
		assert.deepEqual(applies(calls), ['POST c /api/caspar-config/apply {"force":true}', 'LOCAL apply {"force":true}'])
		assert.equal(r.body.results.find((x) => x.id === 'b').applied, false)
		assert.deepEqual((await a.apply({ servers: ['zz'] })).status, 400)
	})

	it('`force` also takes the online servers whose state is unknown', async () => {
		const { a, calls } = rig({ peers: ['d'], dirty: { d: 'old:unknown' } })
		await a.apply({ force: true })
		assert.deepEqual(applies(calls), ['POST d /api/caspar-config/apply {"force":true}'])
	})

	it('one run at a time; wait:false answers 202 and the status holds the run', async () => {
		const { a } = rig({ peers: ['b'], dirty: { b: true } })
		const p = a.apply({ wait: false })
		const second = await a.apply({})
		assert.equal(second.status, 409)
		const r = await p
		assert.equal(r.status, 202)
		await new Promise((res) => setTimeout(res, 10))
		assert.equal(a.status().running, false)
		assert.equal(a.status().run.results[0].id, 'b')
	})

	it('wired: routes, the relay keeps its long timeout for the apply', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-cluster.js'), 'utf8')
		assert.match(src, /routes\.get\('\/api\/cluster\/apply-plan'/)
		assert.match(src, /routes\.post\('\/api\/cluster\/apply'/)
		assert.match(src, /routes\.get\('\/api\/cluster\/apply\/status'/)
		assert.match(src, /_wsBroadcast\('cluster:apply', data\)/)
		const { relayPath } = require('../../src/cluster/cluster-relay')
		assert.deepEqual(relayPath('api/caspar-config/dirty'), { path: '/api/caspar-config/dirty' })
	})
})
