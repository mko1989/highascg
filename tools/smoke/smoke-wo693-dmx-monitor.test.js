'use strict'

/**
 * WO-693 — DMX viewer: ArtPoll / ArtPollReply / sACN discovery codec, the monitor's sources / nodes / frame, the
 * :6454 ownership hand-off through artnet-tap (own socket only while nothing owns it, yields when another opens), the
 * idle stop, and real datagrams on loopback test ports (never :6454 / 5568 — see artnet-out-loops-into-own-input).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const dgram = require('dgram')
const C = require('../../src/artnet/dmx-monitor-codec')
const { DmxMonitor, ipv4Interfaces } = require('../../src/artnet/dmx-monitor')
const { encodeArtDmx } = require('../../src/fixtures/artdmx')
const { encodeE131 } = require('../../src/fixtures/sacn')

function pollReply({ ip = [10, 0, 0, 7], net = 1, sub = 2, sw = [3, 4], types = [0x80, 0xc0], name = 'Node A', long = 'Node A long' } = {}) {
	const b = Buffer.alloc(239)
	b.write('Art-Net\0', 0, 'ascii')
	b.writeUInt16LE(0x2100, 8)
	Buffer.from(ip).copy(b, 10)
	b[18] = net
	b[19] = sub
	b.write(name, 26, 'latin1')
	b.write(long, 44, 'latin1')
	b.write('#0001 [0000] ok', 108, 'latin1')
	b.writeUInt16BE(sw.length, 172)
	types.forEach((t, i) => (b[174 + i] = t))
	sw.forEach((s, i) => {
		b[190 + i] = s
		b[186 + i] = s
	})
	Buffer.from([0, 1, 2, 3, 4, 5]).copy(b, 201)
	b[211] = 1
	return b
}

function discovery(universes, name = 'Console') {
	const b = Buffer.alloc(120 + universes.length * 2)
	b.writeUInt16BE(0x0010, 0)
	b.write('ASC-E1.17\0\0\0', 4, 'ascii')
	b.writeUInt32BE(8, 18)
	Buffer.alloc(16, 0xab).copy(b, 22)
	b.writeUInt32BE(2, 40)
	b.write(name, 44, 'utf8')
	b.writeUInt16BE(0x7000 | (8 + universes.length * 2), 112)
	b.writeUInt32BE(1, 114)
	universes.forEach((u, i) => b.writeUInt16BE(u, 120 + i * 2))
	return b
}

test('codec: ArtPoll, ArtPollReply ports, sACN discovery', () => {
	const poll = C.encodeArtPoll()
	assert.strictEqual(poll.length, 14)
	assert.strictEqual(poll.readUInt16LE(8), 0x2000)
	assert.strictEqual(poll.readUInt16BE(10), 14)
	const r = C.decodeArtPollReply(pollReply())
	assert.deepStrictEqual({ ...r }, { ip: '10.0.0.7', shortName: 'Node A', longName: 'Node A long', report: '#0001 [0000] ok',
		mac: '00:01:02:03:04:05', bindIndex: 1, outputs: [(1 << 8) | (2 << 4) | 3, (1 << 8) | (2 << 4) | 4], inputs: [(1 << 8) | (2 << 4) | 4] })
	assert.strictEqual(C.decodeArtPollReply(poll), null, 'an ArtPoll is not a reply')
	assert.strictEqual(C.decodeArtPollReply(Buffer.from('nope')), null)
	const d = C.decodeSacnDiscovery(discovery([1, 2, 7]))
	assert.deepStrictEqual(d.universes, [1, 2, 7])
	assert.strictEqual(d.sourceName, 'Console')
	assert.strictEqual(d.cid, 'ab'.repeat(16))
	assert.strictEqual(C.decodeSacnDiscovery(encodeE131({ universe: 1, data: new Uint8Array(4) })), null, 'a data packet is not discovery')
})

test('ipv4Interfaces: directed broadcast from the netmask, loopback skipped', () => {
	assert.deepStrictEqual(ipv4Interfaces({
		eno1: [{ family: 'IPv4', address: '192.168.0.23', netmask: '255.255.255.0', internal: false }],
		eno2: [{ family: 'IPv4', address: '2.0.0.13', netmask: '255.0.0.0', internal: false }, { family: 'IPv6', address: '::1' }],
		lo: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
	}), [{ address: '192.168.0.23', broadcast: '192.168.0.255' }, { address: '2.0.0.13', broadcast: '2.255.255.255' }])
})

function fakeTap(owners = 0) {
	const subs = new Set()
	return {
		subs,
		owners,
		publish: (m, r) => subs.forEach((f) => f(m, r)),
		subscribe: (f) => (subs.add(f), () => subs.delete(f)),
		ownerChanged(d) {
			this.owners += d
		},
		owned() {
			return this.owners > 0
		},
		count() {
			return this.owners
		},
	}
}

function fakeDgram() {
	const made = []
	return {
		made,
		createSocket() {
			const handlers = {}
			const s = {
				sent: [],
				joined: [],
				closed: false,
				on: (ev, fn) => ((handlers[ev] = fn), s),
				bind: (port, a, b) => {
					s.port = port
					const cb = typeof a === 'function' ? a : b
					setImmediate(() => {
						handlers.listening?.()
						cb?.()
					})
				},
				setBroadcast: () => {},
				send: (pkt, port, host, cb) => (s.sent.push([host, port, pkt.readUInt16LE(8)]), cb?.()),
				addMembership: (g, a) => s.joined.push([g, a]),
				dropMembership: (g, a) => (s.joined = s.joined.filter(([x, y]) => x !== g || y !== a)),
				close: () => (s.closed = true),
				emit: (ev, ...args) => handlers[ev]?.(...args),
			}
			made.push(s)
			return s
		},
	}
}

const tick = () => new Promise((r) => setImmediate(r))
const ifaces = () => [{ address: '192.168.0.23', broadcast: '192.168.0.255' }, { address: '2.0.0.13', broadcast: '2.255.255.255' },
	{ address: '100.101.245.97', broadcast: '100.101.245.97' }] // a /32 tunnel (tailscale0) is not polled

test('monitor: sources, nodes, frame; owns :6454 only while nothing else does', async () => {
	let t = 1000
	const tap = fakeTap(0)
	const dg = fakeDgram()
	const m = new DmxMonitor({ dgram: dg, tap, now: () => t, interfaces: ifaces })
	m.touch({ protocol: 'artnet', universe: 0x123 })
	await tick()
	const [own, sacn] = dg.made
	assert.strictEqual(own.port, 6454)
	assert.strictEqual(sacn.port, 5568)
	assert.strictEqual(tap.owners, 1, 'the viewer registered as the :6454 owner')
	const data = new Uint8Array(512)
	data[0] = 255
	data[511] = 7
	own.emit('message', encodeArtDmx({ portAddress: 0x123, data, sequence: 1 }), { address: '10.0.0.50' })
	own.emit('message', pollReply(), { address: '10.0.0.7' })
	own.emit('message', pollReply({ ip: [192, 168, 0, 23], name: 'me' }), { address: '192.168.0.23' })
	t += 100
	const s = m.snapshot()
	assert.strictEqual(s.artnet.listening, 'own')
	assert.deepStrictEqual(s.artnet.sources.map((x) => [x.ip, x.universes, x.packets, x.self]), [['10.0.0.50', [0x123], 1, false]])
	assert.deepStrictEqual(s.artnet.nodes.map((n) => [n.ip, n.shortName, n.self]), [['10.0.0.7', 'Node A', false], ['192.168.0.23', 'me', true]])
	assert.strictEqual(s.frame.universe, 0x123)
	assert.strictEqual(s.frame.data.length, 512)
	assert.deepStrictEqual([s.frame.data[0], s.frame.data[511], s.frame.from, s.frame.age_ms], [255, 7, '10.0.0.50', 100])
	assert.deepStrictEqual(m.poll(), ['192.168.0.255', '2.255.255.255'])
	assert.deepStrictEqual(own.sent.map(([h, p, op]) => [h, p, op]), [['192.168.0.255', 6454, 0x2000], ['2.255.255.255', 6454, 0x2000]],
		'ArtPoll only — never ArtDmx')
	tap.ownerChanged(1) // the lighting input opened :6454
	m._watch._onTimeout()
	assert.ok(own.closed, 'the viewer yields :6454 to the lighting input')
	assert.strictEqual(tap.owners, 1)
	assert.strictEqual(m.snapshot().artnet.listening, 'shared')
	tap.publish(encodeArtDmx({ portAddress: 0x123, data: new Uint8Array(512), sequence: 2 }), { address: '10.0.0.50' })
	assert.strictEqual(m.snapshot().frame.data[0], 0, 'frames keep arriving through the tap')
	m.stop()
	assert.ok(sacn.closed)
	assert.strictEqual(tap.subs.size, 0)
	assert.strictEqual(m.snapshot().frame, null, 'stop forgets everything')
})

test('monitor: a lighting input already on → no own socket; sACN joins the watched universe + discovery', async () => {
	const tap = fakeTap(1)
	const dg = fakeDgram()
	const m = new DmxMonitor({ dgram: dg, tap, interfaces: ifaces })
	m.touch({ protocol: 'sacn', universe: 3 })
	await tick()
	assert.strictEqual(dg.made.length, 1, 'only the sACN socket')
	const sacn = dg.made[0]
	assert.deepStrictEqual(sacn.joined.map(([g]) => g).sort(), ['239.255.0.3', '239.255.0.3', '239.255.0.3', '239.255.250.214', '239.255.250.214', '239.255.250.214'])
	m.touch({ protocol: 'sacn', universe: 4 })
	assert.deepStrictEqual(sacn.joined.map(([g]) => g).sort(), ['239.255.0.4', '239.255.0.4', '239.255.0.4', '239.255.250.214', '239.255.250.214', '239.255.250.214'])
	const data = new Uint8Array(512).fill(9)
	sacn.emit('message', encodeE131({ universe: 4, data, sourceName: 'Desk', priority: 120 }), { address: '10.0.0.60' })
	sacn.emit('message', discovery([4, 5, 64214], 'Desk 2'), { address: '10.0.0.61' })
	const s = m.snapshot()
	assert.deepStrictEqual([s.frame.source, s.frame.priority, s.frame.data[100]], ['Desk', 120, 9])
	assert.deepStrictEqual(s.sacn.sources.map((x) => [x.name, x.ip, x.universes]).sort(), [['Desk 2', '10.0.0.61', [4, 5]], ['Desk', '10.0.0.60', [4]]])
	m.stop()
	assert.strictEqual(tap.owners, 1, 'the lighting input stays the owner')
})

test('monitor: real datagrams on loopback test ports', async () => {
	const tap = fakeTap(0)
	const m = new DmxMonitor({ tap, artnetPort: 46454, sacnPort: 45568, interfaces: () => [{ address: '127.0.0.1', broadcast: '127.0.0.1' }] })
	m.touch({ protocol: 'artnet', universe: 5 })
	await new Promise((r) => setTimeout(r, 100))
	const tx = dgram.createSocket('udp4')
	const data = new Uint8Array(512)
	data[41] = 200
	await new Promise((r) => tx.send(encodeArtDmx({ portAddress: 5, data, sequence: 1 }), 46454, '127.0.0.1', r))
	await new Promise((r) => tx.send(encodeE131({ universe: 9, data, sourceName: 'Loop' }), 45568, '127.0.0.1', r))
	await new Promise((r) => setTimeout(r, 150))
	tx.close()
	const s = m.snapshot()
	assert.strictEqual(s.frame?.data[41], 200)
	assert.deepStrictEqual(s.sacn.sources.map((x) => [x.name, x.universes]), [['Loop', [9]]], 'unicast sACN is seen too')
	m.stop()
	assert.strictEqual(tap.owners, 0)
})
