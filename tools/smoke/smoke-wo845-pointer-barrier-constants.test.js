'use strict'

/**
 * WO-845 (REPORT 4m) — confine-pointer-barriers.py used swapped XFixes direction constants (NegativeX=2, PositiveY=4),
 * so the right and top edges let the pointer out. Pins the values to X11/extensions/xfixeswire.h and the
 * "allowed direction = inward" table. Verified live on a scratch Xvfb (see the WO): with the old table relative
 * motion +900 x / -600 y escaped the rect; with this one all four edges hold.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '..', 'runtime', 'confine-pointer-barriers.py'), 'utf8')

test('WO-845: barrier direction constants match xfixeswire.h (1<<0 PosX, 1<<1 PosY, 1<<2 NegX, 1<<3 NegY)', () => {
	const v = (name) => Number((src.match(new RegExp(`^${name} = (\\d+)$`, 'm')) || [])[1])
	assert.equal(v('BARRIER_POSITIVE_X'), 1)
	assert.equal(v('BARRIER_POSITIVE_Y'), 2)
	assert.equal(v('BARRIER_NEGATIVE_X'), 4)
	assert.equal(v('BARRIER_NEGATIVE_Y'), 8)
	// If a system header is installed, it is the arbiter.
	const hdr = '/usr/include/X11/extensions/xfixeswire.h'
	if (fs.existsSync(hdr)) {
		const h = fs.readFileSync(hdr, 'utf8')
		const bit = (n) => 1 << Number((h.match(new RegExp(`#define ${n}\\s+\\(1L << (\\d+)\\)`)) || [])[1])
		assert.equal(v('BARRIER_POSITIVE_X'), bit('BarrierPositiveX'))
		assert.equal(v('BARRIER_POSITIVE_Y'), bit('BarrierPositiveY'))
		assert.equal(v('BARRIER_NEGATIVE_X'), bit('BarrierNegativeX'))
		assert.equal(v('BARRIER_NEGATIVE_Y'), bit('BarrierNegativeY'))
	}
})

test('WO-845: each edge allows only the INWARD direction (X "directions" = directions allowed to pass)', () => {
	const edge = (name) => (src.match(new RegExp(`\\("${name}",[^\\n]*?(BARRIER_\\w+)\\)`)) || [])[1]
	assert.equal(edge('left'), 'BARRIER_POSITIVE_X')
	assert.equal(edge('right'), 'BARRIER_NEGATIVE_X')
	assert.equal(edge('top'), 'BARRIER_POSITIVE_Y')
	assert.equal(edge('bottom'), 'BARRIER_NEGATIVE_Y')
})
