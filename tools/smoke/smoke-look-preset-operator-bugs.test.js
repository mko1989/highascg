'use strict'

/**
 * WO-150 client-side operator bugs (B150.2–B150.5).
 *
 * - B150.2 — getResolutionForScreen must not trust the server's pre-INFO-CONFIG
 *   1920×1080 placeholder in channelMap.programResolutions; screen destinations
 *   (settings) carry the real resolution before Caspar INFO arrives.
 * - B150.3 — PRV arming on PGM-only mains is pure client state (setPreviewSceneId);
 *   "save preset from PRV" must read the armed look.
 * - B150.4 — look presets: overwrite/remove + persistence round-trip keeps `items`
 *   (multi-main) and `tandem` (they used to be dropped on reload).
 * - B150.5 — preset recall to PGM targets each item's own main and can override the
 *   take transition with the deck's default/global transition (existing take API).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const load = (p) => import(p)

describe('B150.2 getResolutionForScreen ordering', () => {
	const canvasFallback = { getCanvasForScreen: () => ({ width: 1920, height: 1080, framerate: 50 }) }
	const dest3072 = {
		id: 'd1',
		mode: 'pgm_prv',
		mainScreenIndex: 0,
		width: 3072,
		height: 1728,
		videoMode: 'custom',
	}

	it('prefers screen destination over pre-INFO 1080p placeholder', async () => {
		const { getResolutionForScreen } = await load('../../client/components/scenes-editor-logic.js')
		const stateStore = {
			getState: () => ({
				channelMap: {
					programChannels: [1],
					// Placeholder built by channel-map-from-ctx pickRes() before INFO CONFIG:
					programResolutions: [{ w: 1920, h: 1080, fps: 50 }],
					// No channelResolutionsByChannel — INFO CONFIG not gathered yet.
				},
				screenDestinations: { destinations: [dest3072] },
			}),
		}
		assert.deepEqual(getResolutionForScreen(0, canvasFallback, stateStore), { w: 3072, h: 1728 })
	})

	it('trusts programResolutions once INFO-backed (channelResolutionsByChannel)', async () => {
		const { getResolutionForScreen } = await load('../../client/components/scenes-editor-logic.js')
		const stateStore = {
			getState: () => ({
				channelMap: {
					programChannels: [1],
					programResolutions: [{ w: 3072, h: 1728, fps: 50 }],
					channelResolutionsByChannel: { 1: { w: 3072, h: 1728, fps: 50 } },
				},
				screenDestinations: { destinations: [{ ...dest3072, width: 1280, height: 720 }] },
			}),
		}
		// Live INFO wins over (possibly stale) destination config.
		assert.deepEqual(getResolutionForScreen(0, canvasFallback, stateStore), { w: 3072, h: 1728 })
	})

	it('falls back to 1920×1080 when nothing is known', async () => {
		const { getResolutionForScreen } = await load('../../client/components/scenes-editor-logic.js')
		const stateStore = { getState: () => ({}) }
		const noCanvas = { getCanvasForScreen: () => null }
		assert.deepEqual(getResolutionForScreen(0, noCanvas, stateStore), { w: 1920, h: 1080 })
	})

	it('maps standard videoMode destinations without explicit width/height', async () => {
		const { getResolutionForScreen } = await load('../../client/components/scenes-editor-logic.js')
		const stateStore = {
			getState: () => ({
				channelMap: { programChannels: [1], programResolutions: [{ w: 1920, h: 1080 }] },
				screenDestinations: {
					destinations: [{ id: 'd', mode: 'pgm_prv', mainScreenIndex: 0, width: 0, height: 0, videoMode: '720p5000' }],
				},
			}),
		}
		const noCanvas = { getCanvasForScreen: () => null }
		assert.deepEqual(getResolutionForScreen(0, noCanvas, stateStore), { w: 1280, h: 720 })
	})
})

describe('B150.3 / B150.4 look preset state (PGM-only arm, overwrite, remove, persistence)', () => {
	async function freshState() {
		const { SceneState } = await load('../../client/lib/scene-state.js')
		const st = new SceneState()
		st.scenes = []
		st.lookPresets = []
		st.liveSceneIdByMain = [null, null, null, null]
		st.previewSceneIdByMain = [null, null, null, null]
		return st
	}

	it('arming PRV is pure client state and feeds saveLookPreset(prv) on a PGM-only main', async () => {
		const st = await freshState()
		const idA = st.addScene('Look A', { mainScope: '0' })
		const idB = st.addScene('Look B', { mainScope: '1' })
		// PGM-only arm — exactly what the deck card does now (no AMCP involved):
		st.setPreviewSceneId(idA, 0)
		st.setPreviewSceneId(idB, 1)
		st.armedScreenIndices = [0, 1]
		const pid = st.saveLookPreset('Both screens', 'prv')
		assert.ok(pid, 'preset saved from armed PRV state')
		const p = st.getLookPresets().find((x) => x.id === pid)
		assert.equal(p.items.length, 2)
		assert.deepEqual(
			p.items.map((it) => [it.mainIdx, it.sceneId]),
			[[0, idA], [1, idB]],
		)
	})

	it('overwriteLookPreset replaces items from the currently armed PRV looks', async () => {
		const st = await freshState()
		const idA = st.addScene('Look A', { mainScope: '0' })
		const idC = st.addScene('Look C', { mainScope: '0' })
		st.setPreviewSceneId(idA, 0)
		st.armedScreenIndices = [0]
		const pid = st.saveLookPreset('P', 'prv')
		st.setPreviewSceneId(idC, 0)
		assert.equal(st.overwriteLookPreset(pid), true)
		const p = st.getLookPresets().find((x) => x.id === pid)
		assert.equal(p.items[0].sceneId, idC)
		assert.equal(p.sceneId, idC, 'legacy fallback updated too')
	})

	it('removeLookPreset deletes the preset', async () => {
		const st = await freshState()
		const idA = st.addScene('Look A', { mainScope: '0' })
		st.setPreviewSceneId(idA, 0)
		st.armedScreenIndices = [0]
		const pid = st.saveLookPreset('Doomed', 'prv')
		assert.equal(st.removeLookPreset(pid), true)
		assert.equal(st.getLookPresets().length, 0)
		assert.equal(st.removeLookPreset(pid), false, 'second remove is a no-op')
	})

	it('persistence round-trip keeps items and tandem (used to be dropped on reload)', async () => {
		const st = await freshState()
		const P = await load('../../client/lib/scene-state-persistence-logic.js')
		const { SceneState } = await load('../../client/lib/scene-state.js')
		const idA = st.addScene('Look A', { mainScope: '0' })
		const idB = st.addScene('Look B', { mainScope: '1' })
		st.setPreviewSceneId(idA, 0)
		st.setPreviewSceneId(idB, 1)
		st.armedScreenIndices = [0, 1]
		const pid = st.saveLookPreset('Multi', 'prv')
		st.patchLookPreset(pid, { tandem: { pairId: 'tp-1' } })

		const st2 = new SceneState()
		assert.equal(P.applyPersistedData(st2, JSON.parse(P.getPersistPayload(st))), true)
		const p2 = st2.lookPresets.find((x) => x.id === pid)
		assert.ok(p2, 'preset survives reload')
		assert.equal(p2.items?.length, 2, 'multi-main items survive reload')
		assert.deepEqual(
			p2.items.map((it) => [it.mainIdx, it.sceneId]),
			[[0, idA], [1, idB]],
		)
		assert.deepEqual(p2.tandem, { pairId: 'tp-1' }, 'tandem survives reload')
	})

	it('server import keeps items and tandem', async () => {
		const { importLookPresetsFromServer } = await load('../../client/lib/scene-state-look-logic.js')
		const list = [
			{
				id: 'p1',
				name: 'N',
				sceneId: 's1',
				sourceKind: 'prv',
				targetMain: 0,
				items: [{ mainIdx: 1, sceneId: 's2', sourceKind: 'prv' }],
				tandem: { pairId: 'tp-9' },
			},
		]
		const next = importLookPresetsFromServer(list)
		assert.equal(next[0].items[0].sceneId, 's2')
		assert.deepEqual(next[0].tandem, { pairId: 'tp-9' })
	})
})

describe('B150.5 preset recall to PGM (per-main targeting + global default transition)', () => {
	async function seedSingleton() {
		const { sceneState } = await load('../../client/lib/scene-state.js')
		sceneState.scenes = []
		sceneState.lookPresets = []
		sceneState.activeScreenIndex = 0
		sceneState.armedScreenIndices = [0]
		const idA = sceneState.addScene('Recall A', { mainScope: '0' })
		const idB = sceneState.addScene('Recall B', { mainScope: '1' })
		sceneState.globalDefaultTransition = { type: 'WIPE', duration: 30, tween: 'easeboth' }
		return { sceneState, idA, idB }
	}

	it('takes each item on its own main and passes the global transition when asked', async () => {
		const { runLookRecall } = await load('../../client/components/scenes-editor-logic.js')
		const { idA, idB } = await seedSingleton()
		const calls = []
		const preset = {
			name: 'Both',
			items: [
				{ mainIdx: 0, sceneId: idA },
				{ mainIdx: 1, sceneId: idB },
			],
		}
		await runLookRecall(null, preset, 'pgm', {
			takeSceneToProgram: async (id, forceCut, opts) => calls.push({ id, forceCut, opts }),
			sendSceneToPreviewCard: async () => {},
			forceCut: false,
			useGlobalTransition: true,
		})
		assert.equal(calls.length, 2)
		assert.deepEqual(calls[0].opts.targetMains, [0])
		assert.deepEqual(calls[1].opts.targetMains, [1])
		assert.equal(calls[0].id, idA)
		assert.equal(calls[1].id, idB)
		for (const c of calls) {
			assert.equal(c.forceCut, false)
			assert.equal(c.opts.transitionOverride.type, 'WIPE')
			assert.equal(c.opts.transitionOverride.duration, 30)
		}
	})

	it('keeps each look\'s own transition when useGlobalTransition is not set', async () => {
		const { runLookRecall } = await load('../../client/components/scenes-editor-logic.js')
		const { idA } = await seedSingleton()
		const calls = []
		await runLookRecall(idA, null, 'pgm', {
			takeSceneToProgram: async (id, forceCut, opts) => calls.push({ id, forceCut, opts }),
			sendSceneToPreviewCard: async () => {},
			forceCut: false,
		})
		assert.equal(calls.length, 1)
		assert.equal(calls[0].opts.transitionOverride, undefined)
	})

	it('cut recall never carries a transition override', async () => {
		const { runLookRecall } = await load('../../client/components/scenes-editor-logic.js')
		const { idA } = await seedSingleton()
		const calls = []
		await runLookRecall(idA, null, 'pgm', {
			takeSceneToProgram: async (id, forceCut, opts) => calls.push({ id, forceCut, opts }),
			sendSceneToPreviewCard: async () => {},
			forceCut: true,
			useGlobalTransition: true,
		})
		assert.equal(calls[0].forceCut, true)
		assert.equal(calls[0].opts.transitionOverride, undefined)
	})

	it('takeSceneToProgram sends the override on the take payload and restores the look transition', async () => {
		const { createTakeSceneToProgram } = await load('../../client/components/scenes-editor-support.js')
		const { sceneState, idA } = await seedSingleton()
		const scene = sceneState.getScene(idA)
		scene.defaultTransition = { type: 'MIX', duration: 12, tween: 'linear' }
		scene.layers = [
			{ layerNumber: 10, source: { type: 'media', value: 'clip.mp4' }, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } },
		]
		const cm = {
			screenCount: 1,
			programChannels: [1],
			previewChannels: [2],
			programResolutions: [{ w: 1920, h: 1080, fps: 50 }],
		}
		const posted = []
		const take = createTakeSceneToProgram({
			api: {
				post: async (path, body) => {
					posted.push({ path, body })
					return { sceneLive: { 1: { sceneId: idA, scene: body.incomingScene } } }
				},
			},
			stateStore: { getState: () => ({ scene: { live: {} }, channelMap: cm }), applyChange: () => {} },
			getChannelMap: () => cm,
			getProgramChannel: () => 1,
			showToast: () => {},
			primePreviewSnapshotFromScene: () => {},
		})
		await take(idA, false, {
			targetMains: [0],
			transitionOverride: { type: 'WIPE', duration: 30, tween: 'easeboth' },
		})
		assert.equal(posted.length, 1)
		assert.equal(posted[0].path, '/api/scene/take')
		assert.equal(posted[0].body.incomingScene.defaultTransition.type, 'WIPE')
		assert.equal(posted[0].body.incomingScene.defaultTransition.duration, 30)
		// One-shot override must not rewrite the look's own transition:
		assert.equal(sceneState.getScene(idA).defaultTransition.type, 'MIX')
		assert.equal(sceneState.getScene(idA).defaultTransition.duration, 12)
	})

	it('PGM-only take normalizes the override (plain WIPE → WIPE + ANIMATE)', async () => {
		const { createTakeSceneToProgram } = await load('../../client/components/scenes-editor-support.js')
		const { sceneState, idA } = await seedSingleton()
		const scene = sceneState.getScene(idA)
		scene.layers = [
			{ layerNumber: 10, source: { type: 'media', value: 'clip.mp4' }, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } },
		]
		// PGM-only: PRV channel missing.
		const cm = {
			screenCount: 1,
			programChannels: [1],
			previewChannels: [],
			programResolutions: [{ w: 1920, h: 1080, fps: 50 }],
		}
		const posted = []
		const take = createTakeSceneToProgram({
			api: { post: async (path, body) => { posted.push({ path, body }); return {} } },
			stateStore: { getState: () => ({ scene: { live: {} }, channelMap: cm }), applyChange: () => {} },
			getChannelMap: () => cm,
			getProgramChannel: () => 1,
			showToast: () => {},
			primePreviewSnapshotFromScene: () => {},
		})
		await take(idA, false, {
			targetMains: [0],
			transitionOverride: { type: 'WIPE', duration: 30, tween: 'easeboth' },
		})
		assert.equal(posted[0].body.incomingScene.defaultTransition.type, 'WIPE + ANIMATE')
	})
})
