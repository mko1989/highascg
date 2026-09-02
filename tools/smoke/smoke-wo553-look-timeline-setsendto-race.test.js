'use strict'

/**
 * WO-553 — a timeline layer inside a look flashed full opacity before disappearing then fading in.
 *
 * Owner 02.09, after WO-546/548/549/550/552: *"now you need to look at opacity of layers between
 * looks and timeline looks. when playing a timeline look some of its layers appear at full opacity
 * for a split seccond, before disapearing and then fading in. ... this needs to follow the same
 * principals as standard looks."*
 *
 * `startSceneTimelineLayer` (timeline-take.js) is invoked TWICE per take, concurrently, for the same
 * timeline (WO-150 B150.1 / WO-546): once by the staging call (preview bus, `restrictToPreview:
 * true` — routes `program: false`) and once by the real PGM take (`restrictToPreview: false` —
 * routes `program: true`). By the time the PGM-take call runs, the staging call has already made
 * this timeline `_airTimelineId` with `sendTo.program === false`.
 *
 * The PGM-take call's very first line is `eng.setSendTo({ program: true, ... }, tlId)`. Because the
 * timeline is already air with a DIFFERENT `sendTo`, `TimelineEngine.setSendTo` sees
 * `routingChanged` and — unless told `skipAmcpApply` — fires its OWN full `_applyAt(force: true)`.
 * That apply carries no `takeFade`, so it is not the caller's protected preset-then-fade sequence;
 * it is the engine's raw per-clip write, straight to program, at the clip's actual base opacity (1)
 * — BEFORE the preset-to-0 write and the real `takeFade`-protected `play()` that follow it in
 * `startSceneTimelineLayer`. That is the flash. The disappear is the preset-to-0 landing right after
 * it; the fade-in is the caller's own crossfade. `runTimelineDirectTake` hit this exact class of bug
 * for its own `setSendTo` call and was already fixed with `{ skipAmcpApply: true }` (timeline-take.js
 * line ~158) — `startSceneTimelineLayer` never got the same guard.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { startSceneTimelineLayer } = require('../../src/engine/timeline-take.js')

function makeEngine() {
	const opacityCalls = []
	const self = {
		config: { screen_count: 1 },
		log: () => {},
		amcp: {
			raw: async () => {},
			stop: async () => {},
			pause: async () => {},
			resume: async () => {},
			call: async () => {},
			mixerFill: async () => {},
			mixerOpacity: async (ch, layer, val, dur) => {
				opacityCalls.push({ ch, layer, val, dur })
			},
			mixerVolume: async () => {},
			mixerCommit: async () => {},
			batchSendChunked: async () => {},
		},
	}
	const eng = new TimelineEngine(self)
	self.timelineEngine = eng
	eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'L1', clips: [{ id: 'c1', startTime: 0, duration: 60000, opacity: 1, source: { value: 'a.mov' } }] }],
	})
	return { self, eng, opacityCalls }
}

test('WO-553: PGM take after a concurrent staging call does not flash the program channel to full opacity', async () => {
	const { self, eng, opacityCalls } = makeEngine()

	// Staging call: puts the timeline on air, preview-only (as routes-scene-take.js's staging call does).
	await startSceneTimelineLayer(self, self.amcp, 2, { source: { value: 'tl1' } }, {
		fadeDur: 0,
		screenIdx: 0,
		startAtCurrentPosition: false,
		restrictToPreview: true,
	})
	assert.deepEqual(eng._sendToFor('tl1'), { preview: true, program: false, screenIdx: 0 })

	opacityCalls.length = 0 // only care what the PGM-take call itself does

	// Real PGM take: same timeline, still air, now claiming program too — the exact race.
	const fadeIn = await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
		fadeDur: 25,
		screenIdx: 0,
		startAtCurrentPosition: false,
		restrictToPreview: false,
	})

	const flashes = opacityCalls.filter((c) => c.ch === 1 && c.val === 1)
	assert.deepEqual(
		flashes, [],
		`no unprotected instant OPACITY 1 write may hit the program channel; got ${JSON.stringify(opacityCalls)}`,
	)
	assert.ok(fadeIn.length > 0, 'the caller still gets physical layers to fade in')
	eng.stop('tl1', { skipAmcp: true })
})

test('WO-553: startSceneTimelineLayer calls setSendTo with skipAmcpApply: true', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/engine/timeline-take.js'), 'utf8')
	const start = src.indexOf('async function startSceneTimelineLayer')
	assert.ok(start > 0, 'found startSceneTimelineLayer')
	const callStart = src.indexOf('eng.setSendTo(', start)
	assert.ok(callStart > start, 'found the setSendTo call')
	const callEnd = src.indexOf(')\n', callStart)
	const call = src.slice(callStart, callEnd)
	assert.match(call, /tlId/, 'sanity: this is startSceneTimelineLayer’s own setSendTo call')
	assert.match(
		call, /skipAmcpApply:\s*true/,
		'setSendTo must pass skipAmcpApply: true — its own apply races the preset+takeFade play() below',
	)
})
