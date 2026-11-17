'use strict'

/**
 * WO-1113 — a typed fixture whose patch runs pan / tilt against its GDTF file (pan.invert / tilt.invert in the patch: a
 * desk personality counting the other way) is drawn turned the other way: applyType keeps the patch's own flag as
 * `flip`, decodeVisual negates that axis.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const { decodeVisual } = require('../../src/fixtures/gdtf-visual')
const { applyType } = require('../../src/fixtures/gdtf-patch')

const fn = (attribute, physFrom, physTo) => ({ name: attribute, attribute, from: 0, to: 65535, physFrom, physTo, sets: [], modeMaster: '', wheel: '' })
const ch = (name, geometry, offsets, f) => ({ name, geometry, break: 1, offsets, res: 2, default: 32768, initial: 0, functions: [f] })
const PAN = ch('Yoke_Pan', 'Yoke', [1, 2], fn('Pan', -270, 270))
const TILT = ch('Head_Tilt', 'Head', [3, 4], fn('Tilt', -135, 135))
const plan = { channels: [PAN, TILT], axes: [PAN, TILT], beams: [], wheels: {} }
const buf = Buffer.alloc(512)
buf.writeUInt16BE(49152, 0) // pan +135°
buf.writeUInt16BE(16384, 2) // tilt −67.5°

test('decodeVisual negates the flipped axis only', () => {
	const near = (a, b) => assert.ok(Math.abs(a - b) < 0.02, `${a} ≈ ${b}`)
	const plain = decodeVisual(plan, buf, 1).axes
	near(plain.Yoke, 135); near(plain.Head, -67.5)
	const t = decodeVisual(plan, buf, 1, null, { pan: false, tilt: true }).axes
	near(t.Yoke, 135); near(t.Head, 67.5)
	const p = decodeVisual(plan, buf, 1, null, { pan: true, tilt: false }).axes
	near(p.Yoke, -135); near(p.Head, -67.5)
	// the calibrated offset is added after the turn (it belongs to the real head)
	near(decodeVisual(plan, buf, 1, { pan: 2, tilt: 1 }, { pan: true, tilt: true }).axes.Yoke, -133)
})

test('applyType keeps the patch flag as flip, apart from the file direction', () => {
	const mode = { footprint: 4, channels: [PAN, ch('Head_Tilt', 'Head', [3, 4], fn('Tilt', 135, -135))] }
	const fx = applyType({ pan: { invert: true }, tilt: { invert: false } }, mode)
	assert.strictEqual(fx.pan.flip, true); assert.strictEqual(fx.pan.invert, true)
	assert.strictEqual(fx.tilt.flip, false); assert.strictEqual(fx.tilt.invert, true, 'a falling file range inverts the bytes, it is not a flip')
	assert.strictEqual(applyType(fx, mode).pan.flip, true, 'a second pass keeps it')
})
