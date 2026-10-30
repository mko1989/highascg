'use strict'

/**
 * WO-840 — timer visibility is per SCREEN, so it lives in look PRESET items, not in looks (owner 30.10, RULES.md
 * "Timers"). Mocked end to end, no live state:
 *  - web preset save captures each item's screen map; the server recall hands it to that item's program take;
 *  - the take engine's finalize hook emits the visibility MIXER lines on the right channel for a preset map,
 *    and a plain look take (even a legacy look carrying `timersVisibility`) emits none;
 *  - web look save no longer stamps the look (source pins on the call paths that cannot run without a browser).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { createScreenTimersHarness } = require('./lib/screen-timers-test-harness')

const ROOT = path.join(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')
const json = (r) => JSON.parse(r.body)

const { reset } = createScreenTimersHarness()

/** Two screens: timer "clock" on both (ch 1 / ch 3), "count" only on screen 1. */
function seedTimers() {
	const st = reset()
	st.assignTimerToScreen({ timerId: 'clock', name: 'Clock', config: {}, screenIdx: 0, channel: 1 })
	st.assignTimerToScreen({ timerId: 'clock', name: 'Clock', config: {}, screenIdx: 1, channel: 3 })
	st.assignTimerToScreen({ timerId: 'count', name: 'Count', config: {}, screenIdx: 1, channel: 3 })
	return st
}

describe('WO-840 server: preset recall threads each item\'s timer map into its program take', () => {
	const { handleLookPresetRecall, recallItems } = require('../../src/api/routes-scene-look-preset')
	const preset = {
		id: 'p1',
		items: [
			{ mainIdx: 0, sceneId: 'a', timersVisibility: { clock: false } },
			{ mainIdx: 1, sceneId: 'b', timersVisibility: { clock: true, count: false, junk: 'x' } },
			{ mainIdx: 2, sceneId: 'a' },
		],
	}
	const rig = () => {
		const calls = []
		return {
			calls,
			deps: {
				project: () => ({ scenes: { lookPresets: [preset] } }),
				resolveSceneById: (id) => ({ id }),
				fps: 50,
				takeLook: async (b) => (calls.push(b), { status: 200, body: '{}' }),
			},
		}
	}

	it('recallItems keeps only boolean entries, and an item without a map stays without one', () => {
		const items = recallItems(preset, () => true)
		assert.deepEqual(items[0].timersVisibility, { clock: false })
		assert.deepEqual(items[1].timersVisibility, { clock: true, count: false }, 'non-boolean junk dropped')
		assert.equal('timersVisibility' in items[2], false)
	})

	it('PGM recall: each screen\'s take carries ITS map; the item without one carries none', async () => {
		const r = rig()
		const res = await handleLookPresetRecall({ id: 'p1', target: 'program' }, {}, r.deps)
		assert.deepEqual(r.calls.map((c) => [c.mainIdx, c.timersVisibility]), [
			[0, { clock: false }],
			[1, { clock: true, count: false }],
			[2, undefined],
		])
		assert.equal(json(res).items.some((i) => 'timersVisibility' in i), false, 'not echoed in the response')
	})

	it('PRV recall never touches timers (they are on the program channel)', async () => {
		const r = rig()
		await handleLookPresetRecall({ id: 'p1', target: 'preview' }, {}, r.deps)
		assert.deepEqual(r.calls.map((c) => 'timersVisibility' in c), [false, false, false])
	})
})

describe('WO-840 server: take-look passes the map to the program take only when given', () => {
	const { handleTakeLook } = require('../../src/api/routes-scene-take-look')
	const scene = { id: 'a', name: 'A', layers: [{ layerNumber: 10, source: { type: 'media', value: 'x' } }] }
	const run = async (extra) => {
		let sent = null
		await handleTakeLook(
			{ sceneId: 'a', mainIdx: 0, ...extra },
			{},
			{
				resolveSceneById: () => scene,
				getChannelMap: () => ({ programChannels: [1], previewChannels: [2], programResolutions: [{ w: 1920, h: 1080, fps: 50 }] }),
				withBorder: (s) => s,
				take: async (b) => ((sent = b), { status: 200, body: '{}' }),
			},
		)
		return sent
	}

	it('program take with a map: forwarded (sanitised)', async () => {
		const b = await run({ target: 'program', timersVisibility: { clock: true, bad: 1 } })
		assert.deepEqual(b.timersVisibility, { clock: true })
	})
	it('plain look take, or a legacy look-level field: no map reaches the engine', async () => {
		assert.equal('timersVisibility' in (await run({ target: 'program' })), false)
		assert.equal('timersVisibility' in (await run({ target: 'preview', timersVisibility: { clock: true } })), false)
		const legacy = { ...scene, timersVisibility: { clock: false } }
		let sent = null
		await handleTakeLook({ sceneId: 'a', mainIdx: 0 }, {}, {
			resolveSceneById: () => legacy,
			getChannelMap: () => ({ programChannels: [1], previewChannels: [2], programResolutions: [{ fps: 50 }] }),
			withBorder: (s) => s,
			take: async (b) => ((sent = b), { status: 200, body: '{}' }),
		})
		assert.equal('timersVisibility' in sent, false, 'top-level: nothing from the look')
	})
})

describe('WO-840 engine: finalize emits the visibility lines for a preset map only', () => {
	const { finalizeTakeBankState } = require('../../src/engine/scene-take-lbg-bank-finalize')
	const run = async (extra, incoming = {}) => {
		const sent = []
		const amcp = { batchSend: async () => {}, batchSendChunked: async (lines) => sent.push(...lines) }
		const self = { programLayerBankByChannel: {}, log() {} }
		await finalizeTakeBankState(amcp, {
			self,
			channel: 3,
			chKey: '3',
			incoming,
			takeJobs: [],
			mergeMixerExtras: [],
			isMergeTransition: false,
			banklessTake: true,
			skippedVisuallyEqualLayers: [],
			phys: (l) => l,
			inactiveBank: 'b',
			...extra,
		})
		return sent
	}

	it('a preset map: MIXER OPACITY on THAT screen\'s channel, only for the timers it names', async () => {
		seedTimers()
		const lines = await run({ timersVisibility: { clock: false, count: true } })
		assert.deepEqual(lines.sort(), ['MIXER 3-980 OPACITY 0', 'MIXER 3-981 OPACITY 1'].sort())
		const ch1 = await run({ channel: 1, timersVisibility: { clock: false } })
		assert.deepEqual(ch1, ['MIXER 1-980 OPACITY 0'], 'screen 1 only touches its own channel')
	})

	it('a plain look take emits nothing, even for a legacy look that still carries timersVisibility', async () => {
		seedTimers()
		assert.deepEqual(await run({}), [])
		assert.deepEqual(await run({}, { id: 'a', timersVisibility: { clock: false, count: false } }), [])
	})

	it('both program take paths hand the preset map to the engine (source pins)', () => {
		const take = read('src', 'api', 'routes-scene-take.js')
		assert.match(take, /sanitizeVisibilityMap\(b\.timersVisibility\)/)
		const pgmCalls = take.split('runSceneTakeLbg(ctx.amcp,').slice(1).filter((s) => !/restrictTimelineToPreview/.test(s.slice(0, 900)))
		assert.equal(pgmCalls.length, 2, 'PGM-exchange take + direct program take')
		for (const c of pgmCalls) assert.match(c.slice(0, 1200), /\.\.\.programTimers/)
		assert.match(read('src', 'engine', 'scene-take-lbg.js'), /timersVisibility: opts\?\.timersVisibility/)
		const fin = read('src', 'engine', 'scene-take-lbg-bank-finalize.js')
		assert.doesNotMatch(fin, /incoming\??\.timersVisibility|incomingSceneOpt/, 'no look-level read any more')
	})
})

describe('WO-840 web: preset save captures per-screen maps; look save no longer writes timersVisibility', () => {
	const imp = (...p) => import(pathToFileURL(path.join(ROOT, 'client', ...p)).href)

	it('save + overwrite stamp each item with its own screen\'s map (empty destinations and timer-less screens: none)', async () => {
		const { sceneStateSaveLookPreset, sceneStateOverwriteLookPreset } = await imp('lib', 'scene-state-preset-actions.js')
		let flip = false
		const self = {
			lookPresets: [],
			armedScreenIndices: [0, 1, 2],
			activeScreenIndex: 0,
			previewSceneIdByMain: { 0: 'A', 1: 'B', 2: 'C' },
			liveSceneIdByMain: {},
			editingSceneId: null,
			getScene: (id) => ({ id }),
			_save() {},
			_timersSnapshotFn: (mainIdx) => (mainIdx === 0 ? { clock: !flip } : mainIdx === 1 ? { clock: false, count: true } : null),
		}
		const id = sceneStateSaveLookPreset(self, 'Show', 'prv')
		const p = self.lookPresets.find((x) => x.id === id)
		assert.deepEqual(p.items.map((i) => i.timersVisibility), [{ clock: true }, { clock: false, count: true }, undefined])
		flip = true
		assert.equal(sceneStateOverwriteLookPreset(self, id), true)
		assert.deepEqual(p.items[0].timersVisibility, { clock: false }, 'overwrite re-captures the current state')
	})

	it('a server import of look presets keeps the item map', async () => {
		const lookLogic = await imp('lib', 'scene-state-look-logic.js')
		const next = lookLogic.importLookPresetsFromServer([
			{ id: 'p', name: 'P', sceneId: 'A', items: [{ mainIdx: 1, sceneId: 'A', timersVisibility: { clock: true } }] },
		])
		assert.deepEqual(next[0].items[0].timersVisibility, { clock: true })
	})

	it('look save (scene-state _save) does not stamp the look any more; the web recall forwards the item map (source pins)', () => {
		assert.doesNotMatch(read('client', 'lib', 'scene-state.js'), /scene\.timersVisibility/)
		const logic = read('client', 'components', 'scenes-editor-logic.js')
		assert.match(logic, /timersVisibility: it\.timersVisibility/)
		const support = read('client', 'components', 'scenes-editor-support.js')
		assert.match(support, /entry\.timersVisibility/)
		assert.match(read('client', 'app.js'), /setTimersSnapshotFn\(\(mainIdx\) => getScreenTimersSnapshot\(mainIdx\)\)/)
	})
})
