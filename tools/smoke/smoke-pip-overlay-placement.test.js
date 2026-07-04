'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
	computePipOverlayPlacement,
	computeOutsideStackBands,
	sumOutsideOutsetPx,
	buildPipOverlayCgPayload,
	effectivePipOverlaySide,
	expandFillOutward,
	innerRectInOverlayNorm,
	normalizeContentFill,
} = require('../../src/engine/pip-overlay-utils')
const { buildPipOverlayAmcpLines, buildPipOverlayAmcpLinesAll } = require('../../src/engine/pip-overlay')

const fill = { x: 0.25, y: 0.25, scaleX: 0.5, scaleY: 0.5 }
const chW = 1920
const chH = 1080

test('outside border expands MIXER FILL beyond content rect', () => {
	const overlay = { type: 'border', params: { width: 10, side: 'outside' } }
	const { inner, mixFill } = computePipOverlayPlacement(overlay, fill, chW, chH, 10, 0, 20, [overlay])
	assert.ok(mixFill.scaleX > fill.scaleX)
	assert.ok(mixFill.scaleY > fill.scaleY)
	assert.ok(mixFill.x < fill.x)
	assert.ok(mixFill.y < fill.y)
	assert.ok(inner.l > 0 && inner.t > 0)
	assert.ok(inner.w < 1 && inner.h < 1)
})

test('inside border uses content-sized MIXER FILL', () => {
	const overlay = { type: 'border', params: { width: 4, side: 'inside' } }
	const { inner, mixFill } = computePipOverlayPlacement(overlay, fill, chW, chH, 10, 0, 20, [overlay])
	assert.deepEqual(inner, { l: 0, t: 0, w: 1, h: 1 })
	assert.deepEqual(mixFill, fill)
})

test('outside stack: glow further out, border closer to content', () => {
	const stack = [
		{ type: 'glow', params: { intensity: 20, side: 'outside' } },
		{ type: 'border', params: { width: 4, side: 'outside' } },
	]
	const glowBands = computeOutsideStackBands(stack, 0)
	const borderBands = computeOutsideStackBands(stack, 1)
	assert.equal(glowBands.ringInnerPx, 0)
	assert.ok(glowBands.ringOuterPx > 0)
	assert.equal(borderBands.ringInnerPx, glowBands.ringOuterPx)
	assert.ok(borderBands.ringOuterPx > borderBands.ringInnerPx)
	assert.equal(sumOutsideOutsetPx(stack), borderBands.ringOuterPx)
})

test('CG payload forces side to match placement (edge_strip default outside)', () => {
	const overlay = { type: 'edge_strip', params: { thickness: 4 } }
	assert.equal(effectivePipOverlaySide(overlay), 'outside')
	const placement = computePipOverlayPlacement(overlay, fill, chW, chH, 10, 0, 20, [overlay])
	const json = JSON.parse(buildPipOverlayCgPayload(overlay, placement))
	assert.equal(json.side, 'outside')
	assert.ok(placement.mixFill.scaleX > fill.scaleX)
})

test('CG payload includes ring bands for outside overlays', () => {
	const overlay = { type: 'border', params: { width: 8, side: 'outside' } }
	const lines = buildPipOverlayAmcpLines(overlay, 2, 10, fill, { config: {} }, 0, 20, 0, [overlay])
	const joined = lines.join('\n')
	assert.ok(joined.includes('ringInnerPx'))
	assert.ok(joined.includes('ringOuterPx'))
	assert.ok(joined.includes('totalOutsetPx'))
})

test('outside border AMCP sends expanded FILL and side outside in CG JSON', () => {
	const overlay = { type: 'border', params: { width: 20, side: 'outside', color: '#f00' } }
	const lines = buildPipOverlayAmcpLines(overlay, 2, 10, fill, { config: {} }, 0, 20, 0, [overlay])
	const update = lines.find((l) => l.includes('CG 2-11 UPDATE'))
	assert.ok(update)
	const json = JSON.parse(update.match(/"(\{.*\})"/)[1].replace(/\\"/g, '"'))
	assert.equal(json.side, 'outside')
	assert.ok(json.inner.w < 1 && json.inner.l > 0)
	const fillLine = lines.find((l) => /^MIXER 2-11 FILL /.test(l))
	assert.ok(fillLine)
	const parts = fillLine.split(/\s+/)
	const mixSx = Number(parts[5])
	const mixSy = Number(parts[6])
	assert.ok(mixSx > fill.scaleX)
	assert.ok(mixSy > fill.scaleY)
})

test('multi-overlay stack uses per-template layers, not pip_router', () => {
	const stack = [
		{ type: 'glow', params: { intensity: 20, side: 'outside' } },
		{ type: 'border', params: { width: 8, side: 'outside' } },
	]
	const lines = buildPipOverlayAmcpLinesAll(stack, 2, 10, fill, { config: {} }, 20, null, 0)
	const joined = lines.join('\n')
	assert.ok(joined.includes('pip_glow'))
	assert.ok(joined.includes('pip_border'))
	assert.equal(joined.includes('pip_router'), false)
	assert.ok(joined.includes('CG 2-11 ADD'))
	assert.ok(joined.includes('CG 2-12 ADD'))
})

test('innerRectInOverlayNorm inverts expandFillOutward for outside placement', () => {
	const cf = normalizeContentFill(fill)
	const expanded = expandFillOutward(cf, 20, chW, chH)
	const inner = innerRectInOverlayNorm(cf, expanded)
	assert.ok(inner.l > 0 && inner.t > 0 && inner.w < 1 && inner.h < 1)
	// Content rect in channel-normalized coords should reconstruct from inner + expanded fill.
	const cx = expanded.x + inner.l * expanded.scaleX
	const cy = expanded.y + inner.t * expanded.scaleY
	assert.ok(Math.abs(cx - cf.x) < 1e-9)
	assert.ok(Math.abs(cy - cf.y) < 1e-9)
	assert.ok(Math.abs(inner.w * expanded.scaleX - cf.scaleX) < 1e-9)
	assert.ok(Math.abs(inner.h * expanded.scaleY - cf.scaleY) < 1e-9)
})

test('effectivePipOverlaySide treats empty side as outside', () => {
	assert.equal(effectivePipOverlaySide({ type: 'border', params: { side: '' } }), 'outside')
	assert.equal(effectivePipOverlaySide({ type: 'border', params: {} }), 'outside')
	assert.equal(effectivePipOverlaySide({ type: 'border', params: { side: 'inside' } }), 'inside')
})

test('outside overlay stack always re-ADDs with immediate expanded FILL', () => {
	const overlay = { type: 'edge_strip', params: { thickness: 8, side: 'outside' } }
	const prevLayer = { pipOverlays: [overlay] }
	const lines = buildPipOverlayAmcpLinesAll([overlay], 2, 10, fill, { config: {} }, 20, prevLayer, 0)
	const joined = lines.join('\n')
	assert.ok(joined.includes('CG 2-11 CLEAR'))
	assert.ok(joined.includes('CG 2-11 ADD'))
	assert.ok(!/^CG 2-11 UPDATE/m.test(joined) || joined.includes('CG 2-11 ADD'))
	const fillLine = lines.find((l) => /^MIXER 2-11 FILL /.test(l))
	assert.ok(fillLine)
	assert.doesNotMatch(fillLine, /DEFER/)
	assert.ok(Number(fillLine.split(/\s+/)[5]) > fill.scaleX)
})

test('pip_border template uses box-shadow outside pattern (CEF-safe)', () => {
	const tpl = fs.readFileSync(path.join(__dirname, '../../template/pip_border.html'), 'utf8')
	assert.match(tpl, /\.pip-frame\.side-outside\s*\{[^}]*box-shadow:\s*0\s+0\s+0/)
	assert.match(tpl, /docs\/reference\/pip-overlay-outside-border\.md/)
	assert.doesNotMatch(tpl, /outline:/)
})
