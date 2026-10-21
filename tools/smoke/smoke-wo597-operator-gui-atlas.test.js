'use strict'

/**
 * WO-597 §D — atlas mode for the operator-GUI channel (src/system/operator-gui-atlas.js).
 * Acceptance: with an shm operator surface in atlas mode, moving/resizing tiles in the client sends
 * ZERO AMCP; adding a source re-allocates exactly once; a screen surface keeps the monitor mosaic.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const {
	resetOperatorGuiStateForTests,
	getPersistedOperatorGuiLayout,
} = require('../../src/system/operator-gui-channel')
const { packShelves, GUTTER_PX } = require('../../src/system/operator-gui-atlas')
const routesOperatorGui = require('../../src/api/routes-operator-gui')

const LAYOUT = '/api/operator-gui/layout'

function makeCtx(videoOutput = 'shm') {
	const config = JSON.parse(JSON.stringify(defaults))
	config.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv' },
			{ id: 'og1', mainScreenIndex: 5, mode: 'operator_gui', videoOutput },
		],
	}
	const calls = []
	const store = new Map()
	const amcp = {
		play: async (ch, layer, src) => calls.push(`play ${ch}-${layer} ${src}`),
		mixerFill: async (ch, layer, x, y, w, h) =>
			calls.push(`fill ${ch}-${layer} ${[x, y, w, h].map((v) => v.toFixed(4)).join(' ')}`),
		stop: async (ch, layer) => calls.push(`stop ${ch}-${layer}`),
		mixerClear: async (ch, layer) => calls.push(`clear ${ch}-${layer}`),
		mixerCommit: async (ch) => calls.push(`commit ${ch}`),
	}
	const broadcasts = []
	const ctx = {
		config,
		amcp,
		log: () => {},
		persistence: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
		_wsBroadcast: (type, data) => broadcasts.push({ type, data }),
	}
	return { ctx, calls, store, broadcasts }
}

const cell = (id, x, y, w, h, extra = {}) => ({ id, role: 'pgm', mainIndex: 0, rect: { x, y, w, h }, ...extra })

async function post(ctx, body) {
	const r = await routesOperatorGui.handlePost(LAYOUT, JSON.stringify(body), ctx)
	return JSON.parse(r.body)
}

describe('WO-597 §D atlas allocator — packing', () => {
	it('shelf-packs without overlap, inside the canvas, with a gutter', () => {
		const items = [
			{ key: 'a', w: 960, h: 540 },
			{ key: 'b', w: 640, h: 360 },
			{ key: 'c', w: 640, h: 360 },
			{ key: 'd', w: 400, h: 400 },
		]
		const { slots, scale } = packShelves(items, 1920, 1080)
		assert.equal(slots.size, 4)
		assert.equal(scale, 1, 'these fit unscaled')
		const list = [...slots.values()]
		for (const s of list) assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= 1920 && s.y + s.h <= 1080)
		for (let i = 0; i < list.length; i++)
			for (let j = i + 1; j < list.length; j++) {
				const a = list[i]
				const b = list[j]
				const apart =
					a.x + a.w + GUTTER_PX <= b.x ||
					b.x + b.w + GUTTER_PX <= a.x ||
					a.y + a.h + GUTTER_PX <= b.y ||
					b.y + b.h + GUTTER_PX <= a.y
				assert.ok(apart, `slots ${i} and ${j} overlap or touch`)
			}
	})

	it('scales everything down (keeping aspect) when the demand exceeds the canvas', () => {
		const { slots, scale } = packShelves(
			[
				{ key: 'a', w: 1920, h: 1080 },
				{ key: 'b', w: 1920, h: 1080 },
			],
			1920,
			1080
		)
		assert.ok(scale < 1 && scale > 0)
		assert.equal(slots.size, 2)
		for (const s of slots.values()) assert.ok(Math.abs(s.w / s.h - 16 / 9) < 0.01)
	})
})

describe('WO-597 §D atlas mode — apply path', () => {
	beforeEach(() => resetOperatorGuiStateForTests())

	it('a move sends zero AMCP; a > 25 % resize or a new source re-allocates once', async () => {
		const { ctx, calls, broadcasts } = makeCtx('shm')
		const first = await post(ctx, {
			atlas: true,
			cells: [cell('pgm_1', 0.1, 0.1, 0.3, 0.3), cell('prv_1', 0.5, 0.5, 0.3, 0.3, { role: 'prv' })],
		})
		assert.ok(first.atlas && first.atlas.slots.pgm_1 && first.atlas.slots.prv_1, 'reply carries the slots')
		assert.ok(
			calls.some((c) => c.startsWith('play')),
			'first apply lands the routes'
		)
		assert.equal(
			broadcasts.at(-1).data.atlas.slots.pgm_1.x,
			first.atlas.slots.pgm_1.x,
			'WS broadcast carries the same slots'
		)
		// the slots are packed from the top-left, not where the tiles sit on screen
		assert.equal(first.atlas.slots.pgm_1.y, 0)

		calls.length = 0
		await post(ctx, {
			atlas: true,
			cells: [cell('pgm_1', 0.6, 0.0, 0.3, 0.3), cell('prv_1', 0.0, 0.6, 0.32, 0.32, { role: 'prv' })],
		})
		assert.deepEqual(calls, [], 'moves + a small resize: zero AMCP')

		await post(ctx, {
			atlas: true,
			cells: [cell('pgm_1', 0.6, 0.0, 0.5, 0.5), cell('prv_1', 0.0, 0.6, 0.32, 0.32, { role: 'prv' })],
		})
		assert.ok(
			calls.some((c) => c.startsWith('fill')),
			'a > 25 % resize re-allocates'
		)
		assert.ok(!calls.some((c) => c.startsWith('play')), 'routes are unchanged — no PLAY')

		calls.length = 0
		const three = [
			cell('pgm_1', 0.6, 0.0, 0.5, 0.5),
			cell('prv_1', 0.0, 0.6, 0.32, 0.32, { role: 'prv' }),
			cell('src_route_8_1', 0, 0, 0.2, 0.2, { role: 'mvcell', srcCh: 1 }),
		]
		await post(ctx, { atlas: true, cells: three })
		assert.equal(calls.filter((c) => c.startsWith('commit')).length, 1, 'adding a source: exactly one apply')
		calls.length = 0
		await post(ctx, { atlas: true, cells: three })
		assert.deepEqual(calls, [], 'the same report again: zero AMCP')
	})

	it('persists the REPORTED cells, not the atlas rewrite, and GET returns the slots', async () => {
		const { ctx, store } = makeCtx('shm')
		await post(ctx, { atlas: true, cells: [cell('pgm_1', 0.5, 0.5, 0.3, 0.3)] })
		assert.deepEqual(store.get('operatorGuiLayout').cells[0].rect, { x: 0.5, y: 0.5, w: 0.3, h: 0.3 })
		assert.equal(store.get('operatorGuiAtlas'), true, 'mode is remembered across restarts')
		const got = getPersistedOperatorGuiLayout(ctx)
		assert.ok(got.atlas && got.atlas.slots.pgm_1)
	})

	it('reports without the key keep the remembered mode; a screen surface is never an atlas', async () => {
		const { ctx, calls } = makeCtx('shm')
		await post(ctx, { atlas: true, cells: [cell('pgm_1', 0.1, 0.1, 0.3, 0.3)] })
		calls.length = 0
		const r = await post(ctx, { cells: [cell('pgm_1', 0.4, 0.1, 0.3, 0.3)] })
		assert.ok(r.atlas, 'still atlas')
		assert.deepEqual(calls, [])

		resetOperatorGuiStateForTests()
		const scr = makeCtx('screen')
		const m = await post(scr.ctx, { atlas: true, cells: [cell('pgm_1', 0.1, 0.1, 0.3, 0.3)] })
		assert.equal(m.atlas, null)
		scr.calls.length = 0
		await post(scr.ctx, { atlas: true, cells: [cell('pgm_1', 0.4, 0.1, 0.3, 0.3)] })
		assert.ok(
			scr.calls.some((c) => c.startsWith('fill')),
			'mosaic mode: a move re-FILLs'
		)
	})

	it('switching atlas off re-applies the monitor mosaic', async () => {
		const { ctx, calls } = makeCtx('shm')
		await post(ctx, { atlas: true, cells: [cell('pgm_1', 0.5, 0.5, 0.3, 0.3)] })
		calls.length = 0
		const r = await post(ctx, { atlas: false, cells: [cell('pgm_1', 0.5, 0.5, 0.3, 0.3)] })
		assert.equal(r.atlas, null)
		assert.ok(
			calls.some((c) => c.startsWith('fill 5-10 0.5') || /fill \d+-10 0\.5/.test(c)),
			`mosaic FILL at the screen position: ${calls}`
		)
	})
})
