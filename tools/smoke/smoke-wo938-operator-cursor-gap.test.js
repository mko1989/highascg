'use strict'

/**
 * WO-938 — the mouse pointer is never visible on a program output.
 *
 * Pointer barriers stop the cursor's HOTSPOT at the operator heads' edge, but X draws the whole sprite from there: on
 * 03.11 the Adwaita arrow (36x36, hotspot 4,1) showed ~31 px of its tail on the Dioda wall (DP-0) right of DP-6. The
 * layout now leaves OPERATOR_CURSOR_GAP_PX of canvas that no CRTC scans between operator heads and every other head,
 * so whatever of the sprite lands there is invisible. These proofs walk every layout family the calculator has.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { calculateLayoutPositions } = require('../../src/utils/os-layout-calculator')
const { OPERATOR_CURSOR_GAP_PX: GAP } = require('../../src/utils/os-layout-calculator-place')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const og = require('../../src/config/operator-gui-first')
const { boxConfig } = require('./fixtures/wo869-box-config')

const rig = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wo868', 'rig.config.json'), 'utf8'))

/** Every planned rect, operator or not (screens, multiview, PRV and the pixel-mapping outputs). */
function rects(lay) {
	const out = []
	for (const i of Object.values(lay.operatorGui || {})) out.push({ op: true, ...i })
	for (const k of ['screens', 'multiview', 'prv']) for (const i of Object.values(lay[k] || {})) out.push({ op: false, ...i })
	for (const i of lay.mappingGpuOutputs || []) out.push({ op: false, ...i })
	return out.filter((r) => Number.isFinite(r.x) && r.width > 0 && r.height > 0)
}

/** Horizontal clearance between each operator rect and each non-operator rect that shares rows with it. */
function minClearance(lay) {
	const all = rects(lay)
	const ops = all.filter((r) => r.op)
	const others = all.filter((r) => !r.op)
	assert.ok(ops.length > 0 && others.length > 0, 'rig has both kinds of heads')
	let min = Infinity
	for (const a of ops) {
		for (const b of others) {
			const rowsOverlap = a.y < b.y + b.height && b.y < a.y + a.height
			if (!rowsOverlap) continue
			const gap = b.x >= a.x + a.width ? b.x - (a.x + a.width) : a.x - (b.x + b.width)
			min = Math.min(min, gap)
		}
	}
	return min
}

test('WO-938 the gap covers any themed cursor (sizes up to 96 px, either side of the hotspot)', () => {
	assert.ok(GAP >= 96, `gap ${GAP}`)
})

for (const [name, cfg] of [
	['screen rig, operator GUI first', () => og.withOperatorGuiFirst(rig(), true)],
	['screen rig, legacy order', () => rig()],
	['pixel-mapping rig (the box), operator GUI first', () => buildCasparGeneratorFlatConfig(boxConfig())],
	['pixel-mapping rig, legacy order', () => buildCasparGeneratorFlatConfig(boxConfig({ operatorFirst: false }))],
]) {
	test(`WO-938 ${name}: no program head within the cursor gap of an operator head`, () => {
		assert.equal(minClearance(calculateLayoutPositions(cfg())), GAP)
	})
}

test('WO-938 operator heads still touch each other (WO-903 fences their union, which must hold no dead canvas)', () => {
	const cfg = og.withOperatorGuiFirst(rig(), true)
	const lay = calculateLayoutPositions(cfg)
	const ops = Object.values(lay.operatorGui).sort((a, b) => a.x - b.x)
	assert.equal(ops[0].x, 0)
	for (let i = 1; i < ops.length; i++) assert.equal(ops[i].x, ops[i - 1].x + ops[i - 1].width)
})
