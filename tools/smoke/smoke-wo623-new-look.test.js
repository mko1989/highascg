'use strict'

/**
 * WO-623 B / WO-598 thin client — POST /api/scene/new-look builds the look the web makes for the deck "+" tile
 * (scene-state.js addScene) and for a media drop on blank deck space (scenes-editor-deck-drop.js: addScene → addLayer →
 * setLayerSource → native fill): migrateScene({ id, name: `Look ${n + 1}`, layers: [], mainScope, defaultTransition:
 * { ...defaultTransition(), ...global } }) with the dropped source on layer 10 — built, never stored.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { pathToFileURL } = require('url')

const { handleNewLook } = require('../../src/api/routes-scene-new-look')

const deps = (over = {}) => ({
	projectScenes: () => ({ scenes: [{ id: 'a' }, { id: 'b' }], globalDefaultTransition: { type: 'PUSH', duration: 20 } }),
	getChannelMap: () => ({ programResolutions: [{ w: 1920, h: 1080 }, { w: 3840, h: 1080 }] }),
	editorDefaults: () => ({ scene: { loop: true, contentFit: 'native' } }),
	mediaResolution: async () => ({ w: 1280, h: 720 }),
	fileDefaults: () => null,
	...over,
})
const parse = (r) => ({ status: r.status, ...JSON.parse(r.body) })
const helpers = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'client', 'lib', 'scene-state-helpers.js')).href)

describe('WO-623 new-look — the look the web deck "+" / blank-space drop creates', () => {
	it('empty look ("+"): web addScene shape — Look N+1, column scope, global default transition over the default', async () => {
		const r = parse(await handleNewLook({ mainIdx: 1 }, {}, deps()))
		const h = await helpers()
		assert.equal(r.ok, true)
		const L = r.look
		assert.match(L.id, /^[0-9a-f-]{36}$|^sc_/, 'newId()')
		assert.deepEqual(L, h.migrateScene({ id: L.id, name: 'Look 3', layers: [], mainScope: '1', defaultTransition: { ...h.defaultTransition(), type: 'PUSH', duration: 20 } }))
	})
	it('media drop: the source on layer 10 with native fill on the main\'s canvas', async () => {
		const r = parse(await handleNewLook({ mainIdx: 1, source: { type: 'media', value: 'CLIPS/A', label: 'A' } }, {}, deps()))
		assert.equal(r.look.layers.length, 1)
		const layer = r.look.layers[0]
		assert.equal(layer.layerNumber, 10, 'first layer of an empty look')
		assert.deepEqual(layer.source, { type: 'media', value: 'CLIPS/A', label: 'A' })
		assert.equal(layer.loop, true, 'editor defaults applied')
		assert.deepEqual(layer.fill, { x: (3840 - 1280) / 2 / 3840, y: (1080 - 720) / 2 / 1080, scaleX: 1280 / 3840, scaleY: 720 / 1080 }, 'main 1 is 3840×1080')
		assert.deepEqual(r.contentResolution, { w: 1280, h: 720 })
	})
	it('WO-762: a media drop names the look after the file — no folder, no extension; other sources keep Look N+1', async () => {
		const { mediaLookName } = require('../../src/api/routes-scene-new-look')
		assert.equal(parse(await handleNewLook({ mainIdx: 1, source: { type: 'media', value: 'projects/show/KV LOOP.mp4' } }, {}, deps())).look.name, 'KV LOOP')
		assert.equal(mediaLookName({ type: 'media', value: 'CLIPS/A' }), 'A', 'a Caspar id has no extension')
		assert.equal(mediaLookName({ type: 'media', value: 'Intro v1.2' }), 'Intro v1.2', 'a one-char tail is not an extension')
		assert.equal(mediaLookName({ type: 'media', value: 'win\\dir\\Logo.png' }), 'Logo')
		assert.equal(mediaLookName({ type: 'template', value: 'lower-thirds/lt.html' }), '')
		assert.equal(mediaLookName(null), '')
	})
	it('the live deck count wins over the stored project (snapshots arrive before the 750 ms disk write)', async () => {
		const ctx = { sceneDeck: { sceneSnapshots: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] } }
		assert.equal(parse(await handleNewLook({ mainIdx: 0 }, ctx, deps())).look.name, 'Look 5')
		assert.equal(parse(await handleNewLook({ mainIdx: 0 }, {}, deps({ projectScenes: () => null }))).look.name, 'Look 1', 'no project yet')
	})
	it('mainScope: explicit all / digit kept, junk → 0; ids are unique per call', async () => {
		assert.equal(parse(await handleNewLook({ mainIdx: 1, mainScope: 'all' }, {}, deps())).look.mainScope, 'all')
		assert.equal(parse(await handleNewLook({ mainScope: '7' }, {}, deps())).look.mainScope, '0')
		const a = parse(await handleNewLook({}, {}, deps())).look.id
		const b = parse(await handleNewLook({}, {}, deps())).look.id
		assert.notEqual(a, b)
	})
	it('refusals: empty source value, a timer payload, a self-route into this main\'s PGM', async () => {
		assert.equal(parse(await handleNewLook({ source: { type: 'media', value: ' ' } }, {}, deps())).status, 400)
		assert.equal(parse(await handleNewLook({ source: { type: 'timer', value: 'countdown' } }, {}, deps())).status, 400)
		const cm = () => ({ programResolutions: [{ w: 1920, h: 1080 }], programChannels: [1], previewChannels: [2] })
		const r = parse(await handleNewLook({ mainIdx: 0, source: { type: 'route', value: 'route://1' } }, {}, deps({ getChannelMap: cm })))
		assert.equal(r.status, 400, r.error)
	})
})
