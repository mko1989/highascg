'use strict'

/**
 * WO-1029 — a saved Live layout (cells keyed by screen index) is reconciled against the current screen list
 * (src/system/operator-gui-reconcile.js): box B (10.11) had cells for four screens, now owns one PGM-only screen at
 * index 1 while index 0 is cabled on the other server.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const defaults = require('../../src/config/defaults')
const { getChannelMap } = require('../../src/config/routing')
const { reconcileLayoutCells } = require('../../src/system/operator-gui-reconcile')
const gui = require('../../src/system/operator-gui-channel')

const clone = (o) => JSON.parse(JSON.stringify(o))
const R = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
const cell = (role, i, extra = {}) => ({ id: `${role}_${i + 1}`, role, mainIndex: i, rect: { ...R }, surface: 'compose', ...extra })

/** `modes[i]` = destination mode of screen i; `cabled` = indices with a GPU cable here. */
function cfg(cabled, modes, on = true, ids = null) {
	const c = clone(defaults)
	const dests = modes.map((m, i) => ({ id: ids ? ids[i] : `dst_s${i}_1`, label: `S${i + 1}`, mode: m, mainScreenIndex: i, videoMode: '1080p5000' }))
	dests.push({ id: 'og1', mode: 'operator_gui', mainScreenIndex: 0, videoMode: '1080p5000' })
	c.screenDestinations = { version: 1, destinations: dests }
	c.deviceGraph = {
		version: 1,
		devices: [{ id: 'caspar_host', role: 'caspar_host' }, { id: 'destinations', role: 'destinations' }],
		connectors: [
			...dests.map((d) => ({ id: `dst_in_${d.id}`, deviceId: 'destinations', kind: 'destination_in', externalRef: d.id })),
			...dests.map((_, i) => ({ id: `gpu_p${i}`, deviceId: 'caspar_host', kind: 'gpu_out' })),
		],
		edges: cabled.map((i) => ({ id: `e${i}`, sourceId: `dst_in_${dests[i].id}`, sinkId: `gpu_p${i}` })),
	}
	if (on) c.cluster = { channelsWhereCabled: true }
	return c
}

function ctxOf(config) {
	const calls = []
	const store = new Map()
	const bc = []
	const amcp = {
		play: async (ch, l, src) => calls.push(`play ${ch}-${l} ${src}`),
		mixerFill: async (ch, l) => calls.push(`fill ${ch}-${l}`),
		stop: async (ch, l) => calls.push(`stop ${ch}-${l}`),
		mixerClear: async (ch, l) => calls.push(`clear ${ch}-${l}`),
		mixerCommit: async (ch) => calls.push(`commit ${ch}`),
	}
	return { ctx: { config, amcp, persistence: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) }, _wsBroadcast: (t, d) => bc.push([t, d]) }, calls, store, bc }
}

const SAVED4 = [cell('pgm', 0), cell('prv', 0), cell('pgm', 1), cell('pgm', 2), cell('prv', 2), cell('pgm', 3), cell('prv', 3)]
const ids = (cells) => cells.map((c) => c.id)

describe('WO-1029 live layout reconcile', () => {
	it('box B: four-screen layout, map [null, ch] / [null, null] -> remote placeholders for index 0, one routed PGM, nothing beyond', async () => {
		gui.resetOperatorGuiStateForTests()
		const config = cfg([1], ['pgm_prv', 'pgm_only'])
		const m = getChannelMap(config)
		assert.deepEqual(m.previewChannels, [null, null])
		assert.equal(m.programChannels[0], null)
		const out = reconcileLayoutCells(clone(SAVED4), config)
		assert.deepEqual(ids(out), ['pgm_1', 'prv_1', 'pgm_2'])
		assert.equal(out[2].destId, 'dst_s1_1')
		const { ctx, calls, bc } = ctxOf(config)
		const r = await gui.applyOperatorGuiLayout(ctx, clone(SAVED4))
		assert.equal(r.plan.length, 1, 'applied count = routed count')
		assert.equal(r.plan[0].route, `route://${m.programChannels[1]}`)
		assert.equal(calls.filter((c) => c.includes('route://')).length, 1, 'no route for the remote screen')
		assert.deepEqual(ids(bc[0][1].cells), ['pgm_1', 'prv_1', 'pgm_2'], 'broadcast never reports a dead index')
		assert.deepEqual(ids(gui.getPersistedOperatorGuiLayout(ctx).cells), ['pgm_1', 'prv_1', 'pgm_2'])
	})

	it('a deleted destination in the middle re-resolves the following cells by destination id', () => {
		const before = ['dA', 'dB', 'dC']
		const withIds = [
			cell('pgm', 0, { destId: 'dA' }), cell('pgm', 1, { destId: 'dB' }), cell('prv', 1, { destId: 'dB' }),
			cell('pgm', 2, { destId: 'dC' }), cell('prv', 2, { destId: 'dC' }),
		]
		assert.equal(before.length, 3)
		const config = cfg([0, 1], ['pgm_prv', 'pgm_prv'], true, ['dA', 'dC'])
		const out = reconcileLayoutCells(withIds, config)
		assert.deepEqual(ids(out), ['pgm_1', 'pgm_2', 'prv_2'], 'dB gone; dC moved from index 2 to 1')
		assert.deepEqual(out.map((c) => c.destId), ['dA', 'dC', 'dC'])
		assert.deepEqual(out.map((c) => c.mainIndex), [0, 1, 1])
	})

	it('a PGM-only screen has no PRV cell, saved or added', () => {
		const config = cfg([0, 1], ['pgm_prv', 'pgm_only'])
		const out = reconcileLayoutCells([cell('pgm', 0), cell('prv', 0), cell('pgm', 1), cell('prv', 1)], config)
		assert.deepEqual(ids(out), ['pgm_1', 'prv_1', 'pgm_2'])
		const added = reconcileLayoutCells([cell('pgm', 0), cell('prv', 0)], config, { addMissing: true })
		assert.deepEqual(ids(added), ['pgm_1', 'prv_1', 'pgm_2'])
		assert.equal(added[2].destId, 'dst_s1_1')
		assert.ok(added[2].rect.w > 0)
	})

	it('a screen here with no cell gets PGM + PRV when it has a preview channel; sources pass through', () => {
		const config = cfg([0, 1], ['pgm_prv', 'pgm_prv'])
		const src = { id: 'src_x', role: 'mvcell', srcCh: 9, mainIndex: 0, rect: { ...R } }
		const out = reconcileLayoutCells([cell('pgm', 0), cell('prv', 0), src], config, { addMissing: true })
		assert.deepEqual(ids(out), ['pgm_1', 'prv_1', 'src_x', 'pgm_2', 'prv_2'])
		assert.equal(out[2], src)
	})

	it('flag off / unchanged list: the apply is exactly today\'s', async () => {
		for (const config of [cfg([0, 1], ['pgm_prv', 'pgm_prv'], false), cfg([0, 1], ['pgm_prv', 'pgm_prv'], true)]) {
			gui.resetOperatorGuiStateForTests()
			const saved = [cell('pgm', 0), cell('prv', 0), cell('pgm', 1), cell('prv', 1), cell('pgm', 5)]
			const { ctx, calls } = ctxOf(config)
			await gui.applyOperatorGuiLayout(ctx, clone(saved))
			const direct = gui.computeOperatorGuiCellPlan(saved, getChannelMap(config), config)
			const want = direct.flatMap((e) => [`play ${gui.resolveOperatorGuiChannel(config).ch}-${e.layer} ${e.route}`])
			assert.deepEqual(calls.filter((c) => c.startsWith('play ')), want)
		}
		const same = [cell('pgm', 0, { destId: 'dst_s0_1' }), cell('pgm', 1, { destId: 'dst_s1_1' })]
		assert.equal(reconcileLayoutCells(same, cfg([0, 1], ['pgm_prv', 'pgm_prv'])), same, 'unchanged list returns the same array')
	})
})
