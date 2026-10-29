'use strict'

/**
 * WO-813 — owner 29.10: the look layer's clip trim: a slider that scrubs the clip on PRV (like the timeline seek does)
 * and Trim in / Trim out buttons. The slider's seek goes through the timeline's paced scrub gate (WO-790) on the look's
 * PRV copy only. Second pass (owner 29.10): the "Custom" start option is gone — trim works under both start options,
 * a stored legacy "custom" takes as "beginning" with its trim; the Trim row is collapsible and Ctrl+click / ↺ /
 * right-click reset a point.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { handleLayerScrub, seekFrameForMs } = require('../../src/api/routes-scene-layer-scrub')

const SCENE = {
	id: 'look1',
	mainScope: 0,
	layers: [{ layerNumber: 10, source: { type: 'media', value: 'INTRO.mov' } }],
}
const MAP = { programChannels: [1], previewChannels: [2], programResolutions: [{ w: 1920, h: 1080 }] }

function deps(over = {}) {
	const seeks = []
	const records = []
	return {
		seeks,
		records,
		d: {
			resolveScene: (id) => (id === 'look1' ? SCENE : null),
			getChannelMap: () => MAP,
			getStaged: (ch) =>
				ch === 2 ? { sceneId: 'look1', scene: { layers: [{ layerNumber: 10, source: { value: 'INTRO.mov' } }] } } : null,
			scrubSeek: (_eng, ch, layer, frame, fps) => seeks.push([ch, layer, frame, fps]),
			recordSeek: (_ctx, ch, layer, ms) => records.push([ch, layer, ms]),
			...over,
		},
	}
}
const body = (r) => JSON.parse(r.body)
const CTX = { variables: { channel_2_framerate: '50' } }

test('seek frame = ms × channel fps (SEEK counts channel frames)', () => {
	assert.equal(seekFrameForMs(10000, 50), 500)
	assert.equal(seekFrameForMs(1020, 25), 26)
	assert.equal(seekFrameForMs(-5, 50), 0)
})

test('a look on PRV: one paced seek on the PRV channel at the look layer, never PGM', async () => {
	const { d, seeks, records } = deps()
	const r = await handleLayerScrub({ sceneId: 'look1', mainIdx: 0, layerNumber: 10, ms: 12000 }, CTX, d)
	assert.equal(r.status, 200)
	assert.deepEqual(body(r), { ok: true, onPrv: true, channel: 2, layer: 10, frame: 600, chFps: 50 })
	assert.deepEqual(seeks, [[2, 10, 600, 50]])
	assert.deepEqual(records, [[2, 10, 12000]])
})

test('not on PRV, another clip staged, or no PRV bus → nothing is sent', async () => {
	for (const [over, reason] of [
		[{ getStaged: () => ({ sceneId: 'other', scene: { layers: [] } }) }, 'not_on_prv'],
		[
			{
				getStaged: () => ({ sceneId: 'look1', scene: { layers: [{ layerNumber: 10, source: { value: 'OTHER.mov' } }] } }),
			},
			'clip_not_staged',
		],
		[{ getChannelMap: () => ({ programChannels: [1], previewChannels: [1] }) }, 'pgm_only'],
	]) {
		const { d, seeks } = deps(over)
		const r = await handleLayerScrub({ sceneId: 'look1', mainIdx: 0, layerNumber: 10, ms: 1000 }, CTX, d)
		assert.deepEqual(body(r), { ok: true, onPrv: false, reason })
		assert.equal(seeks.length, 0, reason)
	}
	const bad = await handleLayerScrub({ sceneId: 'look1', layerNumber: 10 }, CTX, deps().d)
	assert.equal(bad.status, 400)
})

test("the real gate: the timeline engine's gate map, one CALL SEEK in flight", async () => {
	const wire = []
	const ctx = {
		variables: { channel_2_framerate: '50' },
		timelineEngine: {
			self: {
				amcp: { call: (ch, l, c, a) => (wire.push(`CALL ${ch}-${l} ${c} ${a}`), Promise.resolve()) },
				oscState: { _channels: {} },
			},
		},
	}
	const { d } = deps({ scrubSeek: undefined })
	delete d.scrubSeek
	for (const ms of [1000, 1100, 1200])
		await handleLayerScrub({ sceneId: 'look1', mainIdx: 0, layerNumber: 10, ms }, ctx, d)
	assert.deepEqual(wire, ['CALL 2-10 SEEK 50'], 'later targets wait for the first')
	assert.ok(ctx.timelineEngine._scrubGate.get('2-10').pending.caspFrame === 60, 'newest waits')
	require('../../src/engine/timeline-scrub-gate').cancelScrub(ctx.timelineEngine, 2, 10)
})

test('take: a legacy Custom layer takes as "beginning" — starts at its trim-in, like beginning does', () => {
	const {
		resolvePlaySeekFramesForSceneLayer,
		resolveEffectiveStartBehaviour,
	} = require('../../src/engine/scene-play-seek')
	assert.equal(resolveEffectiveStartBehaviour({ startBehaviour: 'custom' }, null), 'beginning')
	assert.equal(
		resolveEffectiveStartBehaviour({ startBehaviour: 'custom' }, { startBehaviour: 'relativeToPrevious' }),
		'beginning'
	)
	const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'engine', 'scene-play-seek.js'), 'utf8')
	assert.doesNotMatch(src, /sb === 'custom'/, 'the Custom-only take branch is gone')
	const timelineEngine = {
		getPlayback: () => ({ timelineId: 't', position: 0 }),
		timelines: new Map([
			['t', { layers: [{ clips: [{ startTime: 0, duration: 10000, inPoint: 7, source: { value: 'X' } }] }] }],
		]),
	}
	const opts = {
		channel: 2,
		layerNumber: 10,
		fps: 50,
		forceCut: true,
		phys: (n) => n,
		activeBank: 'a',
		incoming: { layers: [{ layerNumber: 10 }] },
	}
	const seek = (layer, ctx = {}) => resolvePlaySeekFramesForSceneLayer({ layerNumber: 10, ...layer }, ctx, opts)
	assert.equal(seek({ startBehaviour: 'custom', trimInMs: 2000 }), 100, '2000 ms @ 50 = 100')
	assert.equal(seek({ startBehaviour: 'custom' }), 0, 'no trim-in → frame 0')
	assert.equal(seek({ startBehaviour: 'beginning', trimInMs: 2000 }), 100, 'beginning: same')
	assert.equal(
		seek({ startBehaviour: 'custom', trimInMs: 2000 }, { timelineEngine }),
		seek({ startBehaviour: 'beginning', trimInMs: 2000 }, { timelineEngine }),
		'with a timeline clip on the layer index a legacy custom behaves exactly like beginning'
	)
})

test('take: trim gives IN, SEEK and LENGTH under both start options (and a legacy custom)', async () => {
	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')
	const run = async (extra) => {
		const incoming = {
			id: 't',
			layers: [
				{
					layerNumber: 10,
					source: { type: 'media', value: 'clip.mov' },
					trimInMs: 1000,
					trimOutMs: 4000,
					...extra,
				},
			],
		}
		const r = await buildTakeJobs({
			incomingSorted: incoming.layers,
			currentMap: new Map(),
			channel: 2,
			incoming,
			self: { config: { screen_count: 1 }, log: () => {} },
			amcp: {},
			phys: (n, bank) => n + (bank === 'b' ? 100 : 0),
			inactiveBank: 'b',
			activeBank: 'a',
			shouldRunBankCrossfade: false,
			forceCut: false,
			isMergeTransition: false,
			globalT: { type: 'CUT' },
			framerate: 25,
			skipLayerVisualEquality: false,
		})
		const o = r.takeJobs[0].loadOpts
		return [o.in, o.seek, o.length]
	}
	assert.deepEqual(await run({ startBehaviour: 'custom' }), [25, 25, 75], 'legacy custom = beginning')
	assert.deepEqual(await run({ startBehaviour: 'beginning' }), [25, 25, 75], 'beginning: SEEK at the in point')
	assert.deepEqual(
		await run({ startBehaviour: 'relativeToPrevious', playSeekFrames: 50 }),
		[25, 50, 75],
		'relative: SEEK follows the clip, IN / LENGTH keep the trim window'
	)
})

test('payload: a stored legacy custom goes out as beginning with its trim; the web twin is unchanged', async () => {
	const { buildServerIncomingScene } = require('../../src/engine/scene-take-payload')
	const layer = (sb) => ({
		layerNumber: 10,
		source: { type: 'media', value: 'x.mov' },
		startBehaviour: sb,
		trimInMs: 120,
		trimOutMs: 9360,
	})
	const p = await buildServerIncomingScene(
		{ id: 'a', layers: [layer('custom'), layer('beginning'), layer('relativeToPrevious'), { layerNumber: 12 }] },
		{ mainIdx: 0, channelMap: {} }
	)
	assert.deepEqual(
		p.layers.map((l) => [l.startBehaviour, l.trimInMs, l.trimOutMs]),
		[
			['beginning', 120, 9360],
			['beginning', 120, 9360],
			['relativeToPrevious', 120, 9360],
			[undefined, undefined, undefined],
		]
	)
	/* The web drop-down no longer offers Custom (smoke-wo813-web-clip-trim.test.js), but the web state keeps a stored
	 * legacy 'custom' as is (nothing is rewritten); the server reads it as beginning above. */
	const web = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'components', 'scenes-shared.js'), 'utf8')
	assert.match(web, /l\.startBehaviour === 'custom'\n\t+\? \{ startBehaviour: l\.startBehaviour \}/)
	const { patchLayer } = await import('../../client/lib/scene-state-layer-logic.js')
	const L = { fill: {} }
	patchLayer(L, { startBehaviour: 'custom' })
	assert.equal(L.startBehaviour, 'custom')
	const { migrateScene } = await import('../../client/lib/scene-state-helpers.js')
	assert.equal(
		migrateScene({ id: 'a', layers: [{ layerNumber: 10, startBehaviour: 'custom' }] }).layers[0].startBehaviour,
		'custom'
	)
})

test('Godot: two start options, a collapsible Trim row, Ctrl+click / ↺ / right-click reset, the slider still scrubs PRV', () => {
	const g = (rel) =>
		fs.readFileSync(path.join(__dirname, '..', '..', 'godot', 'client', 'features', 'live', rel), 'utf8')
	const model = g('clip_trim_model.gd')
	assert.match(
		model,
		/const STARTS := \[\["beginning", "Start from beginning"\], \["relativeToPrevious", "Relative to the clip playing on this layer"\]\]\n/
	)
	const ins = g('layer_inspector.gd')
	assert.match(ins, /const STARTS: Array = preload\("res:\/\/features\/live\/clip_trim_model\.gd"\)\.STARTS/)
	assert.doesNotMatch(ins + model, /Custom \(trim in/, 'no Custom option left')
	assert.match(ins, /_trim\.patch\.connect\(func\(p: Dictionary\) -> void: patch\.emit\(p\)\)/)
	assert.match(ins, /g\.add_child\(_trim\.header\)/)
	const sec = g('clip_trim_section.gd')
	assert.match(sec, /Api\.post_json\("\/api\/scene\/layer-scrub"/)
	assert.match(sec, /if _busy:\n\t\t_next = v/)
	assert.match(sec, /header\.text = \("▾ " if open else "▸ "\) \+ "Trim"/)
	assert.match(
		sec,
		/if key != _key:\n(\t\t.*\n)*?\t\tset_open\(false\)/,
		'folded whenever another layer / clip is shown'
	)
	/* Owner 29.10: Ctrl / Cmd+click and a ↺ per point reset too; right-click stays (is_reset_click covers all three). */
	assert.match(sec, /if T\.is_reset_click\(e\):\n\t\t\tb\.accept_event\(\)(.*)\n\t\t\t_reset\(is_in\)/)
	assert.match(sec, /b\.text = "↺"\n(\t.*\n)*?\tb\.pressed\.connect\(func\(\) -> void: _reset\(is_in\)\)/)
	assert.match(
		model,
		/if mb\.button_index == MOUSE_BUTTON_RIGHT:\n\t\treturn true\n\treturn mb\.button_index == MOUSE_BUTTON_LEFT and \(mb\.ctrl_pressed or mb\.meta_pressed\)/
	)
	assert.match(sec, /Ctrl\+click or ↺ to reset to the clip's start/)
	assert.match(sec, /Ctrl\+click or ↺ to reset to the clip's end/)
	assert.match(
		model,
		/static func reset_in\(layer: Dictionary, fps: float\) -> Dictionary:\n\tvar p := \{"trimInMs": null\}/
	)
	assert.match(
		model,
		/static func reset_out\(layer: Dictionary, dur_ms: float, fps: float\) -> Dictionary:\n\tvar p := \{"trimOutMs": null\}/
	)
})
