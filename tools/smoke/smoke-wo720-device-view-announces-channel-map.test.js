'use strict'

/**
 * WO-720 (found by the WO-719 GUI e2e run) — adding / re-moding / removing a screen destination in Devices changes the
 * channel map, but POST /api/device-view told no client: the Godot Store kept the old map (no PRV / PGM channel for a
 * new screen) until an unrelated settings save or a Caspar INFO CONFIG change broadcast one. Same class as WO-506.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const defaults = require('../../src/config/defaults')
const { handlePost } = require('../../src/api/routes-device-view')

function makeCtx() {
	const config = JSON.parse(JSON.stringify(defaults))
	config.screenDestinations = { version: 1, destinations: [] }
	const sent = []
	return {
		sent,
		config,
		configManager: { get: () => config, save: (next) => Object.assign(config, next) },
		_wsBroadcast: (type, data) => sent.push({ type, data }),
	}
}

const maps = (ctx) => ctx.sent.filter((m) => m.type === 'change' && m.data.path === 'channelMap').map((m) => m.data.value)

test('add → the new screen\'s PGM / PRV channels are broadcast; update and remove broadcast too', async () => {
	const ctx = makeCtx()
	const add = await handlePost(JSON.stringify({ addDestination: { type: 'pgm_prv', mainScreenIndex: 0 } }), ctx)
	assert.equal(add.status, 200)
	let m = maps(ctx)
	assert.equal(m.length, 1)
	assert.ok(m[0].programChannels.length >= 1 && m[0].previewChannels.length >= 1, JSON.stringify(m[0]))

	const id = ctx.config.screenDestinations.destinations[0].id
	await handlePost(JSON.stringify({ updateDestination: { id, videoMode: '720p5000', width: 1280, height: 720, fps: 50 } }), ctx)
	assert.equal(maps(ctx).length, 2)

	await handlePost(JSON.stringify({ removeDestination: { id } }), ctx)
	m = maps(ctx)
	assert.equal(m.length, 3)
	assert.equal(m[2].previewChannels.filter((c) => c != null).length, 0, 'the removed screen\'s PRV is gone from the announced map')
})

test('a rejected edit announces nothing', async () => {
	const ctx = makeCtx()
	const r = await handlePost(JSON.stringify({ removeDestination: { id: 'nope' } }), ctx)
	assert.notEqual(r.status, 200)
	assert.equal(maps(ctx).length, 0)
})
