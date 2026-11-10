'use strict'

/**
 * WO-1029 P1a — a linked server's identity survives an IP change (review 01, F1.1/F1.3/F1.4/F1.5).
 * Fake LAN (lib/cluster-lan.js): real cluster-peers.js + cluster-hello.js code, servers keyed by host:port.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { lan } = require('./lib/cluster-lan')
const { fingerprint } = require('../../src/cluster/cluster-media')
const { helloText, refuseHost, advertised, FRESH_MS } = require('../../src/cluster/cluster-hello')

/** A and B linked both ways (A links B; B auto-links back), then one poll each. */
async function linked() {
	const net = lan()
	const a = net.server('boxA', '10.0.0.1')
	const b = net.server('boxB', '10.0.0.2')
	const r = await a.c.add({ address: '10.0.0.2' })
	assert.equal(r.status, 201)
	await a.c.poll()
	await b.c.poll()
	assert.equal(net.peerOf(b, 'boxA').online, true)
	return { net, a, b }
}
const savedOf = (n, id) => n.store.m.get('clusterPeers').find((p) => p.id === id)

describe('WO-1029 P1a identity survives an IP change', () => {
	it('IP move with both directions up: the other server re-addresses it on the moved one\'s poll', async () => {
		const { net, a, b } = await linked()
		net.move('boxA', '10.0.0.36')
		net.clock.advance(FRESH_MS) // A's last hello (at the old address) is no longer fresh
		await b.c.poll() // B polls the old address: nothing there
		assert.equal(net.peerOf(b, 'boxA').online, false)
		await a.c.poll() // A reaches B and says where it is now
		assert.equal(net.peerOf(b, 'boxA').host, '10.0.0.36')
		assert.equal(savedOf(b, 'boxA').host, '10.0.0.36', 'persisted')
		await b.c.poll()
		const p = net.peerOf(b, 'boxA')
		assert.equal(p.online, true)
		assert.equal(p.reached_by, 'poll', 'B now reaches A itself')
		assert.deepEqual(net.ids(b), ['boxA'], 'still one entry')
		net.stopAll()
	})

	it('the incident: only the moved server reaches the other → re-addressed within one poll and shown online', async () => {
		const { net, a, b } = await linked()
		net.move('boxA', '10.0.0.36')
		net.block('boxB', 'boxA') // B cannot reach A at all
		net.clock.advance(FRESH_MS)
		await b.c.poll()
		assert.equal(net.peerOf(b, 'boxA').online, false)
		await a.c.poll()
		let p = net.peerOf(b, 'boxA')
		assert.equal(p.host, '10.0.0.36')
		assert.equal(p.online, true)
		assert.equal(p.last_seen, net.clock.now())
		assert.equal(p.reached_by, 'hello')
		net.clock.advance(5000)
		await b.c.poll() // B's own poll still fails: the fresh hello keeps A online
		p = net.peerOf(b, 'boxA')
		assert.equal(p.online, true)
		assert.equal(p.error, '')
		assert.deepEqual(a.calls, [], 'B asked A nothing (it cannot reach it): no link-back attempts')
		assert.equal(net.ids(b).length, 1)
		net.clock.advance(20000) // no hello for a while: offline again
		await b.c.poll()
		assert.equal(net.peerOf(b, 'boxA').online, false)
		net.stopAll()
	})

	it('a different server at the saved address → offline "another server answers", its data not taken', async () => {
		const { net, a, b } = await linked()
		net.move('boxA', '10.0.0.36')
		net.block('boxA', 'boxB') // the real A cannot announce itself
		const c = net.server('boxC', '10.0.0.1') // a stranger got A's old address
		c.ping = () => ({ appId: 'highascg', selfId: 'boxC', hostname: 'boxC', instanceId: 'i-boxC', fingerprint: fingerprint(c.key),
			projectMedia: { slug: 'other', fileCount: 9, signature: 'x' }, leaderEpoch: 99, clusterLinked: [] })
		await b.c.poll()
		const p = net.peerOf(b, 'boxA')
		assert.equal(p.online, false)
		assert.equal(p.error, 'another server answers at 10.0.0.1')
		assert.notEqual(p.hostname, 'boxC')
		assert.notEqual(p.epoch, 99)
		assert.equal(p.media?.slug, undefined)
		assert.deepEqual(net.ids(b), ['boxA'], 'no repair / unlink side effects')
		assert.equal(savedOf(b, 'boxA').device_key, a.key)
		net.stopAll()
	})

	const signAs = (key, body) => ({ ...body, sig: require('crypto').createHash('sha256').update(`${key}|${helloText(body)}`).digest('base64') })
	const YEAR = 365 * 24 * 3600 * 1000

	it('forged hellos (wrong key, replay, unknown sender, other receiver) are refused and change nothing', async () => {
		const { net, a, b } = await linked()
		const before = JSON.stringify(b.store.m.get('clusterPeers'))
		const base = { id: 'boxA', fp: fingerprint(a.key), to: fingerprint(b.key), address: '10.6.6.6:4200', ts: net.clock.now() + 10 * YEAR }
		assert.equal(b.c.hello(signAs('-----KEY mallory-----', base)).status, 403, 'wrong key')
		const replayed = b.c.hello(signAs(a.key, { ...base, ts: 1 })) // A's hellos were taken already: ts 1 is old
		assert.equal(replayed.status, 409, 'old ts = replay')
		assert.equal(replayed.body.last > 1, true)
		assert.equal(b.c.hello(signAs('-----KEY mallory-----', { ...base, fp: fingerprint('-----KEY mallory-----') })).status, 403, 'unknown sender')
		assert.equal(b.c.hello(signAs(a.key, { ...base, to: fingerprint('-----KEY boxZ-----') })).status, 400, 'for another server')
		assert.equal(b.c.hello({ ...base, sig: 'x' }).status, 403, 'bad signature')
		assert.equal(b.c.hello({ fp: 'nope' }).status, 400, 'malformed')
		assert.equal(JSON.stringify(b.store.m.get('clusterPeers')), before, 'nothing changed')
		// a genuine hello is taken once; the same bytes again are a replay
		const good = signAs(a.key, { ...base, address: '10.0.0.1:4200', ts: net.clock.now() + 1000 })
		assert.equal(b.c.hello(good).status, 200)
		assert.equal(b.c.hello(good).status, 409, 'replayed')
		assert.equal(JSON.stringify(b.store.m.get('clusterPeers')), before, 'same address: nothing to persist')
		net.stopAll()
	})

	it('no wall-clock window: a sender 2 years behind or ahead is taken; same or older ts is a replay', async () => {
		const { net, a, b } = await linked()
		const base = { id: 'boxA', fp: fingerprint(a.key), to: fingerprint(b.key), address: '10.0.0.1:4200' }
		b.hellos.length = 0
		// receiver B: highest A-ts so far is ≈ now (A's polls). 2 years behind fails only as a replay, not as "stale":
		const behind = b.c.hello(signAs(a.key, { ...base, ts: net.clock.now() - 2 * YEAR }))
		assert.equal(behind.status, 409)
		assert.equal(behind.body.error, 'replayed hello')
		// on a receiver with no floor yet, 2 years behind is accepted …
		const { net: n2, a: a2, b: b2 } = await (async () => {
			const n = lan()
			const x = n.server('boxA', '10.0.0.1')
			const y = n.server('boxB', '10.0.0.2')
			await x.c.add({ address: '10.0.0.2' }) // linked both ways, no poll yet: B has no floor for A
			return { net: n, a: x, b: y }
		})()
		const b2base = { ...base, fp: fingerprint(a2.key), to: fingerprint(b2.key) }
		assert.equal(b2.c.hello(signAs(a2.key, { ...b2base, ts: n2.clock.now() - 2 * YEAR })).status, 200, '2 years behind')
		assert.equal(b2.c.hello(signAs(a2.key, { ...b2base, ts: n2.clock.now() + 2 * YEAR })).status, 200, '2 years ahead')
		const same = signAs(a2.key, { ...b2base, ts: n2.clock.now() + 2 * YEAR })
		assert.equal(b2.c.hello(same).status, 409, 'same ts again')
		assert.equal(b2.c.hello(signAs(a2.key, { ...b2base, ts: n2.clock.now() + YEAR })).status, 409, 'older ts')
		// … and the real sender, now "behind" what B2 took (its clock went back), counts on above it: still heard
		b2.hellos.length = 0
		n2.clock.advance(5000)
		await a2.c.poll()
		assert.equal(b2.hellos.length, 2, 'refused once with the floor, resent once above it')
		assert.equal(n2.peerOf(b2, 'boxA').last_seen, n2.clock.now())
		await a2.c.poll()
		assert.equal(b2.hellos.length, 3, 'from then on one hello per poll')
		net.stopAll()
		n2.stopAll()
	})

	it('a node bound to one address advertises it; bound to all, the route source (sandbox aliases, real boxes)', () => {
		assert.equal(advertised('127.0.0.1', '127.0.1.11'), '127.0.1.11')
		assert.equal(advertised('192.168.0.36', '0.0.0.0'), '192.168.0.36')
		assert.equal(advertised('192.168.0.36', '::'), '192.168.0.36')
		assert.equal(advertised('192.168.0.36', ''), '192.168.0.36')
		assert.equal(advertised('192.168.0.36', undefined), '192.168.0.36')
	})

	it('a Tailscale or non-IPv4 address never replaces a LAN one; a saved name is kept', () => {
		assert.equal(refuseHost('192.168.0.10', '100.109.24.25'), 'a Tailscale address')
		assert.equal(refuseHost('100.70.0.1', '100.109.24.25'), '')
		assert.equal(refuseHost('192.168.0.10', '100.200.0.1'), '', '100.200 is not in 100.64/10')
		assert.equal(refuseHost('192.168.0.10', 'evil.example'), 'not an IPv4 address')
		assert.equal(refuseHost('box.local', '192.168.0.36'), 'the saved address is a name')
		assert.equal(refuseHost('192.168.0.10', '192.168.0.36'), '')
	})

	it('link-back overwrite without proof is refused (a different key at the new address)', async () => {
		const { net, b } = await linked()
		const m = net.server('boxA', '10.0.0.66', { key: '-----KEY mallory-----' }) // claims A's id, own key
		const r = await b.c.add({ address: '10.0.0.66', link_back: false })
		assert.equal(r.status, 409)
		assert.match(r.body.error, /another device identity/)
		const s = savedOf(b, 'boxA')
		assert.equal(s.host, '10.0.0.1')
		assert.equal(s.device_key, '-----KEY boxA-----')
		void m
		net.stopAll()
	})

	it('a link-back from the same key at a new address is still taken (proof = same device key)', async () => {
		const { net, a, b } = await linked()
		net.move('boxA', '10.0.0.36')
		const r = await b.c.add({ address: '10.0.0.36', link_back: false })
		assert.equal(r.status, 200)
		assert.equal(savedOf(b, 'boxA').host, '10.0.0.36')
		void a
		net.stopAll()
	})

	it('re-add under a new id with the same device key leaves one entry, updated in place', async () => {
		const { net, a, b } = await linked()
		const linkedAt = savedOf(b, 'boxA').added_at
		a.ping = ((orig) => () => ({ ...orig(), selfId: 'boxA2', hostname: 'boxA2' }))(a.ping) // renamed itself
		net.move('boxA', '10.0.0.37')
		const r = await b.c.add({ address: '10.0.0.37' })
		assert.equal(r.status, 200)
		assert.deepEqual(net.ids(b), ['boxA2'])
		assert.equal(b.store.m.get('clusterPeers').length, 1)
		assert.equal(savedOf(b, 'boxA2').host, '10.0.0.37')
		assert.equal(savedOf(b, 'boxA2').added_at, linkedAt)
		net.stopAll()
	})

	it('an older peer without the hello route (404): no errors, no repeat every poll, behaves as before', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2', { noHello: true })
		a.c.stop()
		await a.c.add({ address: '10.0.0.2' })
		await a.c.poll()
		await a.c.poll()
		assert.equal(b.hellos.length, 1, 'asked once, then left alone')
		const p = net.peerOf(a, 'boxB')
		assert.equal(p.online, true)
		assert.equal(p.error, '')
		assert.equal(p.linked_back, true)
		assert.equal(p.reached_by, 'poll', 'no fingerprint in its ping: not judged a stranger')
		net.stopAll()
	})

	it('wiring: the route, the auth exception, the ping fingerprint and the signer reach the service', () => {
		const fs = require('fs')
		const path = require('path')
		const root = path.join(__dirname, '..', '..')
		const routes = fs.readFileSync(path.join(root, 'src/api/routes-cluster.js'), 'utf8')
		assert.match(routes, /routes\.post\('\/api\/cluster\/hello'/)
		assert.match(routes, /sign: identity\.signMessage, \/\/ WO-1029/)
		assert.match(fs.readFileSync(path.join(root, 'src/server/auth.js'), 'utf8'), /p === '\/api\/cluster\/hello'\) return true/)
		assert.match(fs.readFileSync(path.join(root, 'src/api/routes-replication-get.js'), 'utf8'), /fingerprint: devicePingFingerprint\(\)/)
		const { isPublicApiPath } = require('../../src/server/auth')
		if (typeof isPublicApiPath === 'function') assert.equal(isPublicApiPath('POST', '/api/cluster/hello'), true)
	})
})
