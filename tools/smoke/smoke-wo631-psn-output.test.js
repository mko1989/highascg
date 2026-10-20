'use strict'

/**
 * WO-631 — PosiStageNet output: the wire format (chunk headers, packet header, tracker fields, splitting at 1500
 * bytes), the axis choice, the output.protocol / output.psn normalisation, and that "psn" stops the box's own
 * Art-Net pan/tilt while "artnet" (the backup) keeps it.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('events')
const { encodeData, encodeInfo, decode, toWire, PsnSender, MAX_PACKET } = require('../../src/fixtures/psn')
const { normalizePatch, normalizePsn } = require('../../src/fixtures/follow-patch')
const { FollowEngine } = require('../../src/fixtures/follow-engine')

const M = (id, o = {}) => ({ id, name: `M${id}`, x: 1, y: 2, z: 0.5, vx: 0.1, vy: 0.2, vz: 0, status: 1, ...o })

test('DATA: root 0x6755, header v2.0 + frame id, tracker pos / speed / status / timestamp', () => {
	const [p] = encodeData([M(3)], { frameId: 9, timestampUs: 5e6 })
	assert.strictEqual(p.readUInt16LE(0), 0x6755)
	assert.strictEqual(p.readUInt32LE(0) >>> 31, 1, 'root has subchunks')
	assert.strictEqual((p.readUInt32LE(0) >>> 16) & 0x7fff, p.length - 4, 'root data_len = rest of the packet')
	const d = decode(p)
	assert.deepStrictEqual(d.header, { timestampUs: 5e6, version: [2, 0], frameId: 9, packetCount: 1 })
	const t = d.trackers[3]
	assert.deepStrictEqual(t.pos.map((v) => +v.toFixed(4)), [1, 2, 0.5])
	assert.deepStrictEqual(t.speed.map((v) => +v.toFixed(4)), [0.1, 0.2, 0])
	assert.strictEqual(t.status, 1)
})

test('status: the hub validity, 0 while stale', () => {
	const d = decode(encodeData([M(1, { status: 0.25 }), M(2, { stale: true })])[0])
	assert.strictEqual(d.trackers[1].status, 0.25)
	assert.strictEqual(d.trackers[2].status, 0)
})

test('axes: stage sends the hub frame; y_up = (X, Z, −Y)', () => {
	assert.deepStrictEqual(toWire(M(1), 'stage').pos, [1, 2, 0.5])
	assert.deepStrictEqual(toWire(M(1), 'y_up').pos, [1, 0.5, -2])
	assert.deepStrictEqual(toWire(M(1), 'y_up').speed, [0.1, 0, -0.2])
})

test('INFO: system name + tracker names', () => {
	const d = decode(encodeInfo([M(1), { id: 4, x: 0, y: 0, z: 0 }], { systemName: 'Box A' })[0])
	assert.strictEqual(d.id, 0x6756)
	assert.strictEqual(d.systemName, 'Box A')
	assert.deepStrictEqual(d.trackers, { 1: { name: 'M1' }, 4: { name: 'Marker 4' } })
})

test('a frame over 1500 bytes splits; every packet carries the count and the same frame id', () => {
	const many = Array.from({ length: 80 }, (_, i) => M(i + 1))
	const ps = encodeData(many, { frameId: 200 })
	assert.ok(ps.length > 1)
	for (const p of ps) assert.ok(p.length <= MAX_PACKET)
	const ds = ps.map(decode)
	for (const d of ds) assert.deepStrictEqual([d.header.packetCount, d.header.frameId], [ps.length, 200])
	assert.strictEqual(ds.reduce((a, d) => a + Object.keys(d.trackers).length, 0), 80)
	assert.deepStrictEqual(encodeData([]), [], 'no markers → nothing to send')
})

test('normalisation: protocol defaults to psn; group must be multicast; iface an IPv4 or OS default', () => {
	assert.strictEqual(normalizePatch({}).protocol, 'psn')
	assert.strictEqual(normalizePatch({ output: { protocol: 'artnet' } }).protocol, 'artnet')
	assert.strictEqual(normalizePatch({ output: { protocol: 'sacn' } }).protocol, 'psn')
	assert.deepStrictEqual(normalizePsn({}), { group: '236.10.10.10', port: 56565, iface: '', system_name: 'HighAsCG', axes: 'stage' })
	assert.strictEqual(normalizePsn({ group: '10.0.0.1' }).group, '236.10.10.10', 'unicast refused')
	assert.strictEqual(normalizePsn({ group: '239.1.2.3' }).group, '239.1.2.3')
	assert.strictEqual(normalizePsn({ iface: 'eth0' }).iface, '')
	assert.strictEqual(normalizePsn({ iface: '192.168.1.20', axes: 'y_up' }).iface, '192.168.1.20')
})

test('engine: psn sends no Art-Net, artnet (backup) does', () => {
	const hub = { now: () => 0, list: () => [{ id: 1, x: 0, y: 3, z: 0, stale: false }] }
	const sent = []
	const eng = new FollowEngine({ hub, send: (to, p) => sent.push(p), now: () => 0 })
	const patch = [{ id: 'a', follow: 1, dest: '10.0.0.9', address: 1 }]
	eng.configure({ output: { enabled: true, protocol: 'psn' }, patch })
	assert.strictEqual(eng.tick(), 0)
	assert.strictEqual(eng.status().protocol, 'psn')
	eng.configure({ output: { enabled: true, protocol: 'artnet' }, patch })
	assert.strictEqual(eng.tick(), 1)
})

test('sender: DATA + INFO to the group through one socket; off closes it', () => {
	const out = []
	const sock = Object.assign(new EventEmitter(), {
		bind: (_p, cb) => cb(), setMulticastTTL() {}, setMulticastLoopback() {}, setMulticastInterface: (a) => out.push(['if', a]),
		send: (buf, port, host, cb) => (out.push([host, port, decode(buf)]), cb()), close: () => out.push(['closed']),
	})
	const hub = { now: () => 0, list: () => [M(1)] }
	const s = new PsnSender({ hub, socketFactory: () => sock })
	s.configure({ enabled: true, group: '236.10.10.10', port: 56565, iface: '10.1.1.5', system_name: 'T', axes: 'stage' })
	assert.strictEqual(s.tick('data'), 1)
	assert.strictEqual(s.tick('info'), 1)
	assert.deepStrictEqual(out[0], ['if', '10.1.1.5'])
	assert.deepStrictEqual([out[1][0], out[1][1], out[1][2].id], ['236.10.10.10', 56565, 0x6755])
	assert.strictEqual(out[2][2].systemName, 'T')
	assert.strictEqual(s.status().packets_sent, 2)
	s.configure({ enabled: false })
	assert.deepStrictEqual(out.at(-1), ['closed'])
	assert.strictEqual(s.tick('data'), 0)
})
