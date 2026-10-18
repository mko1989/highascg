'use strict'

/**
 * WO-601 — Godot lower-third + HTML-template inspector server side:
 * POST /api/scene/lower-third (web lower-third-cg-data.js; routing = edit bus; Play toggle by LOGICAL layer on the
 * routed channel) and POST /api/scene/layer-reload (CALL RELOAD on the channels staging the look, real layers).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { handleSceneLowerThird, editBusChannel } = require('../../src/api/routes-scene-lower-third')
const { handleLayerReload } = require('../../src/api/routes-scene-layer-tools')

const map = { programChannels: [1], previewChannels: [2], programResolutions: [{ w: 1920, h: 1080 }] }
const look = {
	id: 'L1', mainScope: '0',
	layers: [
		{ layerNumber: 20, source: { type: 'template', value: 'lower-thirds/lt-classic-box', lowerThirdConfig: { title: 'Jan', subtitle: 'CEO' } } },
		{ layerNumber: 30, source: { type: 'template', value: 'playback_timers.html' } },
		{ layerNumber: 12, source: { type: 'html', value: 'https://example.org' } },
		{ layerNumber: 10, source: { type: 'media', value: 'CLIP' } },
	],
}
const lt = (action, extra = {}, deps = {}) => {
	const posts = []
	const p = handleSceneLowerThird({ sceneId: 'L1', layerNumber: 20, action, ...extra }, {}, {
		resolveScene: () => look,
		getChannelMap: () => map,
		post: async (path, body) => { posts.push([path.split('/').pop(), body]) },
		lowerThirds: { handleGet: () => ({ body: JSON.stringify({ templates: [{ id: 'lt-classic-box', name: 'Classic Box' }] }) }) },
		...deps,
	})
	return p.then((r) => ({ body: JSON.parse(r.body), status: r.status, posts }))
}

describe('WO-601 /api/scene/lower-third', () => {
	it('resolve → stored config + template name + fonts', async () => {
		const { body } = await lt('resolve')
		assert.equal(body.config.title, 'Jan')
		assert.equal(body.config.titleFontSize, 46, 'defaults filled')
		assert.equal(body.templateName, 'Classic Box')
		assert.ok(body.fonts.some((f) => f.id === 'georgia'))
		assert.equal(body.debounceMs, 450)
	})
	it('update → /lower-thirds/update on the edit bus (PRV) with the web payload', async () => {
		const { body, posts } = await lt('update', { config: { title: 'Anna', titleFontSize: 52 } })
		assert.equal(body.channel, 2)
		assert.equal(posts.length, 1)
		const [p, b] = posts[0]
		assert.equal(p, 'update')
		assert.equal(b.channel, 2)
		assert.equal(b.layer, 20)
		assert.equal(b.templateHostLayer, 1)
		assert.equal(b.data.name, 'Anna')
		assert.equal(b.style.titleFontSize, 52)
	})
	it('play: not loaded → load + update + play; loaded here → update + play; playing here → stop', async () => {
		assert.deepStrictEqual((await lt('play', {}, { ltState: {} })).posts.map((x) => x[0]), ['load', 'update', 'play'])
		assert.equal((await lt('play', {}, { ltState: {} })).posts[0][1].templateId, 'lt-classic-box')
		const loaded = { 2: { templateId: 'lt-classic-box', logicalLayer: 20, layer: 710, playing: false } }
		assert.deepStrictEqual((await lt('play', {}, { ltState: loaded })).posts.map((x) => x[0]), ['update', 'play'])
		const playing = { 2: { ...loaded[2], playing: true } }
		assert.deepStrictEqual((await lt('play', {}, { ltState: playing })).posts.map((x) => x[0]), ['stop'], 'animates out (host layer 710 ≠ 20 — compared by logical layer)')
		const otherCh = { 1: playing[2] }
		assert.deepStrictEqual((await lt('play', {}, { ltState: otherCh })).posts.map((x) => x[0]), ['load', 'update', 'play'], 'state of another channel ignored')
	})
	it('clear; non-LT layer → 404; PGM-only main → PGM channel', async () => {
		assert.deepStrictEqual((await lt('clear')).posts.map((x) => x[0]), ['clear'])
		assert.equal((await lt('resolve', { layerNumber: 10 })).status, 404)
		assert.equal(editBusChannel({ programChannels: [1], previewChannels: [1] }, 0), 1)
		assert.equal(editBusChannel({ programChannels: [3], previewChannels: [] }, 0), 3)
	})
})

describe('WO-601 /api/scene/layer-reload', () => {
	const reload = async (ln, staged, bank = 'a') => {
		const sent = []
		await handleLayerReload({ sceneId: 'L1', layerNumber: ln }, { programLayerBankByChannel: { 1: bank } }, {
			resolveScene: () => look,
			getChannelMap: () => map,
			getStaged: (ch) => staged[ch],
			raw: async (l) => { sent.push(l) },
		})
		return sent
	}
	it('only channels staging this look; template → CG host layer; html → look layer (+100 on PGM bank B)', async () => {
		assert.deepStrictEqual(await reload(12, { 2: { sceneId: 'L1' } }), ['CALL 2-12 RELOAD'])
		assert.deepStrictEqual(await reload(12, { 2: { sceneId: 'L1' }, 1: { sceneId: 'L1' } }, 'b'), ['CALL 2-12 RELOAD', 'CALL 1-112 RELOAD'])
		assert.deepStrictEqual(await reload(12, { 2: { sceneId: 'OTHER' } }), [])
		const tpl = await reload(30, { 2: { sceneId: 'L1' } })
		assert.equal(tpl.length, 1)
		assert.match(tpl[0], /^CALL 2-7\d\d RELOAD$/, 'template CG overlay host (700+)')
	})
})

describe('WO-601 timersConfig reaches scene.live (server take/stage payload)', () => {
	it('buildServerIncomingScene keeps source.timersConfig', async () => {
		const { buildServerIncomingScene } = require('../../src/engine/scene-take-payload')
		const cfg = { columns: 3, compact: true, titleFontSize: 40 }
		const sc = { id: 'L1', layers: [{ layerNumber: 30, source: { type: 'template', value: 'playback_timers.html', timersConfig: cfg } }] }
		const inc = await buildServerIncomingScene(sc, { mainIdx: 0, channelMap: map, pgmOnly: false })
		assert.deepStrictEqual(inc.layers[0].source.timersConfig, cfg)
	})
})
