'use strict'

/**
 * todos20.07.26 (owner, work/VERIFY_NOW.md next to "Route looks land on one frame"):
 *   "the route shouldnt go to live sources browser but be added as a new layer in that look only."
 *
 * Before: the ↗ button on a look layer row built an `extraLiveSources` item and POSTed it to
 * `/api/device-view` (`addExtraLiveSource`) — the route showed up in the global Sources browser and
 * marked Caspar restart-dirty, while NO layer was added to the look.
 *
 * After: the ↗ button adds a new layer to the CURRENT look pointing at `route://<ch>-<srcLayer>`,
 * and writes nothing global.
 *
 * Covered here:
 *   1. the descriptor builder still resolves the bus channel and emits `route://ch-layer`
 *   2. `addRouteLayerToLook` appends exactly one layer to the look and gives it the route source
 *   3. no live-source registration remains on the path (static: the row module neither references
 *      `addExtraLiveSource` nor imports the api client / caspar-restart-dirty hint)
 *   4. the resulting intra-look route still passes the self-route guard, still gets bank-remapped,
 *      and still partitions as a same-channel route job — i.e. the WO-259 "one frame" batching that
 *      smoke-wo259-two-phase-batch.test.js covers keeps applying to a route made this way.
 */

const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
	assertSceneHasNoSelfRoutes,
	findSceneSelfRouteViolation,
	remapIntraLookRoutesForTakeChannel,
	partitionTakeJobsPlayOrder,
	orderRouteJobsByDependency,
} = require('../../src/engine/scene-route-deps')

const REPO = path.resolve(__dirname, '../..')
const ROW_FILE = path.join(REPO, 'client/components/scene-layer-row.js')
const ROUTE_FILE = path.join(REPO, 'client/components/scenes-editor-layer-route.js')

/** Minimal SceneState stand-in with the two methods addRouteLayerToLook uses. */
function makeSceneState(scene, { nextNumber = 11 } = {}) {
	const saves = []
	return {
		saves,
		getScene: (id) => (id === scene.id ? scene : null),
		addLayer(id) {
			if (id !== scene.id) return -1
			scene.layers.push({ layerNumber: nextNumber++, source: null })
			saves.push('addLayer')
			return scene.layers.length - 1
		},
		setLayerSource(id, idx, source) {
			if (id !== scene.id) return
			const L = scene.layers[idx]
			if (!L) return
			L.source = source
			saves.push('setLayerSource')
		},
	}
}

function makeScene() {
	return {
		id: 'look-1',
		name: 'Wide + PIPs',
		mainScope: 'all',
		layers: [{ layerNumber: 10, source: { type: 'media', value: 'AMB' } }],
	}
}

const CHANNEL_MAP = {
	screenCount: 1,
	programChannels: [3],
	previewChannels: [4],
	programResolutions: [{ w: 1920, h: 1080, fps: 50 }],
	previewResolutions: [{ w: 1920, h: 1080, fps: 50 }],
}

// ---------------------------------------------------------------------------
// 1 + 2: descriptor, and the look-local add.
// ---------------------------------------------------------------------------

test('layer route: descriptor resolves the PGM channel and emits route://ch-layer', async () => {
	const { createBuildLayerRouteDescriptor } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	const scene = makeScene()
	const sceneState = makeSceneState(scene)
	sceneState.activeScreenIndex = 0
	const build = createBuildLayerRouteDescriptor({ sceneState, getChannelMap: () => CHANNEL_MAP })

	const built = build(scene, 10, { forceBus: 'pgm' })
	assert.ok(!('error' in built), `expected a descriptor, got ${JSON.stringify(built)}`)
	assert.equal(built.item.value, 'route://3-10')
	assert.equal(built.item.type, 'route')
	assert.equal(built.item.routeType, 'layer')
	assert.equal(built.item.sourceLayerNumber, 10)
	assert.equal(built.item.thumbnailChannel, 3)
})

test('layer route: descriptor rejects a look with no resolvable channel', async () => {
	const { createBuildLayerRouteDescriptor } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	const scene = makeScene()
	const sceneState = makeSceneState(scene)
	const build = createBuildLayerRouteDescriptor({
		sceneState,
		getChannelMap: () => ({ screenCount: 1, programChannels: [], previewChannels: [] }),
	})
	const built = build(scene, 10, { forceBus: 'pgm' })
	assert.ok('error' in built && built.error, 'expected an error for an unmapped screen')
})

test('layer route: addRouteLayerToLook appends ONE layer to that look carrying the route', async () => {
	const { createBuildLayerRouteDescriptor, addRouteLayerToLook } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	const scene = makeScene()
	const sceneState = makeSceneState(scene)
	sceneState.activeScreenIndex = 0
	const build = createBuildLayerRouteDescriptor({ sceneState, getChannelMap: () => CHANNEL_MAP })
	const built = build(scene, 10, { forceBus: 'pgm' })

	const before = scene.layers.length
	const res = addRouteLayerToLook({ sceneState, scene, item: built.item })

	assert.equal(res.ok, true)
	assert.equal(scene.layers.length, before + 1, 'exactly one new layer in this look')
	const added = scene.layers[res.layerIndex]
	assert.equal(added.source.value, 'route://3-10')
	assert.equal(added.source.type, 'route')
	assert.equal(added.source.routeType, 'layer')
	assert.notEqual(added.layerNumber, 10, 'the route layer must not reuse its source layer number')
	// the original source layer is untouched
	assert.equal(scene.layers[0].source.value, 'AMB')
})

test('layer route: addRouteLayerToLook refuses a full look and an empty descriptor', async () => {
	const { addRouteLayerToLook } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	const scene = makeScene()
	const full = { ...makeSceneState(scene), addLayer: () => -1 }
	assert.equal(addRouteLayerToLook({ sceneState: full, scene, item: { value: 'route://3-10' } }).ok, false)
	assert.equal(addRouteLayerToLook({ sceneState: makeSceneState(scene), scene, item: {} }).ok, false)
	assert.equal(
		addRouteLayerToLook({ sceneState: makeSceneState(scene), scene: null, item: { value: 'route://3-10' } }).ok,
		false,
	)
})

// ---------------------------------------------------------------------------
// 3: nothing reaches the live-sources browser any more.
// ---------------------------------------------------------------------------

test('layer route: the ↗ path registers no live source (no addExtraLiveSource, no api client)', () => {
	const row = fs.readFileSync(ROW_FILE, 'utf8')
	const routeMod = fs.readFileSync(ROUTE_FILE, 'utf8')

	const code = row.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
	assert.ok(
		!/addExtraLiveSource/.test(code),
		'scene-layer-row.js must not POST addExtraLiveSource — that is the Sources-browser registration',
	)
	assert.ok(
		!/extraLiveSources/.test(code),
		'scene-layer-row.js must not touch extraLiveSources at all',
	)
	assert.ok(
		!/from '\.\.\/lib\/api-client\.js'/.test(row),
		'the layer row no longer needs the api client for the route button',
	)
	assert.ok(
		!/markCasparRestartDirty/.test(code),
		'a look-local route layer implies no Caspar restart',
	)
	assert.ok(
		/addRouteLayerToLook/.test(row),
		'the row must go through addRouteLayerToLook',
	)
	assert.ok(
		!/addExtraLiveSource|extraLiveSources/.test(
			routeMod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
		),
		'the route descriptor module must not register anything globally either',
	)
})

// ---------------------------------------------------------------------------
// 4: the route made this way still lands on the same frame as its source (WO-259).
// ---------------------------------------------------------------------------

test('layer route: an intra-look route layer passes the self-route guard on its own channel', async () => {
	const { createBuildLayerRouteDescriptor, addRouteLayerToLook } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	const scene = makeScene()
	const sceneState = makeSceneState(scene)
	sceneState.activeScreenIndex = 0
	const build = createBuildLayerRouteDescriptor({ sceneState, getChannelMap: () => CHANNEL_MAP })
	addRouteLayerToLook({ sceneState, scene, item: build(scene, 10, { forceBus: 'pgm' }).item })

	// Taking this look to channel 3 means a route://3-10 layer sitting on channel 3 — allowed
	// precisely because layer 10 belongs to this look (see findSelfRouteViolation).
	assert.equal(findSceneSelfRouteViolation(scene, 3), null)
	assert.doesNotThrow(() => assertSceneHasNoSelfRoutes(scene, 3))
})

test('layer route: the new layer is bank-remapped to the physical source layer at take time', async () => {
	const { createBuildLayerRouteDescriptor, addRouteLayerToLook } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	const { physicalProgramLayer } = require('../../src/engine/scene-transition')
	const scene = makeScene()
	const sceneState = makeSceneState(scene)
	sceneState.activeScreenIndex = 0
	const build = createBuildLayerRouteDescriptor({ sceneState, getChannelMap: () => CHANNEL_MAP })
	addRouteLayerToLook({ sceneState, scene, item: build(scene, 10, { forceBus: 'pgm' }).item })

	for (const bank of ['a', 'b']) {
		const remapped = remapIntraLookRoutesForTakeChannel(scene, 3, bank)
		const routeLayer = remapped.layers.find((l) => String(l.source?.value || '').startsWith('route://'))
		assert.equal(
			routeLayer.source.value,
			`route://3-${physicalProgramLayer(10, bank)}`,
			`bank ${bank}: route must point at the physical layer of its own source`,
		)
	}
})

test('layer route: WO-259 batching still folds the route in after its source (same frame)', async () => {
	const { createBuildLayerRouteDescriptor, addRouteLayerToLook } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	const { physicalProgramLayer } = require('../../src/engine/scene-transition')
	const scene = makeScene()
	const sceneState = makeSceneState(scene)
	sceneState.activeScreenIndex = 0
	const build = createBuildLayerRouteDescriptor({ sceneState, getChannelMap: () => CHANNEL_MAP })
	addRouteLayerToLook({ sceneState, scene, item: build(scene, 10, { forceBus: 'pgm' }).item })

	const remapped = remapIntraLookRoutesForTakeChannel(scene, 3, 'a')
	const takeJobs = remapped.layers.map((l) => ({
		pLayer: physicalProgramLayer(l.layerNumber, 'a'),
		clip: l.source.value,
	}))

	const { sources, routes } = partitionTakeJobsPlayOrder(takeJobs, 3)
	assert.equal(sources.length, 1, 'the media layer is a source job')
	assert.equal(routes.length, 1, 'the look-local route layer is a same-channel route job')
	assert.equal(routes[0].clip, `route://3-${physicalProgramLayer(10, 'a')}`)

	// dependency ordering must place the route after its source is on air
	const ordered = orderRouteJobsByDependency(routes, takeJobs)
	assert.equal(ordered.length, 1, 'the route resolves its dependency (source layer is on air)')
	assert.equal(ordered[0].clip, routes[0].clip)
})
