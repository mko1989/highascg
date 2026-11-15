'use strict'

/**
 * WO-1078 — visualiser: a rig driven partly by Art-Net and partly by sACN (owner 15.11: "only the artnet input is
 * working now"). Every fixture of an MVR patch is "artnet", so the sACN-driven part stayed dark.
 *  - twinUniverse: console universe N = Art-Net N-1 = sACN N (the MVR import's convention);
 *  - inputFrame: own protocol first, else the twin universe of the other protocol, else ZERO;
 *  - sacnUniversesFor: an Art-Net fixture makes the visualiser listen on its sACN twin;
 *  - SacnFrames holds more than 20 multicast memberships (Linux per-socket limit) without dropping a universe;
 *  - follow-service starts the Art-Net tap and the sACN socket for every visualised fixture.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('node:dgram')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const F = path.join(__dirname, '..', '..', 'src', 'fixtures')
const { SacnFrames, inputFrame, twinUniverse, sacnUniversesFor, ZERO, MAX_MEMBERSHIPS } = require(path.join(F, 'dmx-input'))
const { ConsoleFrames } = require(path.join(F, 'follow-through'))
const { encodeArtDmx } = require(path.join(F, 'artdmx'))
const { encodeE131 } = require(path.join(F, 'sacn'))

const until = async (fn, ms = 2000) => {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (fn()) return true
	return false
}
const freePort = () =>
	new Promise((res) => {
		const s = dgram.createSocket('udp4')
		s.bind(0, () => {
			const p = s.address().port
			s.close(() => res(p))
		})
	})

test('twinUniverse / sacnUniversesFor: console universe N = Art-Net N-1 = sACN N', () => {
	assert.equal(twinUniverse({ protocol: 'artnet', universe: 1 }), 2)
	assert.equal(twinUniverse({ protocol: 'sacn', universe: 2 }), 1)
	assert.equal(twinUniverse({ protocol: 'sacn', universe: 1 }), 0)
	assert.equal(twinUniverse({ protocol: 'artnet', universe: 63999 }), null, 'no sACN universe 64000')
	const fx = [
		{ protocol: 'artnet', universe: 0 },
		{ protocol: 'artnet', universe: 1 },
		{ protocol: 'artnet', universe: 1 },
		{ protocol: 'sacn', universe: 7 },
	]
	assert.deepEqual(sacnUniversesFor(fx).sort((a, b) => a - b), [1, 2, 7])
	assert.deepEqual(sacnUniversesFor([]), [])
})

test('inputFrame: own protocol first, else the twin universe of the other one, else ZERO', async (t) => {
	const art = new ConsoleFrames({ bind: false })
	const a = new Uint8Array(512)
	a[0] = 11
	art.feed(encodeArtDmx({ portAddress: 4, data: a }), { address: '10.0.0.9' })
	const rx = new SacnFrames()
	const port = await freePort()
	t.after(() => rx.stop())
	rx.configure([2, 5], port)
	assert.ok(await until(() => rx.status().listening.length === 2), 'socket bound')
	const b = new Uint8Array(512)
	b[0] = 22
	const c = new Uint8Array(512)
	c[0] = 33
	rx.feed(encodeE131({ universe: 2, data: b }), { address: '10.0.0.9' })
	rx.feed(encodeE131({ universe: 5, data: c }), { address: '10.0.0.9' })
	const inputs = { artnet: art, sacn: rx }
	assert.equal(inputFrame({ protocol: 'artnet', universe: 1 }, inputs)[0], 22, 'Art-Net 1 silent → sACN 2')
	assert.equal(inputFrame({ protocol: 'artnet', universe: 4 }, inputs)[0], 11, 'own Art-Net frame wins over sACN 5')
	assert.equal(inputFrame({ protocol: 'sacn', universe: 5 }, inputs)[0], 33, 'own sACN frame wins over Art-Net 4')
	assert.equal(inputFrame({ protocol: 'artnet', universe: 2 }, inputs), ZERO, 'Art-Net 2 is not sACN 2')
	assert.equal(inputFrame({ protocol: 'artnet', universe: 9 }, inputs), ZERO)
	rx.stop()
	assert.equal(inputFrame({ protocol: 'sacn', universe: 5 }, inputs)[0], 11, 'sACN 5 silent → Art-Net 4')
})

test('SacnFrames: more than 20 memberships, none refused, all released', async (t) => {
	const nics = Object.values(os.networkInterfaces())
		.flat()
		.filter((i) => i && i.family === 'IPv4' && !i.internal).length
	const logs = []
	const rx = new SacnFrames({ log: (l, m) => logs.push(m) })
	t.after(() => rx.stop())
	const port = await freePort()
	const unis = Array.from({ length: 30 }, (_, i) => 500 + i)
	rx.configure(unis, port)
	assert.ok(await until(() => rx.status().port === port && rx.status().listening.length === 30))
	const st = rx.status()
	assert.equal(st.join_failures, 0, logs.join('\n'))
	if (nics) {
		assert.equal(st.memberships, 30 * nics, 'every universe joined on every network card')
		assert.ok(rx._joiners.length >= Math.ceil((30 * nics) / MAX_MEMBERSHIPS) - 1, 'extra membership sockets were made')
	}
	rx.configure([500], port)
	assert.equal(rx.status().memberships, nics, 'dropped universes give their memberships back')
	rx.stop()
	assert.equal(rx.status().memberships, 0)
	assert.equal(rx._joiners.length, 0)
})

test('follow-service: both inputs run for every visualised fixture', () => {
	const src = fs.readFileSync(path.join(F, 'follow-service.js'), 'utf8')
	assert.match(src, /\|\| vis\.length\) consoleFrames\.start\(\)/)
	assert.match(src, /sacnIn\.configure\(sacnUniversesFor\(vis\), engine\.dmx\.sacn_port\)/)
})
