'use strict'

/**
 * WO-601 countdown inspector (Godot) — POST /api/scene/countdown routing, and the take/stage payload keeping a
 * countdown layer's own cgData (the lower-third branch used to claim any object cgData and send LT defaults).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { handleSceneCountdown } = require('../../src/api/routes-scene-countdown')
const { buildServerIncomingScene } = require('../../src/engine/scene-take-payload')

const map = { programChannels: [1], previewChannels: [2], programResolutions: [{ w: 1920, h: 1080 }] }
const look = { id: 'L1', mainScope: '0', layers: [{ layerNumber: 30, source: { type: 'template', value: 'countdown/countdown' } }] }

const run = async (action, config) => {
	const posts = []
	const r = await handleSceneCountdown({ sceneId: 'L1', layerNumber: 30, action, config }, {}, {
		resolveScene: () => look,
		getChannelMap: () => map,
		post: async (p, b) => { posts.push([p, b]); return { status: 200, body: JSON.stringify({ ok: true }) } },
	})
	return { body: JSON.parse(r.body), status: r.status, posts }
}

describe('WO-601 /api/scene/countdown', () => {
	it('set → /api/countdown/set on the edit bus with routing + config', async () => {
		const { body, posts } = await run('set', { durationSec: 60, posX: 120 })
		assert.equal(body.ok, true)
		assert.deepStrictEqual(posts, [['/api/countdown/set', { channel: 2, layer: 30, templateHostLayer: 0, durationSec: 60, posX: 120 }]])
	})
	it('transport actions carry the routing only; unknown action refused', async () => {
		for (const a of ['start', 'pause', 'reset']) {
			const { posts } = await run(a, { durationSec: 60 })
			assert.deepStrictEqual(posts, [[`/api/countdown/${a}`, { channel: 2, layer: 30, templateHostLayer: 0 }]])
		}
		assert.equal((await run('off')).status, 400)
	})
})

describe('WO-601 take payload keeps countdown cgData', () => {
	it('countdown layer → its own cgData, not lower-third defaults', async () => {
		const cfg = { mode: 'duration', durationSec: 60, posX: 120 }
		const sc = { id: 'L1', layers: [{ layerNumber: 30, source: { type: 'template', value: 'Countdown\\countdown', countdownConfig: cfg }, cgData: cfg }] }
		const inc = await buildServerIncomingScene(sc, { mainIdx: 0, channelMap: map, pgmOnly: false })
		assert.deepStrictEqual(inc.layers[0].cgData, cfg)
		assert.ok(!('name' in inc.layers[0].cgData), 'no LT fields')
	})
	it('lower thirds unchanged', async () => {
		const sc = { id: 'L1', layers: [{ layerNumber: 20, source: { type: 'template', value: 'lower-thirds/lt-classic-box', lowerThirdConfig: { title: 'Jan' } } }] }
		const inc = await buildServerIncomingScene(sc, { mainIdx: 0, channelMap: map, pgmOnly: false })
		assert.equal(inc.layers[0].cgData.name, 'Jan')
	})
})
