'use strict'

/**
 * WO-624 E1 — Live-tab sources become operator compose windows through the server (POST /api/operator-gui/cell,
 * /cell/remove): the web WO-323 drop rules (sourceTileRejection, ~30% wide at the source aspect) now run in node, and
 * the new set is applied like a client report (route PLAY + FILL, persisted, broadcast) without stopping a running
 * media preview.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const defaults = require('../../src/config/defaults')
const { getChannelMap } = require('../../src/config/routing-map')
const { resetOperatorGuiStateForTests } = require('../../src/system/operator-gui-channel')
const { MEDIA_PREVIEW_LAYER } = require('../../src/system/operator-gui-channel-geometry')
const cellsLib = require('../../src/system/operator-gui-source-cells')
const routes = require('../../src/api/routes-operator-gui')

const GUI = { width: 1920, height: 1080 }

function config() {
	const app = JSON.parse(JSON.stringify(defaults))
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv' },
			{ id: 'og1', mainScreenIndex: 5, mode: 'operator_gui' },
		],
	}
	return app
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`)

describe('WO-624 planSourceCell — the web drop rules, server side', () => {
	const map = getChannelMap(config())
	const pgm = map.programChannels[0]
	const prv = map.previewChannels[0]

	it('a live input becomes an mvcell at the source aspect, 30% wide, centred on the drop', () => {
		const r = cellsLib.planSourceCell({ type: 'route', value: 'route://9', label: 'DeckLink 4', resolution: '1280×720' }, { x: 0.5, y: 0.5 }, [], map, GUI)
		assert.equal(r.cell.role, 'mvcell')
		assert.equal(r.cell.srcCh, 9)
		assert.equal(r.cell.id, 'src_route_9')
		assert.equal(r.cell.label, 'DeckLink 4')
		assert.deepEqual([r.cell.srcW, r.cell.srcH], [1280, 720])
		assert.deepEqual(r.cell.sourceTile, { type: 'route', value: 'route://9', label: 'DeckLink 4' })
		near(r.cell.rect.w, 0.3, 'w')
		near((r.cell.rect.w * 1920) / (r.cell.rect.h * 1080), 16 / 9, 'aspect in canvas px')
		near(r.cell.rect.x + r.cell.rect.w / 2, 0.5, 'centred x')
		near(r.cell.rect.y + r.cell.rect.h / 2, 0.5, 'centred y')
	})

	it('a drop at the canvas edge stays inside it (x = 0 is the left edge, not "missing")', () => {
		const r = cellsLib.planSourceCell({ value: 'route://9' }, { x: 0, y: 1 }, [], map, GUI)
		near(r.cell.rect.x, 0, 'left edge')
		near(r.cell.rect.y + r.cell.rect.h, 1, 'bottom edge')
		near((r.cell.rect.w * 1920) / (r.cell.rect.h * 1080), 16 / 9, 'no resolution → 16:9')
	})

	it('PGM / PRV routes become the main\'s own cells; a second copy is refused', () => {
		const r = cellsLib.planSourceCell({ value: `route://${prv}`, label: 'PRV: Main' }, { x: 0.2, y: 0.2 }, [], map, GUI)
		assert.deepEqual([r.cell.id, r.cell.role, r.cell.mainIndex], ['prv_1', 'prv', 0])
		assert.equal(r.cell.srcCh, undefined, 'pgm/prv cells resolve their channel from mainIndex')
		const dup = cellsLib.planSourceCell({ value: `route://${pgm}` }, {}, [{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: {} }], map, GUI)
		assert.deepEqual([dup.status, dup.error], [409, 'PGM 1 is already on the preview.'])
	})

	it('refuses non-routes, the compose channel itself, multiview outputs and duplicates', () => {
		assert.equal(cellsLib.planSourceCell({ value: 'AMB' }, {}, [], map, GUI).status, 400)
		const self = cellsLib.planSourceCell({ value: `route://${map.operatorGuiCh}` }, {}, [], map, GUI)
		assert.match(self.error, /compose output itself/)
		const boxLike = cellsLib.planSourceCell({ value: 'route://3' }, {}, [], { ...map, operatorGuiCh: null, operatorGuiChannels: [] }, GUI, 3)
		assert.match(boxLike.error, /compose output itself/, 'the resolved compose channel counts even when the map says null')
		const mv = cellsLib.planSourceCell({ value: 'route://7' }, {}, [], { ...map, multiviewChannels: [7] }, GUI)
		assert.match(mv.error, /multiview output/)
		const dup = cellsLib.planSourceCell({ value: 'route://9', label: 'DL' }, {}, [{ id: 'x', role: 'mvcell', srcCh: 9 }], map, GUI)
		assert.deepEqual([dup.status, dup.error], [409, 'DL is already on the preview.'])
	})
})

describe('WO-624 planRemoveCell', () => {
	const cells = [{ id: 'pgm_1' }, { id: 'src_route_9' }]
	it('removes by id; unknown → 404; the last window stays (an empty set is never persisted)', () => {
		assert.deepEqual(cellsLib.planRemoveCell('src_route_9', cells).cells, [{ id: 'pgm_1' }])
		assert.equal(cellsLib.planRemoveCell('nope', cells).status, 404)
		assert.equal(cellsLib.planRemoveCell('pgm_1', [{ id: 'pgm_1' }]).status, 409)
	})
})

describe('WO-624 POST /api/operator-gui/cell + /cell/remove — applied like a report', () => {
	it('adds the window (route PLAY + persisted + broadcast), keeps the media preview, then removes it', async () => {
		resetOperatorGuiStateForTests()
		const store = new Map()
		const calls = { play: [], fill: [], stop: [] }
		const broadcasts = []
		const ctx = {
			config: config(),
			log: () => {},
			persistence: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
			_wsBroadcast: (type, data) => broadcasts.push([type, data]),
			amcp: {
				play: async (ch, layer, route) => { calls.play.push([layer, route]) },
				mixerFill: async (ch, layer) => { calls.fill.push(layer) },
				stop: async (ch, layer) => { calls.stop.push(layer) },
				mixerClear: async () => {},
				mixerCommit: async () => {},
			},
		}
		const base = [
			{ id: 'prv_1', role: 'prv', mainIndex: 0, rect: { x: 0, y: 0, w: 0.3, h: 0.3 } },
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0.5, y: 0, w: 0.3, h: 0.3 } },
		]
		const media = { id: 'media', role: 'media', rect: { x: 0, y: 0.5, w: 0.3, h: 0.3 }, srcW: 1920, srcH: 1080 }
		await routes.handlePost('/api/operator-gui/layout', { cells: [...base, media] }, ctx)

		calls.play.length = 0
		calls.fill.length = 0
		const add = await routes.handlePost('/api/operator-gui/cell', { item: { type: 'route', value: 'route://9', label: 'DeckLink 4', resolution: '1920×1080' }, at: { x: 0.5, y: 0.8 } }, ctx)
		const body = JSON.parse(add.body)
		assert.equal(add.status, 200, add.body)
		assert.equal(body.cell.id, 'src_route_9')
		assert.deepEqual(calls.play, [[12, 'route://9']], 'only the new window is PLAYed (unchanged routes are skipped)')
		assert.ok(calls.fill.includes(MEDIA_PREVIEW_LAYER), 'the running media preview is re-filled, not dropped')
		assert.deepEqual(store.get('operatorGuiLayout').cells.map((c) => c.id), ['prv_1', 'pgm_1', 'src_route_9'])
		const last = broadcasts.at(-1)
		assert.equal(last[0], 'operatorGuiLayout')
		assert.deepEqual(last[1].cells.map((c) => c.id), ['prv_1', 'pgm_1', 'src_route_9'])

		const composeCh = require('../../src/system/operator-gui-channel').resolveOperatorGuiChannel(ctx.config).ch
		const self = await routes.handlePost('/api/operator-gui/cell', { item: { value: `route://${composeCh}` } }, ctx)
		assert.equal(self.status, 400, 'the handler refuses a self-route into the compose channel')
		const again = await routes.handlePost('/api/operator-gui/cell', { item: { value: 'route://9', label: 'DeckLink 4' } }, ctx)
		assert.equal(again.status, 409)

		const rm = await routes.handlePost('/api/operator-gui/cell/remove', { id: 'src_route_9' }, ctx)
		assert.equal(rm.status, 200, rm.body)
		assert.ok(calls.stop.includes(12), 'the removed window\'s route layer is hygiene-stopped')
		assert.deepEqual(store.get('operatorGuiLayout').cells.map((c) => c.id), ['prv_1', 'pgm_1'])
	})
})
