'use strict'

/**
 * WO-598 C2 — PRV push by look id. The decision "MIXER-only nudge vs full re-take" uses the WEB's own
 * rule (client/lib/scenes-preview-snapshot.js isGeometryOnlyPreview) applied to what the server staged
 * on PRV (live-scene-state) vs the stored look; the handler then reuses the existing nudge and
 * take-look paths (no new AMCP builder).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { decidePreviewPush, handlePreviewPush } = require('../../src/api/routes-scene-preview-push')

const look = (over = {}) => ({
	id: 'L1', name: 'Look', mainScope: '0',
	layers: [
		{ layerNumber: 10, source: { type: 'media', value: 'CLIP_A' }, loop: true, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 }, opacity: 1 },
		{ layerNumber: 11, source: { type: 'media', value: 'LOGO' }, fill: { x: 0.7, y: 0.1, scaleX: 0.2, scaleY: 0.2 }, opacity: 1 },
	],
	...over,
})

describe('WO-598 C2 decidePreviewPush (web isGeometryOnlyPreview rule)', () => {
	it('same look staged, only geometry/opacity changed → nudge', async () => {
		const edited = look()
		edited.layers[1].fill = { x: 0.5, y: 0.5, scaleX: 0.3, scaleY: 0.3 }
		edited.layers[0].opacity = 0.5
		assert.equal(await decidePreviewPush({ sceneId: 'L1', scene: look() }, edited, 'L1'), 'nudge')
	})
	it('clip changed → take', async () => {
		const edited = look()
		edited.layers[0].source.value = 'CLIP_B'
		assert.equal(await decidePreviewPush({ sceneId: 'L1', scene: look() }, edited, 'L1'), 'take')
	})
	it('loop / audio / layer added → take', async () => {
		for (const mutate of [(s) => { s.layers[0].loop = false }, (s) => { s.layers[0].volume = 0.5 }, (s) => { s.layers.push({ layerNumber: 12, source: { value: 'X' } }) }]) {
			const edited = look()
			mutate(edited)
			assert.equal(await decidePreviewPush({ sceneId: 'L1', scene: look() }, edited, 'L1'), 'take')
		}
	})
	it('nothing staged / another look staged → take', async () => {
		assert.equal(await decidePreviewPush(null, look(), 'L1'), 'take')
		assert.equal(await decidePreviewPush({ sceneId: 'OTHER', scene: look() }, look(), 'L1'), 'take')
	})
	it('more layers than one nudge may carry → take', async () => {
		const many = look({ layers: Array.from({ length: 13 }, (_, i) => ({ layerNumber: 10 + i, source: { value: `C${i}` } })) })
		assert.equal(await decidePreviewPush({ sceneId: 'L1', scene: many }, many, 'L1'), 'take')
	})
})

describe('WO-598 C2 handlePreviewPush routing (deps injected)', () => {
	const map = { programChannels: [1], previewChannels: [2], programResolutions: [{ w: 1920, h: 1080, fps: 50 }] }
	const deps = (staged, calls) => ({
		resolveSceneById: (id) => (id === 'L1' ? look() : null),
		getChannelMap: () => map,
		getStaged: () => staged,
		nudge: async (b) => { calls.push(['nudge', b]); return { status: 200, body: JSON.stringify({ ok: true, lines: 8 }) } },
		takeLook: async (b) => { calls.push(['take', b]); return { status: 200, body: JSON.stringify({ ok: true }) } },
		registerStaged: async () => { calls.push(['register']) },
	})
	it('geometry-only → nudge with every sourced layer + staged payload refreshed', async () => {
		const calls = []
		const res = await handlePreviewPush({ sceneId: 'L1' }, {}, deps({ sceneId: 'L1', scene: look() }, calls))
		assert.equal(JSON.parse(res.body).mode, 'nudge')
		assert.equal(calls[0][0], 'nudge')
		assert.equal(calls[0][1].sceneId, 'L1')
		assert.equal(calls[0][1].mainIndex, 0)
		assert.equal(calls[0][1].layers.length, 2)
		assert.deepEqual(calls.map((c) => c[0]), ['nudge', 'register'])
	})
	it('content change → take-look preview with forceCut', async () => {
		const calls = []
		const res = await handlePreviewPush({ sceneId: 'L1' }, {}, deps({ sceneId: 'OTHER', scene: look() }, calls))
		assert.equal(JSON.parse(res.body).mode, 'take')
		assert.deepEqual(calls[0], ['take', { sceneId: 'L1', mainIdx: 0, target: 'preview', forceCut: true }])
	})
	it('nudge refused (staged look changed meanwhile) → falls back to take', async () => {
		const calls = []
		const d = deps({ sceneId: 'L1', scene: look() }, calls)
		d.nudge = async (b) => { calls.push(['nudge', b]); return { status: 200, body: JSON.stringify({ ok: false, staged: false }) } }
		const res = await handlePreviewPush({ sceneId: 'L1' }, {}, d)
		assert.equal(JSON.parse(res.body).mode, 'take')
		assert.deepEqual(calls.map((c) => c[0]), ['nudge', 'take'])
	})
	it('PGM-only main → no PRV push', async () => {
		const calls = []
		const d = deps(null, calls)
		d.getChannelMap = () => ({ programChannels: [1], previewChannels: [] })
		const res = await handlePreviewPush({ sceneId: 'L1' }, {}, d)
		assert.equal(JSON.parse(res.body).mode, 'none')
		assert.equal(calls.length, 0)
	})
	it('400 / 404', async () => {
		assert.equal((await handlePreviewPush({}, {}, deps(null, []))).status, 400)
		assert.equal((await handlePreviewPush({ sceneId: 'nope' }, {}, deps(null, []))).status, 404)
	})
})

describe('WO-598 C1/C2 resolve the look from the live deck, not the debounced disk copy', () => {
	const { resolveLiveSceneById } = require('../../src/engine/project-scenes-transform')
	it('ctx.sceneDeck.sceneSnapshots (validated deck sync) wins', () => {
		const ctx = { sceneDeck: { sceneSnapshots: [{ id: 'L1', name: 'fresh', layers: [] }] } }
		assert.equal(resolveLiveSceneById(ctx, 'L1').name, 'fresh')
	})
	it('unknown in the deck → disk fallback (null for an id nobody has)', () => {
		assert.equal(resolveLiveSceneById({ sceneDeck: { sceneSnapshots: [] } }, '__no_such_look__'), null)
		assert.equal(resolveLiveSceneById(null, ''), null)
	})
	it('take-look and preview-push default to it (source)', () => {
		const fs = require('fs')
		const p = require('path')
		for (const f of ['routes-scene-take-look.js', 'routes-scene-preview-push.js']) {
			const src = fs.readFileSync(p.join(__dirname, '../../src/api', f), 'utf8')
			assert.match(src, /resolveLiveSceneById\(ctx, sceneId\)|resolveLiveSceneById\(ctx, id\)/, `${f} resolves through the live deck`)
		}
	})
})
