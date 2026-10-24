'use strict'

/**
 * WO-732 P1 — one link, both sides. Two (or three) real cluster-peers instances on an in-memory network: linking makes
 * the other server link back, unlinking unlinks both, a half link is repaired on a poll (at most every HEAL_MS), an
 * unlink the other server missed leaves a tombstone so its repair drops its side, a server that needs sign-in shows
 * the link as one-way, and an older server (no `clusterLinked` in its ping) is asked once.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { HEAL_MS, TOMBSTONE_KEY } = require('../../src/cluster/cluster-peers')
const { fingerprint } = require('../../src/cluster/cluster-media')

const ROOT = path.join(__dirname, '..', '..')
const { lan } = require('./lib/cluster-lan')

describe('WO-732 P1 mutual link', () => {
	it('linking one server links both; the view says it is linked back', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		const r = await a.c.add({ address: '10.0.0.2' })
		assert.equal(r.status, 201)
		assert.deepEqual(r.body.link_back, { ok: true, error: '' })
		assert.deepEqual(net.ids(a), ['boxB'])
		assert.deepEqual(net.ids(b), ['boxA'], 'B lists A without anyone clicking on B')
		assert.equal(b.store.m.get('clusterPeers')[0].host, '10.0.0.1', 'B links A by the address A reaches it from')
		assert.equal(b.store.m.get('clusterPeers')[0].device_key, a.key, 'B recorded A’s identity (signed calls work both ways)')
		assert.deepEqual(b.calls, ['POST /api/cluster/peers'])
		assert.deepEqual(a.calls, [], 'B did not call back: link_back false')
		await a.c.poll()
		await b.c.poll()
		assert.equal(net.peerOf(a, 'boxB').linked_back, true)
		assert.equal(net.peerOf(b, 'boxA').linked_back, true)
		assert.equal(net.peerOf(a, 'boxB').link_back_error, '')
		net.stopAll()
	})

	it('unlinking on either server unlinks both', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		await a.c.add({ address: '10.0.0.2' })
		const r = await b.c.unlink('boxA')
		assert.deepEqual(r, { ok: true, link_back: { ok: true, error: '' } })
		assert.deepEqual(net.ids(a), [])
		assert.deepEqual(net.ids(b), [])
		assert.deepEqual(await a.c.unlink('boxB'), { ok: false }, 'nothing left to unlink')
		net.stopAll()
	})

	it('a half link (the WO-670 one-sided link, as found live) is repaired on a poll, at most every HEAL_MS', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		await a.c.add({ address: '10.0.0.2', link_back: false }) // A lists B, nobody asked B
		assert.deepEqual([net.ids(a), net.ids(b)], [['boxB'], []])
		await a.c.poll()
		assert.equal(net.peerOf(a, 'boxB').linked_back, false, 'seen one-way')
		net.clock.advance(HEAL_MS)
		await a.c.poll()
		assert.deepEqual(net.ids(b), ['boxA'], 'repaired')
		await a.c.poll()
		assert.equal(net.peerOf(a, 'boxB').linked_back, true)
		const n = b.calls.length
		await a.c.poll()
		assert.equal(b.calls.length, n, 'a linked peer is not asked again')
		net.stopAll()
	})

	it('an unlink the other server missed: its repair is refused and it drops its side; linking again clears that', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		await a.c.add({ address: '10.0.0.2' })
		b.up = false
		const r = await a.c.unlink('boxB')
		assert.equal(r.link_back.ok, false)
		assert.equal(a.store.m.get(TOMBSTONE_KEY)[0].fp, fingerprint(b.key))
		b.up = true
		net.clock.advance(HEAL_MS)
		await b.c.poll()
		assert.deepEqual([net.ids(a), net.ids(b)], [[], []], 'B dropped A instead of linking again')
		const again = await a.c.add({ address: '10.0.0.2' })
		assert.equal(again.body.link_back.ok, true, 'an operator link clears the tombstone')
		assert.deepEqual([net.ids(a), net.ids(b)], [['boxB'], ['boxA']])
		net.stopAll()
	})

	it('right after an unlink a racing repair is refused; an operator link on the other side survives its own repair', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		await a.c.add({ address: '10.0.0.2' })
		await a.c.unlink('boxB')
		const race = await a.c.add({ address: '10.0.0.2', link_back: false })
		assert.equal(race.status, 409)
		assert.equal(race.body.unlinked, true)
		const r = await b.c.add({ address: '10.0.0.1' })
		assert.equal(r.body.link_back.ok, false, 'refused within 2 × HEAL_MS of the unlink')
		net.clock.advance(HEAL_MS)
		await b.c.poll()
		assert.deepEqual(net.ids(b), ['boxA'], 'the operator’s link is kept')
		net.clock.advance(HEAL_MS)
		await b.c.poll()
		assert.deepEqual([net.ids(a), net.ids(b)], [['boxB'], ['boxA']], 'and linked both ways once the guard ran out')
		net.stopAll()
	})

	it('a server that needs sign-in: linked here, shown one-way with the reason', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		net.server('boxB', '10.0.0.2', { auth: true })
		const r = await a.c.add({ address: '10.0.0.2' })
		assert.equal(r.status, 201)
		assert.equal(r.body.link_back.ok, false)
		assert.match(r.body.link_back.error, /needs sign-in: link this server there/)
		await a.c.poll()
		assert.equal(net.peerOf(a, 'boxB').linked_back, false)
		assert.match(net.peerOf(a, 'boxB').link_back_error, /sign-in/)
		net.stopAll()
	})

	it('an older server (no clusterLinked) takes the link back through its plain add, and is asked once', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2', { old: true })
		await a.c.add({ address: '10.0.0.2' })
		assert.deepEqual(net.ids(b), ['boxA'])
		await a.c.poll()
		net.clock.advance(HEAL_MS * 3)
		await a.c.poll()
		assert.deepEqual(b.calls, ['POST /api/cluster/peers'], 'no repeat: its link state cannot be read')
		assert.equal(net.peerOf(a, 'boxB').linked_back, true, 'its add answered OK')
		net.stopAll()
	})

	it('three servers: each link is made once and every server lists the other two', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		const c = net.server('boxC', '10.0.0.3')
		await a.c.add({ address: '10.0.0.2' })
		await a.c.add({ address: '10.0.0.3' })
		await b.c.add({ address: '10.0.0.3' })
		assert.deepEqual([net.ids(a), net.ids(b), net.ids(c)], [['boxB', 'boxC'], ['boxA', 'boxC'], ['boxA', 'boxB']])
		net.stopAll()
	})

	it('wiring: the routes unlink through unlink(), the ping lists the linked servers, the port comes from config', () => {
		const routes = fs.readFileSync(path.join(ROOT, 'src/api/routes-cluster.js'), 'utf8')
		assert.ok(routes.includes("await clusterOf(ctx).unlink(params.id, { linkBack: String(query?.link_back ?? '') !== '0' })"))
		assert.ok(routes.includes('selfPort: () => ctx.config?.server?.httpPort'))
		const ping = fs.readFileSync(path.join(ROOT, 'src/api/routes-replication-get.js'), 'utf8')
		assert.ok(ping.includes("clusterLinked: require('../cluster/" + "cluster-peers').linkedFingerprints(")) // concat: not a require
	})
})
