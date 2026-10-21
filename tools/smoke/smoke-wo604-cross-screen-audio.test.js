'use strict'

/**
 * WO-604 — cross-screen audio routing on the server: POST /api/audio/cross-screen/plan gives the Screens-row button
 * states (web WO-284 rules, one implementation); POST /api/audio/cross-screen toggles one audio-only route onto the
 * target PGM's dest layer (300 + ch·1000 + layer) and returns the next `audioScreens` list.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { handlePlan, handleToggle } = require('../../src/api/routes-audio-cross-screen')

function ctx(fail = '') {
	const sent = []
	return {
		sent,
		config: { casparServer: { screen_count: 2 } },
		amcp: {
			raw: async (c) => {
				sent.push(c)
				if (fail && c.startsWith(fail)) throw new Error('boom')
			},
		},
	}
}
const json = (r) => JSON.parse(r.body)

describe('WO-604 cross-screen plan', () => {
	it('lists the program channels and marks host / ok buttons', async () => {
		const r = json(await handlePlan({ sources: [{ channel: 1, layer: 12 }] }, ctx()))
		assert.deepEqual(r.screens, [
			{ channel: 1, index: 0 },
			{ channel: 3, index: 1 },
		])
		const [src] = r.sources
		assert.equal(src.destLayer, 1312)
		assert.deepEqual(
			src.buttons.map((b) => [b.channel, b.ok, b.host]),
			[
				[1, false, true],
				[3, true, false],
			]
		)
		assert.match(src.buttons[0].reasonText, /Host channel/)
	})
	it('an invalid source gets disabled buttons, no throw', async () => {
		const r = json(await handlePlan({ sources: [{ channel: 0, layer: 1 }] }, ctx()))
		assert.equal(r.sources[0].destLayer, null)
		assert.ok(r.sources[0].buttons.every((b) => !b.ok && b.reason === 'invalid-source-channel'))
	})
	it('no sources → empty list', async () => {
		assert.deepEqual(json(await handlePlan('', ctx())).sources, [])
	})
})

describe('WO-604 cross-screen toggle', () => {
	it('enable routes audio-only onto the target PGM dest layer', async () => {
		const c = ctx()
		const r = await handleToggle({ channel: 1, layer: 12, target: 3, enable: true, current: [] }, c)
		assert.equal(r.status, 200)
		assert.deepEqual(json(r).targets, [3])
		assert.ok(c.sent.includes('PLAY 3-1312 route://1-12'), c.sent.join(' | '))
		assert.ok(
			c.sent.some((s) => s === 'MIXER 3-1312 OPACITY 0'),
			c.sent.join(' | ')
		)
	})
	it('disable stops + clears the same layer and drops the target', async () => {
		const c = ctx()
		const r = json(await handleToggle({ channel: 1, layer: 12, target: 3, enable: false, current: [3] }, c))
		assert.deepEqual(r.targets, [])
		assert.deepEqual(c.sent, ['STOP 3-1312', 'MIXER 3-1312 CLEAR'])
	})
	it('host / preview / input targets are refused before any AMCP', async () => {
		for (const target of [1, 2, 99]) {
			const c = ctx()
			const r = await handleToggle({ channel: 1, layer: 12, target, enable: true, current: [3] }, c)
			assert.equal(r.status, 400)
			assert.deepEqual(json(r).targets, [3])
			assert.deepEqual(c.sent, [])
		}
	})
	it('a failed PLAY keeps the current targets (nothing persisted for audio nobody hears)', async () => {
		const r = await handleToggle({ channel: 1, layer: 12, target: 3, enable: true, current: [] }, ctx('PLAY'))
		assert.equal(r.status, 502)
		assert.deepEqual(json(r).targets, [])
	})
})

describe('WO-604 cross-screen — the web client uses the same endpoint', () => {
	it('the web apply posts to /api/audio/cross-screen and sends no route itself', () => {
		const src = require('node:fs').readFileSync(
			require('node:path').join(__dirname, '../../client/lib/audio-cross-screen-apply.js'),
			'utf8'
		)
		assert.match(
			src,
			/api\.post\('\/api\/audio\/cross-screen', \{[\s\S]*target: check\.targetChannel,[\s\S]*current,[\s\S]*audioOnly:/
		)
		assert.doesNotMatch(src, /playRouteOnChannel|clearRouteFromChannel|host-live\/layer/)
	})
})
