'use strict'

/**
 * WO-155 T155.2 — MIXER-only vs re-PLAY decision matrix for preview pushes.
 *
 * `pushSceneToPreviewImpl` gates the full re-PLAY branch on `geometryOnly ||
 * contentUnchanged`, both derived from the snapshot helpers below. B155.1 was
 * a key asymmetry (`browserAsCg` present in the meta but missing from the
 * stored/compared snapshots) that pinned both gates to false, so every
 * parameter edit restarted the clip. These tests exercise the helpers plus
 * the exact `contentUnchanged` comparison used in scenes-preview-push-scene.js.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

async function loadSnapshotLib() {
	return import('../../client/lib/scenes-preview-snapshot.js')
}

function makeLayer(over = {}) {
	const { source, ...rest } = over
	return {
		layerNumber: 10,
		source: { type: 'media', value: 'AMB', ...(source || {}) },
		loop: false,
		straightAlpha: false,
		contentFit: 'native',
		audioRoute: '1+2',
		volume: 1,
		muted: false,
		rotation: 0,
		opacity: 1,
		...rest,
	}
}

/** Mirror of the `contentUnchanged` gate in scenes-preview-push-scene.js. */
function contentUnchanged(lib, prevMeta, layer) {
	const curMeta = lib.layerContentMetaForSnapshot(layer)
	const prevContent = prevMeta ? lib.previewContentCompareKey(prevMeta) : null
	return !!(prevContent && curMeta && JSON.stringify(prevContent) === JSON.stringify(lib.previewContentCompareKey(curMeta)))
}

describe('preview snapshot decision matrix (WO-155)', () => {
	it('snapshot and meta builders are key-symmetric (no drift)', async () => {
		const lib = await loadSnapshotLib()
		const layer = makeLayer()
		const snap = lib.buildPreviewContentSnapshot('scene-1', { layers: [layer] })
		const stored = snap.contentByLayer.get(10)
		const meta = lib.layerContentMetaForSnapshot(layer)
		assert.deepEqual(lib.previewContentCompareKey(stored), lib.previewContentCompareKey(meta))
		// Every compare key must exist in the stored snapshot entry.
		for (const k of Object.keys(lib.previewContentCompareKey(meta))) {
			assert.ok(k in stored, `stored snapshot is missing compare key "${k}"`)
		}
	})

	it('opacity-only change → geometryOnly + contentUnchanged (no PLAY path)', async () => {
		const lib = await loadSnapshotLib()
		const before = makeLayer()
		const after = makeLayer({ opacity: 0.4 })
		const snap = lib.buildPreviewContentSnapshot('scene-1', { layers: [before] })
		assert.equal(lib.isGeometryOnlyPreview(snap, { layers: [after] }), true)
		assert.equal(contentUnchanged(lib, snap.contentByLayer.get(10), after), true)
	})

	it('geometry drag (rotation) → geometryOnly + contentUnchanged (no PLAY path)', async () => {
		const lib = await loadSnapshotLib()
		const before = makeLayer()
		const after = makeLayer({ rotation: 45 })
		const snap = lib.buildPreviewContentSnapshot('scene-1', { layers: [before] })
		assert.equal(lib.isGeometryOnlyPreview(snap, { layers: [after] }), true)
		assert.equal(contentUnchanged(lib, snap.contentByLayer.get(10), after), true)
	})

	it('clip value change → content changed (PLAY path)', async () => {
		const lib = await loadSnapshotLib()
		const before = makeLayer()
		const after = makeLayer({ source: { value: 'OTHER_CLIP' } })
		const snap = lib.buildPreviewContentSnapshot('scene-1', { layers: [before] })
		assert.equal(lib.isGeometryOnlyPreview(snap, { layers: [after] }), false)
		assert.equal(contentUnchanged(lib, snap.contentByLayer.get(10), after), false)
	})

	it('loop flip → content changed (PLAY path)', async () => {
		const lib = await loadSnapshotLib()
		const before = makeLayer()
		const after = makeLayer({ loop: true })
		const snap = lib.buildPreviewContentSnapshot('scene-1', { layers: [before] })
		assert.equal(lib.isGeometryOnlyPreview(snap, { layers: [after] }), false)
		assert.equal(contentUnchanged(lib, snap.contentByLayer.get(10), after), false)
	})

	it('browserAsCg flip → content changed (PLAY path)', async () => {
		const lib = await loadSnapshotLib()
		const before = makeLayer({ source: { type: 'browser', value: 'https://x.test/', browserAsCg: false } })
		const after = makeLayer({ source: { type: 'browser', value: 'https://x.test/', browserAsCg: true } })
		const snap = lib.buildPreviewContentSnapshot('scene-1', { layers: [before] })
		assert.equal(lib.isGeometryOnlyPreview(snap, { layers: [after] }), false)
		assert.equal(contentUnchanged(lib, snap.contentByLayer.get(10), after), false)
	})

	it('old snapshot without browserAsCg key + unchanged layer → still contentUnchanged (no spurious restart)', async () => {
		const lib = await loadSnapshotLib()
		const layer = makeLayer()
		// Stored snapshot shape from before the browserAsCg fix: 8 content keys, no browserAsCg.
		const legacyEntry = {
			value: 'AMB',
			loop: false,
			straightAlpha: false,
			contentFit: 'native',
			audioRoute: '1+2',
			volume: 1,
			muted: false,
			pipOverlays: [],
			effects: [],
			fill: null,
			rotation: 0,
			opacity: 1,
			keyer: 0,
		}
		const legacySnap = { sceneId: 'scene-1', contentByLayer: new Map([[10, legacyEntry]]) }
		assert.equal(lib.isGeometryOnlyPreview(legacySnap, { layers: [layer] }), true)
		assert.equal(contentUnchanged(lib, legacyEntry, layer), true)
	})
})
