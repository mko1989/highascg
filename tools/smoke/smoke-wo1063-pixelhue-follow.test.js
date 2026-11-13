'use strict'

/**
 * WO-1063 — look layers linked to a PixelHue layer follow it while their look is on program: one PGM mixer nudge per
 * change, the live entry updated in place; nothing is read from the switcher when no linked layer is on air; layers
 * the look drives are not followed.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createPixelhueFollow, followLinks, followedLayers } = require('../../src/pixelhue/pixelhue-follow')

const FILL_A = { x: 0.1, y: 0.2, scaleX: 0.3, scaleY: 0.4 }
const FILL_B = { x: 0.5, y: 0.2, scaleX: 0.25, scaleY: 0.4 }
const stored = (link) => ({ id: 's1', layers: [{ layerNumber: 10, source: { value: 'bg.mov' } }, { layerNumber: 11, source: { value: '#00000000' }, pixelhue: link }] })
const liveEntry = (fill) => ({ sceneId: 's1', updatedAt: 111, scene: { id: 's1', layers: [{ layerNumber: 10, source: { value: 'bg.mov' }, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } }, { layerNumber: 11, source: { value: '#00000000' }, fill, contentFit: 'stretch' }] } })
const snapOf = (fill, extra = {}) => ({ screens: [{ screenId: 5, enabled: true, layers: [{ layerId: 77, enabled: true, scene: 'pgm', fill, ...extra }, { layerId: 78, enabled: true, scene: 'pvw', fill: FILL_A }] }] })

function rig({ link = { layerId: 77 }, drive = false, switcherFill = FILL_B, host = '10.0.0.7' } = {}) {
	const state = { live: { 1: liveEntry(FILL_A) }, reads: 0, nudges: [], snap: snapOf(switcherFill) }
	const follow = createPixelhueFollow({
		ctx: {},
		deps: {
			settings: () => ({ host, drive }),
			reader: () => ({ read: async () => (state.reads++, state.snap) }),
			getMap: () => ({ programChannels: [1], programResolutions: [{ w: 3072, h: 1024 }] }),
			getLive: (ch) => state.live[ch] || null,
			setLive: async (ch, e) => (state.live[ch] = e),
			resolveScene: () => stored(link),
			nudge: async (b) => (state.nudges.push(b), { status: 200, body: JSON.stringify({ ok: true }) }),
		},
	})
	return { state, follow }
}

describe('WO-1063 PixelHue follow', () => {
	it('a moved switcher layer nudges only its look layer on PGM and updates the live entry', async () => {
		const { state, follow } = rig()
		await follow.tick()
		assert.equal(state.nudges.length, 1)
		const n = state.nudges[0]
		assert.equal(n.target, 'pgm')
		assert.equal(n.sceneId, 's1')
		assert.deepEqual(n.composeCanvas, { w: 3072, h: 1024 })
		assert.deepEqual(n.layers.map((l) => l.layerNumber), [11])
		assert.deepEqual(n.layers[0].fill, FILL_B)
		assert.deepEqual(state.live[1].scene.layers[1].fill, FILL_B)
		assert.equal(state.live[1].updatedAt, 111, 'the take time is kept')
		await follow.tick()
		assert.equal(state.nudges.length, 1, 'in place now: no second nudge')
	})
	it('an unmoved layer (sub-pixel difference) never nudges', async () => {
		const { state, follow } = rig({ switcherFill: { ...FILL_A, x: FILL_A.x + 0.00005 } })
		await follow.tick()
		assert.equal(state.nudges.length, 0)
	})
	it('no linked layer on air, or no switcher address: the switcher is not read', async () => {
		for (const o of [{ link: null }, { host: '' }]) {
			const { state, follow } = rig(o)
			await follow.tick()
			assert.equal(state.reads, 0)
			assert.equal(state.nudges.length, 0)
		}
	})
	it('a layer the look drives is not followed; with its own drive off it is', async () => {
		const a = rig({ drive: true })
		await a.follow.tick()
		assert.equal(a.state.nudges.length, 0)
		const b = rig({ drive: true, link: { layerId: 77, drive: false } })
		await b.follow.tick()
		assert.equal(b.state.nudges.length, 1)
	})
	it('a take that lands during the nudge keeps its own live entry', async () => {
		const { state } = rig()
		const taken = { ...liveEntry(FILL_A), updatedAt: 222 }
		const f2 = createPixelhueFollow({ ctx: {}, deps: {
			settings: () => ({ host: 'h', drive: false }), reader: () => ({ read: async () => state.snap }),
			getMap: () => ({ programChannels: [1] }), getLive: (ch) => state.live[ch], setLive: async () => assert.fail('must not overwrite the new take'),
			resolveScene: () => stored({ layerId: 77 }), nudge: async () => ((state.live[1] = taken), { status: 200, body: '{"ok":true}' }),
		} })
		await f2.tick()
		assert.equal(state.live[1], taken)
	})
	it('pure helpers: disabled / PVW / missing switcher layers leave the row alone', () => {
		const links = followLinks(stored({ layerId: 78 }), false)
		assert.equal(followedLayers(liveEntry(FILL_B).scene.layers, links, snapOf(FILL_A)).moved.length, 0, 'a PVW layer is not what is on program')
		const l2 = followLinks(stored({ layerId: 77 }), false)
		assert.equal(followedLayers(liveEntry(FILL_A).scene.layers, l2, snapOf(FILL_B, { enabled: false })).moved.length, 0)
		assert.equal(followLinks(stored({ layerId: 'x' }), false).size, 0)
	})
})
