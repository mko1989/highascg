'use strict'

/**
 * WO-1029 plan 07 C0 — capabilities travel by ping and by signed hello, are live-only, and gate per link.
 * Fake LAN (lib/cluster-lan.js): real cluster-peers.js + cluster-hello.js + cluster-caps.js.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { lan } = require('./lib/cluster-lan')
const { supported, RESERVED, SUPPORTED, normalize } = require('../../src/cluster/cluster-caps')
const { FRESH_MS } = require('../../src/cluster/cluster-hello')
const { createClusterApply } = require('../../src/cluster/cluster-apply')

async function pair(bo = {}, ao = {}) {
	const net = lan()
	const a = net.server('boxA', '10.0.0.1', ao)
	const b = net.server('boxB', '10.0.0.2', bo)
	assert.equal((await a.c.add({ address: '10.0.0.2' })).status, 201)
	await a.c.poll()
	await b.c.poll()
	return { net, a, b }
}

describe('WO-1029 C0 capabilities', () => {
	it('registry: reserved names are not advertised; normalize drops junk', () => {
		for (const r of RESERVED) assert.ok(!SUPPORTED.includes(r), r)
		assert.deepEqual(supported(), [...SUPPORTED].sort())
		assert.deepEqual(normalize(['b', 'a', 'a', 5, 'Bad Name', null]), ['a', 'b'])
		assert.deepEqual(normalize(undefined), [])
	})

	it('caps reach the peer by ping; the view carries self.caps and peers[].caps', async () => {
		const { net, a } = await pair({ caps: ['apply', 'x-new'] })
		assert.deepEqual(a.c.peerCaps('boxB'), ['apply', 'x-new'])
		assert.equal(a.c.peerHas('boxB', 'x-new'), true)
		assert.equal(a.c.peerHas('boxB', 'hello'), false)
		const snap = a.c.snapshot()
		assert.deepEqual(snap.peers[0].caps, ['apply', 'x-new'])
		assert.deepEqual(snap.self.caps, supported())
		net.stopAll()
	})

	it('caps reach a peer reached only by hello', async () => {
		const { net, a, b } = await pair()
		net.block('boxB', 'boxA') // B cannot poll A; A's hello still reaches B
		net.clock.advance(FRESH_MS)
		await b.c.poll()
		await a.c.poll()
		const p = net.peerOf(b, 'boxA')
		assert.equal(p.reached_by, 'hello')
		assert.deepEqual(p.caps, supported())
		net.stopAll()
	})

	it('an old peer (no caps) → []', async () => {
		const { net, a } = await pair({ caps: null })
		assert.deepEqual(a.c.peerCaps('boxB'), [])
		assert.equal(a.c.peerHas('boxB', 'hello'), false)
		const { net: n2, a: a2 } = await pair({ old: true })
		assert.deepEqual(a2.c.peerCaps('boxB'), [])
		net.stopAll()
		n2.stopAll()
	})

	it('caps are replaced when the peer comes back on another build, and cleared while offline', async () => {
		const { net, a, b } = await pair({ caps: ['apply'] })
		assert.deepEqual(a.c.peerCaps('boxB'), ['apply'])
		b.up = false
		net.clock.advance(FRESH_MS) // B's last hello no longer keeps it online
		await a.c.poll()
		assert.equal(net.peerOf(a, 'boxB').online, false)
		assert.deepEqual(a.c.peerCaps('boxB'), [])
		assert.deepEqual(net.peerOf(a, 'boxB').caps, [])
		b.up = true
		b.caps = ['apply', 'hello', 'x-new']
		await a.c.poll()
		assert.deepEqual(a.c.peerCaps('boxB'), ['apply', 'hello', 'x-new'])
		b.caps = null // rolled back to a build before caps
		await a.c.poll()
		assert.deepEqual(a.c.peerCaps('boxB'), [])
		const stored = JSON.stringify(a.store.m.get('clusterPeers'))
		assert.ok(!/caps/.test(stored), 'never persisted')
		net.stopAll()
	})

	it('allPeersHave: one old peer / one offline peer are listed missing', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		const c = net.server('boxC', '10.0.0.3', { caps: null })
		const d = net.server('boxD', '10.0.0.4')
		for (const ip of ['10.0.0.2', '10.0.0.3', '10.0.0.4']) await a.c.add({ address: ip })
		await a.c.poll()
		assert.deepEqual(a.c.allPeersHave('apply').missing.map((m) => [m.id, m.reason]), [['boxC', 'no apply']])
		d.up = false
		await a.c.poll()
		const r = a.c.allPeersHave('apply')
		assert.equal(r.ok, false)
		assert.deepEqual(r.missing.map((m) => [m.id, m.name, m.reason]).sort(), [['boxC', 'boxC', 'no apply'], ['boxD', 'boxD', 'offline']].sort())
		assert.equal(a.c.allPeersHave('nobody-has-this').ok, false)
		c.caps = supported()
		d.up = true
		await a.c.poll()
		assert.deepEqual(a.c.allPeersHave('apply'), { ok: true, missing: [] })
		void b
		net.stopAll()
	})

	it('apply plan build field: caps-less old/current/unknown classified as before; caps without apply skips the probe', async () => {
		const answers = { cur: { status: 200, body: JSON.stringify({ dirty: true, reasons: [] }) }, unk: { status: 403, body: JSON.stringify({ error: 'no' }) } }
		const calls = []
		const mk = (caps) => createClusterApply({
			selfId: () => 'me', selfName: () => 'me', masterId: () => 'me',
			peers: () => ['cur', 'unk', 'old'].map((id) => ({ id, name: id, online: true })),
			peerCaps: (id) => caps[id] || [],
			localDirty: () => ({ dirty: false, reasons: [] }), localApply: async () => ({ status: 200, body: '{}' }),
			relay: async (m, id, p) => {
				calls.push(`${id} ${p}`)
				if (p === '/api/state') return { status: 200, body: JSON.stringify({ configComparison: { serverConfigDriven: true, aligned: true, issues: [] } }) }
				return answers[id] || { status: 404, body: '{}' }
			},
			screens: () => ({}), now: () => 1,
		})
		const builds = async (a) => Object.fromEntries((await a.plan()).map((r) => [r.id, r.build]))
		assert.deepEqual(await builds(mk({})), { cur: 'current', unk: 'unknown', old: 'old', me: 'current' })
		calls.length = 0
		assert.deepEqual(await builds(mk({ cur: ['apply'], unk: ['apply'], old: ['hello'] })), { cur: 'current', unk: 'unknown', old: 'old', me: 'current' })
		assert.ok(!calls.includes('old /api/caspar-config/dirty'), 'no probe of a peer that advertises caps without apply')
	})
})
