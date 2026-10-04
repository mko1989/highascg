'use strict'

/**
 * WO-592 — media-inspector kiosk preview: role 'media' cell on the operator-GUI channel's fixed
 * media layer, never persisted/broadcast, cleared on withdrawal; POST /api/media/preview.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const defaults = require('../../src/config/defaults')
const { computeOperatorGuiCellPlan, MEDIA_PREVIEW_LAYER, ROUTE_LAYER_MAX } = require('../../src/system/operator-gui-channel-geometry')
const { applyOperatorGuiLayout, resetOperatorGuiStateForTests } = require('../../src/system/operator-gui-channel')
const { resetMediaPreviewLayerStateForTests } = require('../../src/system/operator-gui-media-layer')
const { handleMediaPreviewPost } = require('../../src/api/routes-media-preview')
const { REPO_ROOT } = require('../../src/repo-paths')

const clone = (o) => JSON.parse(JSON.stringify(o))

function guiCtx() {
	const app = clone(defaults)
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv' },
			{ id: 'og1', mainScreenIndex: 5, mode: 'operator_gui' },
		],
	}
	const calls = []
	const rec = (name) => async (...args) => {
		calls.push([name, ...args])
		return {}
	}
	const store = new Map()
	const amcp = {
		play: rec('play'),
		// Real AmcpClient has no flat `load` alias (amcp-client-commands.js) — only basic.load.
		basic: { load: rec('load') },
		resume: rec('resume'),
		pause: rec('pause'),
		call: rec('call'),
		mixerFill: rec('mixerFill'),
		stop: rec('stop'),
		mixerClear: rec('mixerClear'),
		mixerCommit: rec('mixerCommit'),
	}
	const broadcasts = []
	return {
		calls,
		store,
		broadcasts,
		ctx: {
			config: app,
			amcp,
			log: () => {},
			persistence: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
			_wsBroadcast: (type, data) => broadcasts.push([type, data]),
		},
	}
}

const pgm = { id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }
const media = { id: 'media-preview', role: 'media', srcW: 1920, srcH: 1080, rect: { x: 0.6, y: 0.1, w: 0.3, h: 0.3 } }

describe('WO-592 media preview cell plan', () => {
	it('media cell lands on the fixed media layer outside the route range, with no route', () => {
		assert.ok(MEDIA_PREVIEW_LAYER > ROUTE_LAYER_MAX)
		const plan = computeOperatorGuiCellPlan([media, pgm], { programChannels: [1], previewChannels: [2] })
		const m = plan.find((e) => e.media)
		const r = plan.find((e) => !e.media)
		assert.equal(m.layer, MEDIA_PREVIEW_LAYER)
		assert.equal(m.route, null)
		assert.equal(r.layer, 10, 'route cells still number from 10 regardless of the media cell')
		assert.equal(r.route, 'route://1')
	})
})

describe('WO-592 apply: media layer positioned, not persisted, cleared on withdrawal', () => {
	it('FILLs the media layer, never PLAYs it, and keeps it out of persistence + broadcast', async () => {
		resetOperatorGuiStateForTests()
		resetMediaPreviewLayerStateForTests()
		const { ctx, calls, store, broadcasts } = guiCtx()
		await applyOperatorGuiLayout(ctx, [pgm, media])
		assert.ok(calls.some((c) => c[0] === 'mixerFill' && c[2] === MEDIA_PREVIEW_LAYER))
		assert.ok(!calls.some((c) => c[0] === 'play' && c[2] === MEDIA_PREVIEW_LAYER))
		assert.deepEqual(store.get('operatorGuiLayout').cells.map((c) => c.role), ['pgm'])
		const last = broadcasts.filter((b) => b[0] === 'operatorGuiLayout').pop()
		assert.deepEqual(last[1].cells.map((c) => c.role), ['pgm'])
	})

	it('stops + clears the media layer only on the present → absent transition', async () => {
		resetOperatorGuiStateForTests()
		resetMediaPreviewLayerStateForTests()
		const { ctx, calls } = guiCtx()
		await applyOperatorGuiLayout(ctx, [pgm])
		assert.ok(!calls.some((c) => c[0] === 'stop' && c[2] === MEDIA_PREVIEW_LAYER), 'no media cell before → untouched (a fresh LOAD survives)')
		await applyOperatorGuiLayout(ctx, [pgm, media])
		calls.length = 0
		await applyOperatorGuiLayout(ctx, [pgm])
		assert.ok(calls.some((c) => c[0] === 'stop' && c[2] === MEDIA_PREVIEW_LAYER))
		assert.ok(calls.some((c) => c[0] === 'mixerClear' && c[2] === MEDIA_PREVIEW_LAYER))
	})
})

describe('WO-592 POST /api/media/preview', () => {
	it('load → LOAD on the GUI channel media layer; play/pause/seek drive the same layer', async () => {
		const { ctx, calls } = guiCtx()
		const r = await handleMediaPreviewPost({ action: 'load', id: 'Folder/clip.mov' }, ctx)
		assert.equal(r.status, 200)
		const body = JSON.parse(r.body)
		assert.equal(body.layer, MEDIA_PREVIEW_LAYER)
		const load = calls.find((c) => c[0] === 'load')
		assert.equal(load[1], body.channel)
		assert.equal(load[2], MEDIA_PREVIEW_LAYER)
		await handleMediaPreviewPost({ action: 'play' }, ctx)
		// 2.5 s on the 50p operator-GUI channel → SEEK 125 (channel frames, not file frames)
		await handleMediaPreviewPost({ action: 'seek', seconds: 2.5 }, ctx)
		assert.ok(calls.some((c) => c[0] === 'resume' && c[2] === MEDIA_PREVIEW_LAYER))
		assert.ok(calls.some((c) => c[0] === 'call' && c[3] === 'SEEK' && c[4] === '125'))
	})

	it('rejects traversal ids and unknown actions; 409 without an operator screen', async () => {
		const { ctx } = guiCtx()
		assert.equal((await handleMediaPreviewPost({ action: 'load', id: '../etc/passwd' }, ctx)).status, 400)
		assert.equal((await handleMediaPreviewPost({ action: 'explode' }, ctx)).status, 400)
		ctx.config.screenDestinations.destinations.pop()
		assert.equal((await handleMediaPreviewPost({ action: 'play' }, ctx)).status, 409)
	})

	it('router registers the route ahead of the generic /api/media/* catch-all', () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, 'src/api/router.js'), 'utf8')
		const a = src.indexOf("routes.post('/api/media/preview'")
		const b = src.indexOf("routes.post('/api/media/*'")
		assert.ok(a > 0 && b > a)
	})
})
