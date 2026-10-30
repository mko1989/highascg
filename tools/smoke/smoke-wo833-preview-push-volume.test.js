'use strict'

/**
 * WO-833 (3k) — the web client's PRV look push sent dB to Caspar's LINEAR `MIXER VOLUME`.
 * Scene layers store linear gain (1 = unity); Caspar's MIXER VOLUME is linear too (1.0 = unity), exactly what the
 * server take sends (resolveTakeVolumeForSceneLayer returns the authored gain as-is). The push converted to dB first,
 * so unity (0 dB) reached Caspar as 0 -> silent PRV and 0.5 (-6 dB) as -6 -> 6x louder.
 *
 * The push is a browser module that needs api/state singletons to run, so this evaluates the actual `const vol = …`
 * line out of the source for a set of authored gains, and pins that every MIXER VOLUME line uses `vol`.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, '../../client/lib/scenes-preview-push-scene.js'), 'utf8')

test('3k: the PRV push computes MIXER VOLUME as linear gain (unity stays 1, mute stays 0)', () => {
	const m = /const vol = ([^\n]+)\n/.exec(src)
	assert.ok(m, 'const vol line present')
	const { linearGainToCasparDb } = (() => {
		// The old expression referenced this helper — keep it resolvable so the OLD source evaluates (and fails the
		// value asserts below) instead of throwing a ReferenceError that would also "fail" for the wrong reason.
		const db = (g) => (Number(g) <= 0 || !Number.isFinite(Number(g)) ? -60 : Math.max(-60, Math.min(6, 20 * Math.log10(Number(g)))))
		return { linearGainToCasparDb: db }
	})()
	const compute = new Function('volGain', 'linearGainToCasparDb', `return ${m[1]}`)
	const run = (g) => compute(g, linearGainToCasparDb)
	assert.equal(run(1), 1, 'unity gain must reach Caspar as 1.0, not 0 dB')
	assert.equal(run(0.5), 0.5)
	assert.equal(run(0), 0, 'muted layer stays silent')
	assert.equal(run(undefined), 1, 'a missing gain defaults to unity')
	assert.equal(run(NaN), 1)
})

test('3k: no dB conversion helper is imported or applied to a MIXER VOLUME line', () => {
	assert.ok(!/linearGainToCasparDb/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'helper not used in code')
	const volumeLines = src.match(/MIXER \$\{cl\} VOLUME [^\n]+/g) || []
	assert.equal(volumeLines.length, 2)
	for (const l of volumeLines) assert.match(l, /VOLUME \$\{vol\} DEFER/)
})
