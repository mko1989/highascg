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
	assert.deepEqual(lines, ['ADD 1-741 SHM NAME pgm1'])
})

test('WO-597: REMOVE only when the LAST client stops leasing', async () => {
	const { m, lines } = rig()
	await m.lease('a', ['pgm1', 'prv1'])
	await m.lease('b', ['pgm1'])
	await m.lease('a', []) // a no longer needs anything
	assert.ok(lines.includes('REMOVE 2-742'), 'prv1 had only a → removed')
	assert.ok(!lines.includes('REMOVE 1-741'), 'pgm1 still leased by b')
	await m.lease('b', [])
	assert.ok(lines.includes('REMOVE 1-741'))
})

test('WO-597: a client that stops renewing loses its lease after the TTL (crash safety)', async () => {
	const { m, lines, advance } = rig()
	await m.lease('crashy', ['pgm2'])
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
	assert.deepEqual(r2.lines, ['ADD 1-741 SHM NAME pgm1', 'ADD 1-741 SHM NAME pgm1'])
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
