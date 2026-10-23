'use strict'
/**
 * WO-695 — the owner's heads "dont produce beams and dont react at all to the programer": every head the MVR scene
 * patched sits on Art-Net universe 0, broadcast — the box's own Art-Net input. The self-loop guard made that a fixture
 * `problem`, and a problem drops the fixture from tick() (no frame) and visual() (no beams). Now the loop only keeps
 * the universe off the wire (`noSend`): the frame is built, the previs decodes it, nothing reaches the own input.
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { FollowEngine } = require('../../src/fixtures/follow-engine')

const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const TYPE = 'aaaaaaaaaaaa'
const hub = { list: () => [], now: () => 0 }

async function engine() {
	const list = (await parseDescription(XML)).modes
	const sent = []
	const e = new FollowEngine({
		hub,
		send: (to, pkt) => sent.push({ to, pkt }),
		resolveMode: (id, name) => (id === TYPE ? list.find((m) => m.name === name) || null : null),
		now: () => 1000,
		isSelfLoop: (to, u, proto) => proto === 'artnet' && u === 0 && to.host === '255.255.255.255',
	})
	return { e, sent }
}

const SPOT = { id: 'spot', typeId: TYPE, mode: 'Standard', protocol: 'artnet', universe: 0, address: 1 }

test('a head on the own input universe: the programmer builds its frame (beams), nothing goes on the wire', async () => {
	const { e, sent } = await engine()
	e.configure({ dmx: { enabled: true, universes: ['artnet:0'] }, patch: [SPOT] })
	assert.strictEqual(e.fixtures[0].problem, null, 'not a problem: it still renders')
	assert.match(e.fixtures[0].noSend, /loop into this box's Art-Net input \(universe 0\)/)
	assert.deepStrictEqual(e.program(['spot'], { Dimmer: 1 }), ['spot'])
	e.tick()
	assert.strictEqual(sent.length, 0, 'never onto the own input')
	const buf = e.frameOf(e.fixtures[0])
	assert.ok(buf, 'a frame exists for the previs to decode')
	assert.strictEqual(buf[5], 255, 'dimmer full in the frame (test-spot Standard: Dimmer on slot 6)')
	const st = e.status()
	assert.strictEqual(st.universes[0].live, false)
	assert.strictEqual(st.fixtures[0].state, 'not output')
	assert.match(st.fixtures[0].problem, /loop into this box/, 'the operator still sees why it is not sent')
})

test('moved off the input universe (the patch edit): the same head goes out', async () => {
	const { e, sent } = await engine()
	e.configure({ dmx: { enabled: true, universes: ['artnet:1'] }, patch: [{ ...SPOT, universe: 1 }] })
	e.program(['spot'], { Dimmer: 1 })
	e.tick()
	assert.strictEqual(sent.length, 1)
	assert.strictEqual(e.fixtures[0].noSend, null)
	assert.strictEqual(e.status().universes[0].live, true)
})

test('a muted universe stays muted for a fixture added to it later (universe created in tick)', async () => {
	const { e, sent } = await engine()
	e.configure({ dmx: { enabled: true, universes: ['artnet:0'] }, patch: [SPOT, { ...SPOT, id: 'b', address: 20 }] })
	e.tick()
	e.tick()
	assert.strictEqual(sent.length, 0)
	assert.strictEqual(
		[...e._uni.values()].every((u) => u.noSend),
		true
	)
})

test('the beams (follow-service visual) skip only real problems, not a muted universe', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/fixtures/follow-service.js'), 'utf8')
	assert.match(src, /if \(!fx\.gdtf \|\| !fx\.enabled \|\| fx\.problem\) continue/)
	assert.doesNotMatch(src, /fx\.noSend\) continue/)
})
