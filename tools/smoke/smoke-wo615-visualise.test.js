'use strict'

/**
 * WO-615 T7 — visualiser mode: `fixtures.dmx.visualise` (+ sacn_port) normalized; while on, the engine never sends a
 * typed universe (even with the master on and the universe listed); the sACN input (dmx-input.js SacnFrames) takes
 * real E1.31 datagrams for the patched universes only and goes stale; inputFrame picks the console frame by
 * protocol (Art-Net via follow-through.js ConsoleFrames) and is dark without one. Fixture: test-spot.xml.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const dgram = require('dgram')
const fs = require('fs')
const path = require('path')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { normalizeDmx } = require('../../src/fixtures/gdtf-patch')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { ConsoleFrames } = require('../../src/fixtures/follow-through')
const { SacnFrames, inputFrame, ZERO } = require('../../src/fixtures/dmx-input')
const { encodeE131 } = require('../../src/fixtures/sacn')
const { encodeArtDmx } = require('../../src/fixtures/artdmx')

const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const TYPE = 'dddddddddddd'

test('normalizeDmx: visualise off and sACN input on 5568 by default; port clamped to 1024–65535', () => {
	assert.deepStrictEqual([normalizeDmx().visualise, normalizeDmx().sacn_port], [false, 5568])
	assert.deepStrictEqual([normalizeDmx({ visualise: true, sacn_port: 5569 }).visualise, normalizeDmx({ sacn_port: 5569 }).sacn_port], [true, 5569])
	for (const bad of [80, 70000, 'x', 5568.5]) assert.strictEqual(normalizeDmx({ sacn_port: bad }).sacn_port, 5568)
})

test('engine: visualising, a typed universe is never live — master on and listed or not', async () => {
	const t = await parseDescription(XML)
	const sent = []
	const e = new FollowEngine({ hub: { list: () => [], now: () => 0 }, send: (to, p) => sent.push(p),
		resolveMode: (id, name) => (id === TYPE ? t.modes.find((x) => x.name === name) : null) })
	const patch = [{ id: 's', typeId: TYPE, mode: 'Standard', protocol: 'sacn', universe: 3, address: 1, dest: '127.0.0.1:5569' }]
	e.configure({ patch, dmx: { enabled: true, universes: ['sacn:3'] } })
	e.tick()
	assert.ok(sent.length > 0, 'not visualising: the universe goes out')
	assert.strictEqual(e.status().universes[0].live, true, 'master on + listed → live')
	e.configure({ patch, dmx: { enabled: true, universes: ['sacn:3'], visualise: true } })
	assert.strictEqual(e.status().universes[0].live, false, 'visualising → not live')
	assert.deepStrictEqual([e.status().dmx.visualise, e.status().dmx.sacn_port], [true, 5568])
	sent.length = 0
	e.tick()
	assert.strictEqual(sent.length, 0, 'nothing sent')
})

function freePort() {
	return new Promise((resolve) => {
		const s = dgram.createSocket('udp4')
		s.bind(0, '127.0.0.1', () => {
			const p = s.address().port
			s.close(() => resolve(p))
		})
	})
}
const until = async (fn, ms = 2000) => {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (fn()) return true
	return false
}

test('SacnFrames: real E1.31 on the configured port, patched universes only, stale after STALE_MS', async () => {
	let clock = 1000
	const rx = new SacnFrames({ now: () => clock })
	const port = await freePort()
	rx.configure([7], port)
	const tx = dgram.createSocket('udp4')
	const data = new Uint8Array(512)
	data[0] = 200
	data[511] = 9
	await until(() => rx.status().port === port)
	const send = (universe, d) => tx.send(encodeE131({ universe, data: d, sourceName: 'desk' }), port, '127.0.0.1')
	send(8, data) // not patched: ignored
	send(7, data)
	assert.ok(await until(() => rx.frame(7) !== null), 'universe 7 received')
	assert.deepStrictEqual([rx.frame(7)[0], rx.frame(7)[511]], [200, 9])
	assert.strictEqual(rx.frame(8), null)
	assert.deepStrictEqual(rx.status().universes.map((u) => [u.universe, u.source]), [[7, 'desk']])
	clock += 3000
	assert.strictEqual(rx.frame(7), null, 'stale after 2.5 s')
	rx.configure([], port)
	assert.strictEqual(rx.status().port, null, 'nothing patched → socket closed')
	tx.close()
})

test('inputFrame: console frame by protocol, ZERO without one', () => {
	const art = new ConsoleFrames({ bind: false })
	const d = new Uint8Array(512)
	d[4] = 77
	art.feed(encodeArtDmx({ portAddress: 2, data: d }), { address: '10.0.0.9' })
	const inputs = { artnet: art, sacn: new SacnFrames() }
	assert.strictEqual(inputFrame({ protocol: 'artnet', universe: 2 }, inputs)[4], 77)
	assert.strictEqual(inputFrame({ protocol: 'artnet', universe: 3 }, inputs), ZERO)
	assert.strictEqual(inputFrame({ protocol: 'sacn', universe: 2 }, inputs), ZERO, 'Art-Net 2 is not sACN 2')
})
