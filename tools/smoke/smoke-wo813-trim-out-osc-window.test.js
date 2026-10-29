'use strict'

/**
 * WO-813 trim-out (owner 29.10: "trimming has no effect on the actual playout"). Caspar 2.5.1 enforces LENGTH itself
 * (av_producer.cpp:925-945 wraps to IN with LOOP, holds the out frame without) — measured live: PGM 1-110 with
 * LENGTH 468 wraps 9.34 → 0.00. What did NOT follow the trim was the node's OSC timing: remaining / progress ran to the
 * FILE end because `file/clip` [in s, length s] was ignored. These pin the clip window and the take commands for the
 * owner's clip (10 s file, 25 fps, 50 fps channel).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { OscState } = require('../../src/osc/osc-state')
const { applyClipWindow } = require('../../src/osc/osc-state-timing')

const BASE = '/channel/1/stage/layer/110/foreground/file/'
function feed(st, clip, time) {
	if (clip) st.handleOscMessage({ address: BASE + 'clip', args: clip })
	st.handleOscMessage({ address: BASE + 'time', args: time })
	return st._channels[1].layers[110].file
}

test('trimmed take: remaining / progress count to the out point (file/clip), elapsed / duration stay file-absolute', () => {
	const st = new OscState(() => {}, { emitIntervalMs: 50 })
	const f = feed(st, [0, 9.36], [9.34, 10])
	assert.equal(f.duration, 10)
	assert.equal(f.elapsed, 9.34)
	assert.equal(f.outPoint, 9.36)
	assert.ok(Math.abs(f.remaining - 0.02) < 1e-9, `remaining ${f.remaining}`)
	assert.ok(f.progress > 0.99)
	st.destroy?.()
})

test('trim in + out: progress measured inside the window', () => {
	const st = new OscState(() => {}, { emitIntervalMs: 50 })
	const f = feed(st, [0.12, 9.24], [4.74, 10])
	assert.ok(Math.abs(f.outPoint - 9.36) < 1e-9)
	assert.ok(Math.abs(f.remaining - 4.62) < 1e-9)
	assert.ok(Math.abs(f.progress - 0.5) < 1e-9)
	st.destroy?.()
})

test('untrimmed take (window = whole file) or no file/clip → file-based timing, no outPoint', () => {
	const st = new OscState(() => {}, { emitIntervalMs: 50 })
	const f = feed(st, [0, 10], [4, 10])
	assert.equal(f.outPoint, undefined)
	assert.equal(f.remaining, 6)
	const g = { elapsed: 4, duration: 10, remaining: 6, progress: 0.4 }
	applyClipWindow(g)
	assert.deepEqual(g, { elapsed: 4, duration: 10, remaining: 6, progress: 0.4 })
	st.destroy?.()
})

test('a new clip on the layer drops the old window', () => {
	const st = new OscState(() => {}, { emitIntervalMs: 50 })
	st.handleOscMessage({ address: BASE + 'name', args: ['A'] })
	feed(st, [0, 9.36], [1, 10])
	st.handleOscMessage({ address: BASE + 'name', args: ['B'] })
	const f = feed(st, null, [1, 20])
	assert.equal(f.clipLength, undefined)
	assert.equal(f.outPoint, undefined)
	assert.equal(f.remaining, 19)
	st.destroy?.()
})

test('fade-on-end delay of a non-looping trimmed clip is measured to the out point', () => {
	const st = new OscState(() => {}, { emitIntervalMs: 50 })
	st.handleOscMessage({ address: BASE + 'name', args: ['CLIP'] })
	feed(st, [0, 9.36], [8.36, 10])
	const { getOscClipEndFadeDelayMs } = require('../../src/state/playback-tracker-osc')
	const ms = getOscClipEndFadeDelayMs({ oscState: st }, 1, 110, 'CLIP', 25, 50)
	assert.ok(Math.abs(ms - 500) < 1e-6, `fade starts 0.5 s before the out point, got ${ms}`)
	st.destroy?.()
})

test('take for the owner clip: trim-out 9.36 s → LENGTH 468; trim-in 0.12 s (black head frames) → IN 6 SEEK 6 LENGTH 462', async () => {
	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')
	const run = async (layer) => {
		const incoming = { id: 't', layers: [{ layerNumber: 10, source: { type: 'media', value: 'clip.mov' }, loop: true, ...layer }] }
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
			framerate: 50,
			skipLayerVisualEquality: false,
		})
		const o = r.takeJobs[0].loadOpts
		return [o.loop, o.in, o.seek, o.length]
	}
	assert.deepEqual(await run({ startBehaviour: 'custom', trimOutMs: 9360 }), [true, 0, 0, 468])
	assert.deepEqual(await run({ startBehaviour: 'custom', trimInMs: 120, trimOutMs: 9360 }), [true, 6, 6, 462])
})

test('Godot PGM timer shows the out point as the duration of a trimmed take', () => {
	const src = fs.readFileSync(
		path.join(__dirname, '..', '..', 'godot', 'client', 'features', 'live', 'pgm_timer_view.gd'),
		'utf8'
	)
	assert.match(src, /if not is_nan\(_f\(f\.get\("outPoint"\)\)\):\n\t\tdur = _f\(f\.get\("outPoint"\)\)/)
})
