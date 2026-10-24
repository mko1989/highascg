'use strict'

/**
 * WO-739 — linking another server sends it an invite that its operator accepts or declines, unless that server
 * auto-accepts (Devices server page). Real cluster-peers.js + cluster-invites.js on the WO-732 fake LAN.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { HEAL_MS } = require('../../src/cluster/cluster-peers')
const { TTL_MS } = require('../../src/cluster/cluster-invites')
const { lan } = require('./lib/cluster-lan')

const ROOT = path.join(__dirname, '..', '..')

describe('WO-739 link invites', () => {
	it('a link waits as an invite on the other server; the linker shows it waiting', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1', { invites: true })
		const b = net.server('boxB', '10.0.0.2', { invites: true })
		const r = await a.c.add({ address: '10.0.0.2' })
		assert.equal(r.status, 201)
		assert.deepEqual(r.body.link_back, { ok: false, error: 'waiting for boxB to accept', pending: true })
		assert.deepEqual(net.ids(b), [], 'nothing is linked on B before its operator accepts')
		const inv = b.c.snapshot().invites
		assert.equal(inv.length, 1)
		assert.equal(inv[0].id, 'boxA')
		assert.equal(inv[0].host, '10.0.0.1')
		assert.equal(inv[0].device_key, undefined, 'clients never see the key')
		assert.equal(b.c.snapshot().self.auto_accept, false)
		await a.c.poll()
		assert.equal(net.peerOf(a, 'boxB').link_pending, true)
		assert.equal(net.peerOf(a, 'boxB').linked_back, false)
		net.stopAll()
	})

	it('accept links both ways and clears the invite', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1', { invites: true })
		const b = net.server('boxB', '10.0.0.2', { invites: true })
		await a.c.add({ address: '10.0.0.2' })
		const r = await b.c.accept('boxA')
		assert.equal(r.status, 201)
		assert.deepEqual(r.body.link_back, { ok: true, error: '' }, 'A already lists B: it takes the link at once')
		assert.deepEqual([net.ids(a), net.ids(b)], [['boxB'], ['boxA']])
		assert.deepEqual(b.c.snapshot().invites, [])
		await a.c.poll()
		assert.equal(net.peerOf(a, 'boxB').linked_back, true)
		assert.equal(net.peerOf(a, 'boxB').link_pending, false)
		assert.equal((await b.c.accept('boxA')).status, 404, 'an invite is accepted once')
		net.stopAll()
	})

	it('the linker’s repair renews the invite; an invite nobody renews lapses', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1', { invites: true })
		const b = net.server('boxB', '10.0.0.2', { invites: true })
		await a.c.add({ address: '10.0.0.2' })
		const first = b.c.snapshot().invites[0].asked_at
		net.clock.advance(HEAL_MS)
		await a.c.poll()
		assert.ok(b.c.snapshot().invites[0].asked_at > first, 'asked again a minute later')
		assert.equal(b.c.snapshot().invites[0].first_at, first)
		a.up = false
		net.clock.advance(TTL_MS + 1)
		assert.deepEqual(b.c.snapshot().invites, [], 'A went away: the invite lapsed')
		net.stopAll()
	})

	it('decline: the linker drops its side at once and its link-backs are refused until B links it', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1', { invites: true })
		const b = net.server('boxB', '10.0.0.2', { invites: true })
		await a.c.add({ address: '10.0.0.2' })
		const d = await b.c.decline('boxA')
		assert.deepEqual(d.body, { ok: true, told: true })
		assert.deepEqual([net.ids(a), net.ids(b)], [[], []])
		assert.deepEqual(b.c.snapshot().invites, [])
		const again = await a.c.add({ address: '10.0.0.2' })
		assert.equal(again.body.link_back.ok, false)
		assert.match(again.body.link_back.error, /declined/)
		assert.deepEqual(b.c.snapshot().invites, [], 'no new invite: B declined A')
		const fromB = await b.c.add({ address: '10.0.0.1' })
		assert.equal(fromB.body.link_back.ok, true, 'A still lists B (its operator linked it): it takes the link')
		assert.deepEqual([net.ids(a), net.ids(b)], [['boxB'], ['boxA']])
		net.stopAll()
	})

	it('decline while the linker is away: it drops its side at its next repair', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1', { invites: true })
		const b = net.server('boxB', '10.0.0.2', { invites: true })
		await a.c.add({ address: '10.0.0.2' })
		a.up = false
		assert.deepEqual((await b.c.decline('boxA')).body, { ok: true, told: false })
		a.up = true
		net.clock.advance(2 * HEAL_MS) // past the guard that keeps a fresh operator link
		await a.c.poll()
		assert.deepEqual(net.ids(a), [], 'refused as unlinked: A dropped B')
		net.stopAll()
	})

	it('auto-accept links at once (WO-732 behaviour)', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1', { invites: true })
		const b = net.server('boxB', '10.0.0.2', { invites: true })
		assert.deepEqual(b.c.setAutoAccept(true), { auto_accept: true })
		assert.equal(b.store.m.get('clusterAutoAccept'), true, 'device-local persistence')
		const r = await a.c.add({ address: '10.0.0.2' })
		assert.deepEqual(r.body.link_back, { ok: true, error: '' })
		assert.deepEqual([net.ids(a), net.ids(b)], [['boxB'], ['boxA']])
		assert.deepEqual(b.c.snapshot().invites, [])
		net.stopAll()
	})

	it('servers already linked both ways are not asked again; one linking a server already listing it links at once', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1', { invites: true })
		const b = net.server('boxB', '10.0.0.2', { invites: true })
		await a.c.add({ address: '10.0.0.2' })
		await b.c.accept('boxA')
		net.clock.advance(HEAL_MS)
		await a.c.poll()
		await b.c.poll()
		assert.deepEqual([a.c.snapshot().invites, b.c.snapshot().invites], [[], []])
		const relink = await a.c.add({ address: '10.0.0.2' })
		assert.equal(relink.body.link_back.ok, true, 'B lists A: a link-back to a listed server is no invite')
		net.stopAll()
	})

	it('wiring: routes, snapshot and the Devices client', () => {
		const routes = fs.readFileSync(path.join(ROOT, 'src/api/routes-cluster.js'), 'utf8')
		assert.ok(routes.includes("routes.post('/api/cluster/invites/:id/accept'"))
		assert.ok(routes.includes("routes.post('/api/cluster/invites/:id/decline'"))
		assert.ok(routes.includes("routes.post('/api/cluster/auto-accept'"))
		assert.ok(routes.includes('invites: createInvites({ persistence: ctx.persistence || defaultPersistence })'))
		const panel = fs.readFileSync(path.join(ROOT, 'godot/client/features/devices/cluster_panel.gd'), 'utf8')
		assert.ok(panel.includes('"/api/cluster/invites/%s/accept"'))
		assert.ok(panel.includes('"/api/cluster/invites/%s/decline"'))
		const page = fs.readFileSync(path.join(ROOT, 'godot/client/features/devices/server_page_model.gd'), 'utf8')
		assert.ok(page.includes('Auto-accept master invites'))
	})
})
