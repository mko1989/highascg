'use strict'

/**
 * WO-597: runtime shm video surfaces (declarative leases → AMCP ADD/REMOVE with reserved indices).
 * Fake AMCP + fake clock; no Caspar, no timers.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createVideoSurfaceManager, resolveRoleChannel, LEASE_TTL_MS } = require('../../src/system/video-surfaces')

const MAP = { programChannels: [1, 3], previewChannels: [2, 3] } // main 2 is PGM-only (prv == pgm)

function rig(opts = {}) {
	const lines = []
	let t = 1_000_000
	const amcp = {
		basic: {
			add: async (ch, consumer, params, idx) => lines.push(`ADD ${ch}-${idx} ${consumer} ${params}`),
			remove: async (ch, consumer, idx) => lines.push(`REMOVE ${ch}-${idx}`),
		},
	}
	const m = createVideoSurfaceManager({
		getAmcp: () => (opts.noAmcp ? null : amcp),
		getChannelMap: () => MAP,
		getOperatorSurface: opts.operator ? () => ({ role: 'opgui', channel: 5 }) : undefined,
		now: () => t,
		settleMs: 0,
	})
	return { m, lines, advance: (ms) => (t += ms) }
}

test('WO-597: role → channel (PGM-only main has no PRV surface; unknown roles rejected)', () => {
	assert.equal(resolveRoleChannel('pgm1', MAP), 1)
	assert.equal(resolveRoleChannel('prv1', MAP), 2)
	assert.equal(resolveRoleChannel('pgm2', MAP), 3)
	assert.equal(resolveRoleChannel('prv2', MAP), null, 'prv == pgm → not a separate surface')
	assert.equal(resolveRoleChannel('pgm3', MAP), null, 'no third main')
	assert.equal(resolveRoleChannel('ch1', MAP), null)
})

test('WO-597: first lease ADDs once with the reserved index; a second client adds nothing', async () => {
	const { m, lines } = rig()
	await m.lease('godot-a', ['pgm1'])
	await m.lease('godot-b', ['pgm1'])
	assert.deepEqual(lines, ['REMOVE 1-741', 'ADD 1-741 SHM NAME pgm1'], 'a leftover consumer on the index is cleared first')
})

test('WO-616 T9b: concurrent leases of one role share a single ADD (a second ADD unlinks the shm name)', async () => {
	const { m, lines } = rig()
	await Promise.all([m.lease('tracking-detect', ['pgm1']), m.lease('godot-a', ['pgm1']), m.lease('godot-b', ['pgm1', 'prv1'])])
	assert.deepEqual(lines.sort(), ['ADD 1-741 SHM NAME pgm1', 'ADD 2-742 SHM NAME prv1', 'REMOVE 1-741', 'REMOVE 2-742'])
	assert.equal(m.list().find((s) => s.role === 'pgm1').leases, 3)
})

test('WO-616 T9b: a role this manager removed itself is re-ADDed without another cleanup', async () => {
	const { m, lines } = rig()
	await m.lease('a', ['pgm1'])
	await m.lease('a', [])
	lines.length = 0
	await m.lease('a', ['pgm1'])
	assert.deepEqual(lines, ['ADD 1-741 SHM NAME pgm1'])
})

test('WO-597: REMOVE only when the LAST client stops leasing', async () => {
	const { m, lines } = rig()
	await m.lease('a', ['pgm1', 'prv1'])
	await m.lease('b', ['pgm1'])
	lines.length = 0 // the pre-ADD cleanup is not what this test is about
	await m.lease('a', []) // a no longer needs anything
	assert.ok(lines.includes('REMOVE 2-742'), 'prv1 had only a → removed')
	assert.ok(!lines.includes('REMOVE 1-741'), 'pgm1 still leased by b')
	await m.lease('b', [])
	assert.ok(lines.includes('REMOVE 1-741'))
})

test('WO-597: a client that stops renewing loses its lease after the TTL (crash safety)', async () => {
	const { m, lines, advance } = rig()
	await m.lease('crashy', ['pgm2'])
	lines.length = 0
	advance(LEASE_TTL_MS - 1)
	await m.sweep()
	assert.ok(!lines.includes('REMOVE 3-743'), 'still within TTL')
	advance(2)
	await m.sweep()
	assert.ok(lines.includes('REMOVE 3-743'), 'expired → removed')
})

test('WO-597: unknown / unresolvable roles never reach AMCP', async () => {
	const { m, lines } = rig()
	await m.lease('a', ['prv2', 'pgm4', 'bogus', '../x'])
	assert.deepEqual(lines, [])
})

test('WO-597: Caspar reconnect re-ADDs every leased role; no AMCP = deferred until ready', async () => {
	const r = rig({ noAmcp: true })
	await r.m.lease('a', ['pgm1'])
	assert.deepEqual(r.lines, [], 'nothing sent while Caspar is down')
	const r2 = rig()
	await r2.m.lease('a', ['pgm1'])
	await r2.m.onCasparReady()
	assert.deepEqual(r2.lines, ['REMOVE 1-741', 'ADD 1-741 SHM NAME pgm1', 'REMOVE 1-741', 'ADD 1-741 SHM NAME pgm1'],
		'unknown Caspar state (start, reconnect) → clear the index, then ADD — never ADD over a live consumer')
})

test('WO-597: list() exposes the configured operator surface + runtime roles with segment paths', async () => {
	const { m } = rig({ operator: true })
	await m.lease('a', ['pgm1'])
	const list = m.list()
	const op = list.find((s) => s.kind === 'operator')
	assert.equal(op.role, 'opgui')
	assert.equal(op.path, '/dev/shm/highascg-opgui')
	assert.equal(op.index, 740)
	const pgm1 = list.find((s) => s.role === 'pgm1')
	assert.equal(pgm1.active, true)
	assert.equal(pgm1.leases, 1)
	assert.equal(pgm1.channel, 1)
	assert.equal(pgm1.shm, '/highascg-pgm1')
})

test('WO-597: lease route parses a raw JSON body (HTTP layer passes strings) and requires clientId', async () => {
	const routes = require('../../src/api/routes-video-surfaces')
	const ctx = { config: {}, amcp: null }
	const bad = await routes.handleLease('{"roles":["pgm1"]}', ctx)
	assert.equal(bad.status, 400)
	const good = await routes.handleLease('{"clientId":"t","roles":["pgm1"]}', ctx)
	assert.equal(good.status, 200)
	assert.ok(JSON.parse(good.body).surfaces.some((s) => s.role === 'pgm1'))
})

test('WO-616 T1: inN = DeckLink input N\'s own channel, chN = any channel Caspar has; reserved indices', async () => {
	const { roleIndex } = require('../../src/system/video-surfaces')
	const map = {
		...MAP,
		inputChannels: [{ kind: 'decklink', slot: 1, channel: 6 }, { kind: 'live_audio', slot: 1, channel: 7 }, { kind: 'decklink', slot: 2, channel: 8 }],
		channelResolutionsByChannel: { 1: {}, 2: {}, 3: {}, 6: {}, 7: {}, 8: {} },
	}
	assert.equal(resolveRoleChannel('in1', map), 6)
	assert.equal(resolveRoleChannel('in2', map), 8, 'by DeckLink slot, not by inputChannels position')
	assert.equal(resolveRoleChannel('in3', map), null, 'no third DeckLink input')
	assert.equal(resolveRoleChannel('ch7', map), 7)
	assert.equal(resolveRoleChannel('ch9', map), null, 'a channel Caspar does not have')
	assert.equal(resolveRoleChannel('ch1', MAP), null, 'no channel list → nothing')
	assert.deepEqual(['pgm1', 'prv4', 'in1', 'in16', 'ch1', 'ch99'].map(roleIndex), [741, 748, 751, 766, 801, 899])
	for (const bad of ['in0', 'in17', 'ch0', 'ch100', 'ch01', 'in1x', 'opgui']) assert.equal(roleIndex(bad), null, bad)

	const lines = []
	const m = createVideoSurfaceManager({
		getAmcp: () => ({ basic: { add: async (ch, c, p, i) => lines.push(`ADD ${ch}-${i} ${c} ${p}`), remove: async (ch, c, i) => lines.push(`REMOVE ${ch}-${i}`) } }),
		getChannelMap: () => map,
		now: () => 1,
		settleMs: 0,
	})
	await m.lease('g', ['in2', 'ch7', 'ch9'])
	assert.deepEqual(lines, ['REMOVE 8-752', 'ADD 8-752 SHM NAME in2', 'REMOVE 7-807', 'ADD 7-807 SHM NAME ch7'])
	const roles = m.list().map((s) => s.role)
	assert.ok(roles.includes('in1') && roles.includes('in2'), 'every DeckLink input is announced')
	assert.ok(roles.includes('ch7') && !roles.includes('ch1'), 'chN only while leased')
	lines.length = 0
	await m.lease('g', [])
	assert.ok(lines.includes('REMOVE 8-752') && lines.includes('REMOVE 7-807'))
	assert.ok(!m.list().some((s) => s.role === 'ch7'), 'released chN drops out of the list')
})
