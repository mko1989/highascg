'use strict'

/**
 * WO-1106 A8 — the Game World service hands the hub its board provider (modules/game-world/server/world-service.js):
 * house level and scene (the same { json, glb?rev } `hello` carries) reach the world pages' 2 Hz `board`.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHub, BOARD_EVERY } = require('../../modules/game-world/server/world-hub')
const { createWorldService } = require('../../modules/game-world/server/world-service')

function fakeDesc(id, order) {
	const d = {
		id,
		title: id.toUpperCase(),
		order,
		models: {},
		paths: { scene: `/api/game/${id}/scene`, glb: `/api/game/${id}/scene.glb` },
		on: false,
		rev: 'rev 1',
		adapter: { id, entities: () => [], viewers: () => [], send() {}, board: () => ({ phase: 'lobby', endsAt: null, top: [], players: 0, bots: 0 }), area: () => null },
		room: () => (d.on ? d.adapter : null),
		host(b) {
			if (b.action === 'enable') d.on = true
			else if (b.action === 'disable') d.on = false
			return { status: 200, body: { ok: true } }
		},
		state: () => (d.on ? { enabled: true, sceneRev: d.rev } : { enabled: false }),
	}
	return d
}

test('A8: board has the house level and the hello scene; both follow the operator', () => {
	const reg = { v: 1, games: new Map(), hub: null }
	const rc = fakeDesc('rc', 1)
	const sk = fakeDesc('sk', 2)
	for (const d of [rc, sk]) reg.games.set(d.id, d)
	const hub = createHub({ registry: reg, timers: { setInterval: () => 1, clearInterval: () => {} }, now: () => 1000, seed: 1, defer: (fn) => fn() })
	const svc = createWorldService({ hub, registry: reg })
	svc.host({ action: 'enable' })
	const page = []
	hub.openWorld((m) => void page.push(m))
	const boardNow = () => {
		for (let i = 0; i < BOARD_EVERY; i++) hub.tick()
		return page.filter((m) => m.t === 'board').at(-1)
	}
	let b = boardNow()
	assert.equal(b.house, null, 'never set: null, as in hello')
	assert.deepEqual(b.scene, svc.state().scene, 'the scene hello carries')
	assert.deepEqual(b.scene, { json: '/api/game/rc/scene', glb: '/api/game/rc/scene.glb?rev=rev%201' })
	svc.host({ action: 'house', level: 0.4 })
	assert.equal(boardNow().house, 0.4)
	svc.host({ action: 'house', level: 0 })
	assert.equal(boardNow().house, 0, 'dimmed')
	rc.rev = 'rev 2'
	assert.equal(boardNow().scene.glb, '/api/game/rc/scene.glb?rev=rev%202', 'a new scene rev reaches the page')
	assert.deepEqual(boardNow().games.map((g) => g.paused), [false, false])
	hub.dispose()
})
