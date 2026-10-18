'use strict'

/**
 * WO-601 — the Godot global-border inspector uses POST /api/scene/global-border (WO-585) as its only path, so the
 * pure slot logic gained the web inspector's remaining edits with the web's rules (scene-state-global-border.js).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const { applyControlToSlot, defaultGlobalBorderSlot } = require('../../src/engine/global-border-control')

const on = (over = {}) => ({ ...defaultGlobalBorderSlot(), enabled: true, type: 'border', params: { width: 4, side: 'inside' }, ...over })

describe('WO-601 global border slot edits', () => {
	it('slices: normalized; a change re-ADDs except edge_strip; same slices update', () => {
		const r = applyControlToSlot(on(), { slices: [{ x: '0.1', y: 0, w: 0.5, h: 1, junk: 1 }] })
		assert.deepStrictEqual(r.next.slices, [{ x: 0.1, y: 0, w: 0.5, h: 1 }])
		assert.equal(r.forceAdd, true)
		assert.equal(applyControlToSlot(on({ type: 'edge_strip' }), { slices: [{ x: 0, y: 0, w: 1, h: 1 }] }).forceAdd, false, 'edge_strip takes slices live')
		assert.equal(applyControlToSlot(on({ slices: [{ x: 0, y: 0, w: 1, h: 1 }] }), { slices: [{ x: 0, y: 0, w: 1, h: 1 }] }).forceAdd, false)
		assert.equal(applyControlToSlot(on(), { params: { width: 9 } }).forceAdd, false, 'param edit = CG UPDATE')
	})
	it('inner area clamped to 0..1', () => {
		assert.deepStrictEqual(applyControlToSlot(on(), { inner: { l: -1, t: 0.2, w: 2, h: 'x' } }).next.inner, { l: 0, t: 0.2, w: 1, h: 1 })
	})
	it('mirror on → re-ADD on the mirror slot; off → PGM snapshot restored', () => {
		const snap = { enabled: true, type: 'glow', params: { intensity: 9 }, slices: [], fadeDuration: 10, activePgmLayer: 996 }
		const m = applyControlToSlot(on({ pgmAirSnapshot: snap }), { mirrorBorderOnPrv: true, params: { width: 20 } })
		assert.equal(m.next.mirrorBorderOnPrv, true)
		assert.equal(m.forceAdd, true)
		const off = applyControlToSlot({ ...m.next }, { mirrorBorderOnPrv: false })
		assert.equal(off.next.type, 'glow')
		assert.deepStrictEqual(off.next.params, { intensity: 9, side: 'inside' })
		assert.equal(off.next.activePgmLayer, 996)
		assert.equal(off.mirrorChanged, true)
		assert.equal(off.forceAdd, false, 'PGM already shows the snapshot — update, no on-air re-fade')
	})
	it('preset save (from the PGM snapshot when there is one) / delete — no AMCP', () => {
		const snap = { enabled: true, type: 'shadow', params: { blur: 3 }, slices: [{ x: 0, y: 0, w: 1, h: 1 }], fadeDuration: 12, activePgmLayer: 998 }
		const s = applyControlToSlot(on({ pgmAirSnapshot: snap, borderPresets: [{ slot: 2, name: 'B', data: {} }] }), { savePreset: { slot: 1, name: '  Doors ' } })
		assert.equal(s.noAir, true)
		assert.deepStrictEqual(s.next.borderPresets.map((p) => [p.slot, p.name, p.data.type]), [[1, 'Doors', 'shadow'], [2, 'B', undefined]])
		const d = applyControlToSlot(s.next, { deletePreset: 2 })
		assert.equal(d.noAir, true)
		assert.deepStrictEqual(d.next.borderPresets.map((p) => p.slot), [1])
		assert.equal(d.next.enabled, true, 'on/off untouched')
	})
})
