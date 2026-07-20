'use strict'

/**
 * todos19.07.26 (owner): "also creating a route should apply same position and size from source."
 *
 * Before: `addRouteLayerToLook()` only set `source`, so the new layer kept `defaultLayerConfig()`'s
 * full-canvas fill — and the ↗ handler then called `applyNativeFillForSource()`, which for a
 * `route://` source resolves the content resolution to the WHOLE source channel
 * (client/lib/mixer-fill.js `getContentResolution`) and so always produced a full-canvas rect.
 * The route never landed where its source was.
 *
 * After: the new layer inherits the source layer's fill rect, rotation and aspect lock, and the
 * caller skips its native-fill fallback when that happened.
 */

const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const REPO = path.resolve(__dirname, '../..')
const ROW_FILE = path.join(REPO, 'client/components/scene-layer-row.js')

/** SceneState stand-in with the three methods addRouteLayerToLook uses. */
function makeSceneState(scene, { nextNumber = 11 } = {}) {
	return {
		activeScreenIndex: 0,
		getScene: (id) => (id === scene.id ? scene : null),
		addLayer(id) {
			if (id !== scene.id) return -1
			scene.layers.push({
				layerNumber: nextNumber++,
				source: null,
				fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
				rotation: 0,
				aspectLocked: true,
				opacity: 1,
				effects: [],
			})
			return scene.layers.length - 1
		},
		setLayerSource(id, idx, source) {
			const L = id === scene.id ? scene.layers[idx] : null
			if (L) L.source = source
		},
		patchLayer(id, idx, patch) {
			const L = id === scene.id ? scene.layers[idx] : null
			if (!L) return
			for (const [k, v] of Object.entries(patch)) {
				if (k === 'fill') L.fill = { ...L.fill, ...v }
				else L[k] = v
			}
		},
	}
}

const CHANNEL_MAP = {
	screenCount: 1,
	programChannels: [3],
	previewChannels: [4],
	programResolutions: [{ w: 1920, h: 1080, fps: 50 }],
	previewResolutions: [{ w: 1920, h: 1080, fps: 50 }],
}

/** A source layer parked bottom-right at quarter size, rotated, cropped, half-faded. */
function makeScene() {
	return {
		id: 'look-1',
		name: 'Wide + PIPs',
		mainScope: 'all',
		layers: [
			{
				layerNumber: 10,
				source: { type: 'media', value: 'AMB' },
				fill: { x: 0.5, y: 0.5, scaleX: 0.25, scaleY: 0.25 },
				rotation: 12,
				aspectLocked: false,
				opacity: 0.5,
				contentFit: 'fill-canvas',
				volume: 0.3,
				muted: true,
				loop: true,
				effects: [{ type: 'crop', params: { left: 0.1, right: 0.1, top: 0, bottom: 0 } }],
				pipOverlays: [{ type: 'border' }],
			},
		],
	}
}

async function addRoute(scene, sceneState) {
	const { createBuildLayerRouteDescriptor, addRouteLayerToLook } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	const build = createBuildLayerRouteDescriptor({ sceneState, getChannelMap: () => CHANNEL_MAP })
	const built = build(scene, 10, { forceBus: 'pgm' })
	assert.ok(!('error' in built), `expected a descriptor, got ${JSON.stringify(built)}`)
	return addRouteLayerToLook({ sceneState, scene, item: built.item })
}

// ---------------------------------------------------------------------------

test('route layer geometry: the new layer inherits the source rect, rotation and aspect lock', async () => {
	const scene = makeScene()
	const sceneState = makeSceneState(scene)
	const res = await addRoute(scene, sceneState)

	assert.equal(res.ok, true)
	assert.equal(res.copiedGeometry, true, 'the caller must be told geometry was copied')
	const added = scene.layers[res.layerIndex]
	assert.deepEqual(added.fill, { x: 0.5, y: 0.5, scaleX: 0.25, scaleY: 0.25 })
	assert.equal(added.rotation, 12)
	assert.equal(added.aspectLocked, false)
	// the source layer is untouched
	assert.deepEqual(scene.layers[0].fill, { x: 0.5, y: 0.5, scaleX: 0.25, scaleY: 0.25 })
	// and the route value/target are still right
	assert.equal(added.source.value, 'route://3-10')
	assert.equal(added.source.sourceLayerNumber, 10)
})

test('route layer geometry: mix/playback state and crop are deliberately NOT copied', async () => {
	const scene = makeScene()
	const sceneState = makeSceneState(scene)
	const res = await addRoute(scene, sceneState)
	const added = scene.layers[res.layerIndex]

	assert.equal(added.opacity, 1, 'opacity belongs to the source layer — the route fades on its own')
	assert.deepEqual(added.effects, [], 'crop is applied on the source layer; copying it would crop twice')
	assert.equal(added.contentFit, undefined, 'content-fit is ignored for route:// sources')
	assert.equal(added.loop, undefined)
	assert.equal(added.muted, undefined)
	assert.equal(added.pipOverlays, undefined)
})

test('route layer geometry: a source layer with no fill falls back (copiedGeometry false)', async () => {
	const { routeLayerGeometryFromSourceLayer } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	assert.equal(routeLayerGeometryFromSourceLayer(null), null)
	assert.equal(routeLayerGeometryFromSourceLayer({}), null)

	const scene = makeScene()
	delete scene.layers[0].fill
	const sceneState = makeSceneState(scene)
	const res = await addRoute(scene, sceneState)
	assert.equal(res.ok, true)
	assert.equal(res.copiedGeometry, false, 'no rect to copy — the native-fill fallback must still run')
})

test('route layer geometry: non-finite rect values are sanitised, defaults filled in', async () => {
	const { routeLayerGeometryFromSourceLayer } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	const g = routeLayerGeometryFromSourceLayer({
		fill: { x: NaN, y: 0.25, scaleX: Infinity, scaleY: 0.5 },
	})
	assert.deepEqual(g.fill, { x: 0, y: 0.25, scaleX: 1, scaleY: 0.5 })
	assert.equal(g.rotation, 0)
	assert.equal(g.aspectLocked, true)
})

test('route layer geometry: the ↗ handler skips native-fill when geometry was copied', () => {
	const row = fs.readFileSync(ROW_FILE, 'utf8')
	const code = row.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
	assert.ok(
		/if \(!added\.copiedGeometry\)/.test(code),
		'applyNativeFillForSource must be gated on copiedGeometry — it would overwrite the copied rect',
	)
})

test('route layer geometry: addRouteLayerToLook still works without patchLayer (no crash)', async () => {
	const { createBuildLayerRouteDescriptor, addRouteLayerToLook } = await import(
		'../../client/components/scenes-editor-layer-route.js'
	)
	const scene = makeScene()
	const sceneState = makeSceneState(scene)
	delete sceneState.patchLayer
	const build = createBuildLayerRouteDescriptor({ sceneState, getChannelMap: () => CHANNEL_MAP })
	const res = addRouteLayerToLook({ sceneState, scene, item: build(scene, 10, { forceBus: 'pgm' }).item })
	assert.equal(res.ok, true)
	assert.equal(res.copiedGeometry, false)
})
