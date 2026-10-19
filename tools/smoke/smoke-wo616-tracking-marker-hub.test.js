'use strict'

/**
 * WO-616 T5: tracking marker hub (src/tracking/marker-hub.js) — OpenFollow's freshness rule (live < 1 s after the
 * last write, never-written = stale; openfollow/psn/marker.py @ 2f8aa257), speed from successive writes, input
 * validation — and the module plumbing: WS `tracking:marker` routed by the module registry's namespace hook, HTTP
 * markers API, `tracking:markers` broadcast, `ctx.trackingHub` for the WO-615 follow → Art-Net engine.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MarkerHub, MARKER_STALE_AFTER_MS } = require('../../src/tracking/marker-hub')
const registry = require('../../src/module-registry')

test('WO-616 T5: freshness, speed and validation', () => {
	let now = 10_000
	const hub = new MarkerHub({ now: () => now })
	assert.equal(MARKER_STALE_AFTER_MS, 1000, 'OpenFollow MARKER_STALE_AFTER_S = 1.0')
	assert.ok(hub.set({ id: 1, x: 1, y: 2, z: 0, name: 'Lead' }).ok)
	assert.equal(hub.list()[0].stale, false)
	now += 500
	const m = hub.set({ id: 1, x: 2, y: 2 }).marker
	assert.deepEqual([m.vx, m.vy, m.vz, m.name, m.z], [2, 0, 0, 'Lead', 0], '1 m in 0.5 s = 2 m/s; name and z kept')
	now += MARKER_STALE_AFTER_MS - 1
	assert.equal(hub.list()[0].stale, false, 'live just under 1 s')
	now += 1
	assert.equal(hub.list()[0].stale, true, 'stale at 1 s — still listed so a follow can hold')
	assert.equal(hub.staleKey(), '1')
	now += 5000
	assert.equal(hub.set({ id: 1, x: 3, y: 2 }).marker.vx, 0, 'no speed across a stale gap')
	for (const bad of [{ id: 0, x: 0, y: 0 }, { id: 1.5, x: 0, y: 0 }, { id: 70000, x: 0, y: 0 }, { id: 2, x: 'a', y: 0 },
		{ id: 2, x: NaN, y: 0 }, { id: 2, x: 600, y: 0 }]) {
		assert.equal(hub.set(bad).ok, false, JSON.stringify(bad))
	}
	assert.equal(hub.markers.size, 1, 'rejected writes leave no trace')
	const rev = hub.rev
	assert.equal(hub.remove(1), true)
	assert.equal(hub.rev, rev + 1)
})

test('WO-616 T5: tracking module — WS intake via the registry, HTTP API, broadcast, ctx.trackingHub', async () => {
	const mod = require('../../src/tracking/register')
	registry.register(mod)
	const sent = []
	const ctx = { _wsBroadcast: (event, data) => sent.push({ event, data }), log: () => {} }
	registry.bootOne('tracking', ctx)
	try {
		assert.equal(ctx.trackingHub, mod.hub)
		const replies = []
		const ws = { send: (s) => replies.push(JSON.parse(s)) }
		assert.equal(registry.handleWs(ws, ctx, { type: 'tracking:marker', data: { id: 7, x: 1.5, y: 3, z: 0, name: 'Singer' } }), true)
		assert.equal(registry.handleWs(ws, ctx, { type: 'tracking:marker', data: { markers: [{ id: 8, x: 0, y: 1 }, { id: -1, x: 0, y: 0 }] } }), true)
		assert.equal(replies.length, 1)
		assert.equal(replies[0].type, 'tracking:error')
		assert.equal(registry.handleWs(ws, ctx, { type: 'amcp', cmd: 'INFO' }), false, 'core messages stay with core')
		const get = await registry.handleApi('GET', '/api/tracking/markers', '', ctx)
		const list = JSON.parse(get.body).markers
		assert.deepEqual(list.map((m) => [m.id, m.name, m.source, m.stale]), [[7, 'Singer', 'operator', false], [8, 'Marker 8', 'operator', false]])
		const post = await registry.handleApi('POST', '/api/tracking/markers', JSON.stringify({ id: 9, x: -2, y: 4 }), ctx)
		assert.equal(post.status, 200)
		const last = sent[sent.length - 1]
		assert.equal(last.event, 'tracking:markers')
		assert.deepEqual(last.data.markers.map((m) => m.id), [7, 8, 9], 'a write broadcasts at once')
		assert.equal((await registry.handleApi('POST', '/api/tracking/markers', '{bad', ctx)).status, 400)
		assert.equal((await registry.handleApi('DELETE', '/api/tracking/markers/9', '', ctx)).status, 200)
		assert.equal((await registry.handleApi('DELETE', '/api/tracking/markers/9', '', ctx)).status, 404)
		assert.deepEqual(sent[sent.length - 1].data.markers.map((m) => m.id), [7, 8])
	} finally {
		await registry.shutdownOne('tracking')
		registry.unregister('tracking')
		for (const id of [7, 8, 9]) mod.hub.remove(id)
	}
	assert.equal(ctx.trackingHub, undefined, 'shutdown withdraws the hub')
})
