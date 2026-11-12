'use strict'

/**
 * WO-1044 — preview-push `target: 'pgm'` (the look editor with its screen's PGM edit unlocked): the edit goes to the
 * look ON AIR — a PGM MIXER nudge for geometry, a cut program take with PRV left alone for content — and never puts a
 * look on air that is not already there.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { handlePreviewPush } = require('../../src/api/routes-scene-preview-push')
const { canonValue } = require('../../src/api/routes-scene-pgm-edit-push')

const look = () => ({
	id: 'L1', name: 'Look', mainScope: '0',
	layers: [
		{ layerNumber: 10, source: { type: 'media', value: 'CLIP_A' }, loop: true, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 }, opacity: 1 },
		{ layerNumber: 11, source: { type: 'media', value: 'LOGO' }, fill: { x: 0.7, y: 0.1, scaleX: 0.2, scaleY: 0.2 }, opacity: 1 },
	],
})
const map = { programChannels: [1], previewChannels: [2], programResolutions: [{ w: 1920, h: 1080, fps: 50 }] }

function deps(edited, live, calls, nudgeReply = { ok: true, lines: 6 }) {
	return {
		resolveSceneById: (id) => (id === 'L1' ? edited : null),
		getChannelMap: () => map,
		getStaged: (ch) => { calls.push(['live', ch]); return live },
		nudge: async (b) => { calls.push(['nudge', b]); return { status: 200, body: JSON.stringify(nudgeReply) } },
		takeLook: async (b) => { calls.push(['take', b]); return { status: 200, body: JSON.stringify({ ok: true }) } },
		registerLive: async () => { calls.push(['register']) },
		registerStaged: async () => { calls.push(['registerPrv']) },
	}
}

describe('WO-1044 PGM edit push', () => {
	it('geometry edit of the look on air → PGM nudge on the program channel, live entry refreshed', async () => {
		const calls = []
		const edited = look()
		edited.layers[1].fill = { x: 0.4, y: 0.4, scaleX: 0.3, scaleY: 0.3 }
		const res = await handlePreviewPush({ sceneId: 'L1', mainIdx: 0, target: 'pgm' }, {}, deps(edited, { sceneId: 'L1', scene: look() }, calls))
		const body = JSON.parse(res.body)
		assert.equal(res.status, 200)
		assert.equal(body.mode, 'nudge')
		assert.equal(body.programChannel, 1)
		assert.deepEqual(calls.map((c) => c[0]), ['live', 'nudge', 'register'])
		assert.equal(calls[0][1], 1, 'compares against what is live on PGM (ch 1), not PRV')
		assert.equal(calls[1][1].target, 'pgm')
	})
	it('content edit → cut program take, no pgm→prv exchange', async () => {
		const calls = []
		const edited = look()
		edited.layers[0].source.value = 'CLIP_B'
		const res = await handlePreviewPush({ sceneId: 'L1', mainIdx: 0, target: 'pgm' }, {}, deps(edited, { sceneId: 'L1', scene: look() }, calls))
		assert.equal(JSON.parse(res.body).mode, 'take')
		assert.deepEqual(calls.at(-1), ['take', { sceneId: 'L1', mainIdx: 0, target: 'program', forceCut: true, previewExchange: false }])
	})
	it('a look that is not on air is never pushed to PGM', async () => {
		const calls = []
		const res = await handlePreviewPush({ sceneId: 'L1', mainIdx: 0, target: 'pgm' }, {}, deps(look(), { sceneId: 'OTHER', scene: look() }, calls))
		assert.equal(res.status, 409)
		assert.equal(JSON.parse(res.body).mode, 'not_on_air')
		assert.deepEqual(calls.map((c) => c[0]), ['live'])
	})
	it('the look left air inside the nudge chain → refused, not re-taken', async () => {
		const calls = []
		const edited = look()
		edited.layers[0].opacity = 0.5
		const res = await handlePreviewPush({ sceneId: 'L1', mainIdx: 0, target: 'pgm' }, {}, deps(edited, { sceneId: 'L1', scene: look() }, calls, { ok: false, staged: false }))
		assert.equal(res.status, 409)
		assert.ok(!calls.some((c) => c[0] === 'take'))
	})
	it('the last source removed → refused (blanking a screen is a take)', async () => {
		const calls = []
		const res = await handlePreviewPush({ sceneId: 'L1', mainIdx: 0, target: 'pgm' }, {}, deps({ ...look(), layers: [] }, { sceneId: 'L1', scene: look() }, calls))
		assert.equal(res.status, 409)
		assert.ok(!calls.some((c) => c[0] === 'take' || c[0] === 'nudge'))
	})
	it('the same file named two ways (live `projects/<slug>/…`, deck bare) is not new content → nudge, no cut on air', async () => {
		const calls = []
		const onAir = look()
		onAir.layers[0].source.value = 'projects/narvil/CLIP_A'
		onAir.layers[1].source.value = 'projects/narvil/LOGO'
		const edited = look()
		edited.layers[1].opacity = 0.4
		const d = deps(edited, { sceneId: 'L1', scene: onAir }, calls)
		d.canonMedia = (sc) => ({ ...sc, layers: sc.layers.map((l) => ({ ...l, source: { ...l.source, value: canonValue(l.source.value, 'narvil', {}) } })) })
		const res = await handlePreviewPush({ sceneId: 'L1', mainIdx: 0, target: 'pgm' }, {}, d)
		assert.equal(JSON.parse(res.body).mode, 'nudge')
		assert.ok(!calls.some((c) => c[0] === 'take'))
		assert.equal(canonValue('Czarek 35 lat.mp4', 'narvil', {}), canonValue('projects/narvil/Czarek 35 lat.mp4', 'narvil', {}))
		assert.equal(canonValue('udp://127.0.0.1:52201', 'narvil', {}), 'udp://127.0.0.1:52201', 'streams untouched')
	})
	it('take-look carries previewExchange:false to the take engine and through a cluster relay', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-scene-take-look.js'), 'utf8')
		assert.match(src, /target === 'program' && b\.previewExchange === false \? \{ previewExchange: false \}/)
		assert.match(src, /if \(b\.previewExchange === false\) out\.previewExchange = false/)
	})
})
