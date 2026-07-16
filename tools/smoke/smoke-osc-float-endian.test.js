'use strict'

/**
 * Smoke — src/osc/osc-float-endian.js: little-endian OSC float normalization.
 *
 * The 2.6-dev binary writes OSC float32 args LITTLE-ENDIAN (spec says big-endian) while its
 * int args are correct BE — live-captured 2026-07-16 (see the module docblock for the raw
 * bytes). These tests build wire-format datagrams both ways and assert:
 *   1. an LE stream auto-latches 'le' via `.../file/fps` canaries and every float (incl. inside
 *      bundles, alongside untouched int/string args) decodes to the true value afterwards;
 *   2. a spec-compliant BE stream latches 'be' and passes through byte-identical;
 *   3. forced modes ('le'/'be') skip detection entirely;
 *   4. malformed packets don't throw.
 *
 * Wire fixtures are built with osc.writePacket (always BE) and floats are byte-reversed
 * afterwards to fabricate the broken binary's output — so the fixture generator can't share a
 * bug with the code under test.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const osc = require('osc')
const { createFloatEndianNormalizer } = require('../../src/osc/osc-float-endian')

/**
 * Build the broken binary's wire bytes for `packet`: every 'f' arg value is substituted with the
 * float whose BE encoding equals the LE encoding of the true value, then the packet is written
 * normally (osc.writePacket always encodes BE). The resulting bytes carry the true floats in
 * little-endian order — exactly what the 2.6-dev binary emits. Values are restored afterwards.
 */
function writePacketWithLeFloats(packet) {
	const floats = []
	collectFloats(packet, floats)
	for (const f of floats) f.arg.value = reinterpretReversed(f.orig)
	const buf = Buffer.from(osc.writePacket(packet))
	for (const f of floats) f.arg.value = f.orig
	return buf
}

function collectFloats(packet, out) {
	if (packet.packets) {
		for (const p of packet.packets) collectFloats(p, out)
		return
	}
	for (const arg of packet.args || []) {
		if (arg && arg.type === 'f') out.push({ arg, orig: arg.value })
	}
}

/** The float32 whose BE encoding equals the LE encoding of `v` (i.e. byte-reversed v). */
function reinterpretReversed(v) {
	const b = Buffer.alloc(4)
	b.writeFloatLE(v, 0)
	return b.readFloatBE(0)
}

function fpsMessage(fps) {
	return {
		address: '/channel/1/stage/layer/10/foreground/file/fps',
		args: [{ type: 'f', value: fps }],
	}
}

function fileTimeMessage(elapsed, duration) {
	return {
		address: '/channel/1/stage/layer/10/foreground/file/time',
		args: [
			{ type: 'f', value: elapsed },
			{ type: 'f', value: duration },
		],
	}
}

function readVals(buf) {
	const packet = osc.readPacket(buf, { metadata: true })
	const out = []
	const walk = (p) => {
		if (p.packets) return p.packets.forEach(walk)
		out.push({ address: p.address, vals: (p.args || []).map((a) => a.value) })
	}
	walk(packet)
	return out
}

test('LE stream: latches via fps canaries, then swaps floats (bundles, mixed args untouched)', () => {
	const norm = createFloatEndianNormalizer('auto', null)
	assert.strictEqual(norm.getMode(), 'auto')

	// 3 fps canaries latch 'le'. Pre-latch packets pass through unswapped (accepted startup blip).
	for (let i = 0; i < 3; i++) norm.normalize(writePacketWithLeFloats(fpsMessage(50)))
	assert.strictEqual(norm.getMode(), 'le')

	// Post-latch: a bundle with file/time floats + int/string args elsewhere.
	const buf = writePacketWithLeFloats({
		timeTag: { raw: [0, 1], native: 0 },
		packets: [
			fileTimeMessage(2.48, 15.04),
			{
				address: '/channel/1/framerate',
				args: [
					{ type: 'i', value: 50 },
					{ type: 'i', value: 1 },
				],
			},
			{ address: '/channel/1/stage/layer/10/foreground/producer', args: [{ type: 's', value: 'ffmpeg' }] },
		],
	})
	norm.normalize(buf)
	const msgs = readVals(buf)
	const time = msgs.find((m) => m.address.endsWith('file/time'))
	assert.ok(Math.abs(time.vals[0] - 2.48) < 1e-5, `elapsed decoded ${time.vals[0]}`)
	assert.ok(Math.abs(time.vals[1] - 15.04) < 1e-5, `duration decoded ${time.vals[1]}`)
	const fr = msgs.find((m) => m.address.endsWith('framerate'))
	assert.deepStrictEqual(fr.vals, [50, 1], 'int args must not be touched')
	const prod = msgs.find((m) => m.address.endsWith('producer'))
	assert.deepStrictEqual(prod.vals, ['ffmpeg'], 'string args must not be touched')
})

test('BE (spec-compliant) stream: latches be, bytes pass through identical', () => {
	const norm = createFloatEndianNormalizer('auto', null)
	for (let i = 0; i < 3; i++) {
		const buf = Buffer.from(osc.writePacket(fpsMessage(50)))
		norm.normalize(buf)
	}
	assert.strictEqual(norm.getMode(), 'be')
	const buf = Buffer.from(osc.writePacket(fileTimeMessage(2.48, 15.04)))
	const before = Buffer.from(buf)
	norm.normalize(buf)
	assert.ok(buf.equals(before), 'BE stream must not be modified')
	const [msg] = readVals(buf)
	assert.ok(Math.abs(msg.vals[0] - 2.48) < 1e-5)
})

test('forced le mode swaps immediately, no canary needed', () => {
	const norm = createFloatEndianNormalizer('le', null)
	assert.strictEqual(norm.getMode(), 'le')
	const buf = writePacketWithLeFloats(fileTimeMessage(4.0, 5.04))
	norm.normalize(buf)
	const [msg] = readVals(buf)
	assert.ok(Math.abs(msg.vals[0] - 4.0) < 1e-5)
	assert.ok(Math.abs(msg.vals[1] - 5.04) < 1e-5)
})

test('forced be mode never swaps even when canaries look LE', () => {
	const norm = createFloatEndianNormalizer('be', null)
	const buf = writePacketWithLeFloats(fpsMessage(50))
	const before = Buffer.from(buf)
	norm.normalize(buf)
	assert.ok(buf.equals(before))
	assert.strictEqual(norm.getMode(), 'be')
})

test('ambiguous canaries do not latch; malformed packets do not throw', () => {
	const norm = createFloatEndianNormalizer('auto', null)
	// 0.0 decodes 0.0 both ways -> no vote either direction.
	for (let i = 0; i < 5; i++) norm.normalize(Buffer.from(osc.writePacket(fpsMessage(0))))
	assert.strictEqual(norm.getMode(), 'auto')
	assert.doesNotThrow(() => norm.normalize(Buffer.from([0x2f, 0x61]))) // truncated '/a'
	assert.doesNotThrow(() => norm.normalize(Buffer.alloc(0)))
	assert.doesNotThrow(() => norm.normalize(Buffer.from('#bundle\0short')))
})
