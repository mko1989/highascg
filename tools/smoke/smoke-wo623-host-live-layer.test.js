'use strict'

/**
 * WO-623 D — host-channel STOP / CLEAR / PLAY sequences are composed on the server
 * (`POST /api/host-live/layer`), not sent command by command from the clients over /api/raw.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { planLayerAction, handleHostLiveLayer } = require('../../src/api/host-live-layer')
const { handleLayerPost } = require('../../src/api/routes-host-live')

const ROOT = path.join(__dirname, '../..')
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function fakeCtx(failOn = null) {
	const sent = []
	return {
		sent,
		amcp: {
			raw: async (cmd) => {
				sent.push(cmd)
				if (failOn && failOn.test(cmd)) throw new Error('404 ERROR')
				return { ok: true }
			},
		},
	}
}

describe('WO-623 D — POST /api/host-live/layer', () => {
	it('plans the same sequences the clients used to send', () => {
		assert.deepEqual(planLayerAction({ action: 'stop', channel: 6, layer: 10 }).cmds, ['STOP 6-10', 'MIXER 6-10 CLEAR'])
		assert.deepEqual(planLayerAction({ action: 'decklink', channel: 5, layer: 2, device: 3 }).cmds, [
			'STOP 5-2',
			'MIXER 5-2 CLEAR',
			'PLAY 5-2 DECKLINK 3',
		])
		assert.deepEqual(planLayerAction({ action: 'route', channel: 1, layer: 321, route: 'route://5-4' }).cmds, [
			'STOP 1-321',
			'MIXER 1-321 CLEAR',
			'PLAY 1-321 route://5-4',
			'MIXER 1-321 OPACITY 0',
		])
		const pic = planLayerAction({ action: 'route', channel: 1, layer: 321, route: 'route://5', audioOnly: false })
		assert.deepEqual(pic.cmds, ['STOP 1-321', 'MIXER 1-321 CLEAR', 'PLAY 1-321 route://5'])
	})

	it('refuses bad input without touching Caspar', async () => {
		for (const p of [
			{ action: 'stop', channel: 0, layer: 1 },
			{ action: 'stop', channel: 1 },
			{ action: 'decklink', channel: 1, layer: 1 },
			{ action: 'route', channel: 1, layer: 1, route: 'alsa://hw:1,0' },
			{ action: 'route', channel: 1, layer: 1, route: 'route://5 ; CLEAR 1' },
			{ action: 'play', channel: 1, layer: 1 },
		]) {
			const ctx = fakeCtx()
			const res = await handleHostLiveLayer(ctx, p)
			assert.equal(res.status, 400, JSON.stringify(p))
			assert.deepEqual(ctx.sent, [])
		}
		assert.equal((await handleHostLiveLayer({}, { action: 'stop', channel: 1, layer: 1 })).status, 503)
	})

	it('a failing STOP / CLEAR is tolerated and reported; a failing PLAY is a 502', async () => {
		const soft = fakeCtx(/^(STOP|MIXER)/)
		const ok = await handleHostLiveLayer(soft, { action: 'decklink', channel: 5, layer: 2, device: 1 })
		assert.equal(ok.ok, true)
		assert.deepEqual(soft.sent, ['STOP 5-2', 'MIXER 5-2 CLEAR', 'PLAY 5-2 DECKLINK 1'])
		assert.deepEqual(
			ok.errors.map((e) => e.cmd),
			['STOP 5-2', 'MIXER 5-2 CLEAR'],
		)

		const hard = fakeCtx(/^PLAY/)
		const bad = await handleHostLiveLayer(hard, { action: 'route', channel: 1, layer: 321, route: 'route://5-4' })
		assert.equal(bad.status, 502)
		assert.match(bad.error, /PLAY 1-321 route:\/\/5-4/)
		assert.ok(!hard.sent.some((c) => /OPACITY/.test(c)), 'no OPACITY after a failed PLAY')

		const res = await handleLayerPost(JSON.stringify({ action: 'decklink', channel: 5, layer: 2, device: 1 }), hard)
		assert.equal(res.status, 502)
		assert.equal(JSON.parse(res.body).ok, false)
	})

	it('the switched client sites no longer compose STOP / CLEAR / PLAY over /api/raw', () => {
		for (const rel of [
			'client/lib/decklink-add-input.js',
			'client/components/sources-panel-live-render-actions.js',
			'client/lib/extra-live-source-remove.js',
			'client/components/inspector-live-audio-input.js',
			'client/lib/live-audio-routing.js',
			'godot/client/features/devices/input_slots_model.gd',
			'godot/client/features/devices/host_source_model.gd',
			'godot/client/features/devices/decklink_input_model.gd',
		]) {
			const s = src(rel)
			assert.ok(!s.includes('/api/raw'), `${rel} must not post raw AMCP`)
			assert.ok(s.includes('/api/host-live/layer'), `${rel} must use the server action`)
		}
	})

	it('is routed (Caspar required)', () => {
		assert.ok(
			src('src/api/router.js').includes(
				"routes.post('/api/host-live/layer', ({ body, ctx }) => routesHostLive.handleLayerPost(body, ctx), { requireCaspar: true })",
			),
		)
	})
})
