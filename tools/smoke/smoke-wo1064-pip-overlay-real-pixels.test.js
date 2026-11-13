'use strict'

/**
 * WO-1064 — PIP overlays are drawn in output pixels: the CG payload carries the overlay rectangle's real size
 * (`layerPx`), the four templates use it, and a swept stale look layer takes its overlay slots with it.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const u = require('../../src/engine/pip-overlay')

const tpl = (n) => fs.readFileSync(path.join(__dirname, '../../template', `${n}.html`), 'utf8')

describe('WO-1064 PIP overlays in output pixels', () => {
	const fill = { x: 0.1, y: 0.2, scaleX: 817 / 3072, scaleY: 669 / 1024 }
	it('outside: layerPx is the content plus the outset on every side, in channel pixels', () => {
		const o = { type: 'border', params: { width: 20, side: 'outside' } }
		const p = u.computePipOverlayPlacement(o, fill, 3072, 1024, 10, 0, null, [o])
		assert.ok(Math.abs(p.layerPx.w - (817 + 40)) < 1e-6 && Math.abs(p.layerPx.h - (669 + 40)) < 1e-6, JSON.stringify(p.layerPx))
		assert.deepEqual(JSON.parse(u.buildPipOverlayCgPayload(o, p)).layerPx, p.layerPx, 'it reaches the template')
	})
	it('inside: layerPx is the content rectangle', () => {
		const o = { type: 'glow', params: { side: 'inside' } }
		const p = u.computePipOverlayPlacement(o, fill, 3072, 1024, 10, 0, null, [o])
		assert.ok(Math.abs(p.layerPx.w - 817) < 1e-6 && Math.abs(p.layerPx.h - 669) < 1e-6)
	})
	it('every template reads layerPx; glow and shadow blur per axis', () => {
		for (const n of ['pip_border', 'pip_edge_strip', 'pip_glow', 'pip_shadow']) assert.match(tpl(n), /state\.layerPx = \{ w: Number\(d\.layerPx\.w\)/, n)
		for (const n of ['pip_border', 'pip_edge_strip']) assert.match(tpl(n), /root\.style\.transform = 'scale\('/, n)
		for (const n of ['pip_glow', 'pip_shadow']) assert.match(tpl(n), /setAttribute\('stdDeviation', \([^)]*\) \* kx \+ ' ' \+ \([^)]*\) \* ky\)/, n)
	})
	it('a swept stale look layer clears its overlay slots too (a re-taken look stacked a second glow)', async () => {
		const { clearPhysicalLookLayers } = require('../../src/engine/scene-exit-layers')
		const sent = []
		await clearPhysicalLookLayers({ batchSend: async (l) => sent.push(...l), mixerCommit: async () => {} }, 4, [110], { config: {} })
		assert.ok(sent.includes('STOP 4-110'))
		for (const l of u.buildPipOverlayRemoveLines(4, 110, null)) assert.ok(sent.includes(l), l)
		assert.ok(sent.includes('CG 4-620 CLEAR'), 'bank B layer 10 → overlay slot 620')
	})
})
