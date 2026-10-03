'use strict'

/**
 * WO-590 — a template layer's position/size must reach the layer the template actually plays on.
 *
 * Template CG plays on a 700+ overlay host, but the take only sent the look layer's MIXER FILL to
 * the look-band physical layer (where nothing plays), so moving a template layer never moved it on
 * PGM. This pins:
 *  - with a fill, the FILL goes on the CG host layer, BEFORE the ADD (no flash at stale geometry);
 *  - the continuity UPDATE path re-applies it (moving a live template layer follows on air);
 *  - no fill → output unchanged (shader band / standalone LT callers pass none);
 *  - both take pipelines pass the job's resolved fill (source-text guard).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const {
	buildSceneTemplateCgAmcpLines,
	buildSceneTemplateCgUpdateOnlyLines,
} = require('../../src/engine/scene-template-cg')

const spec = { cgName: 'lower-thirds/lt-confetti-center', data: '{}', playOnLoad: true }
const fill = { x: 0.25, y: -0.1, scaleX: 0.5, scaleY: 0.5 }

test('cut take: FILL on the CG host layer, before ADD', () => {
	const lines = buildSceneTemplateCgAmcpLines(1, 11, spec, { fill })
	const add = lines.findIndex((l) => /^CG 1-701 ADD /.test(l))
	const fl = lines.indexOf('MIXER 1-701 FILL 0.25 -0.1 0.5 0.5 0')
	assert.ok(add > 0, 'ADD on host 701')
	assert.ok(fl >= 0 && fl < add, `FILL precedes ADD: ${JSON.stringify(lines)}`)
})

test('crossfade take: FILL also staged before the hidden ADD', () => {
	const lines = buildSceneTemplateCgAmcpLines(1, 11, spec, { fill, fadeDurFrames: 12 })
	const fl = lines.indexOf('MIXER 1-701 FILL 0.25 -0.1 0.5 0.5 0')
	assert.ok(fl >= 0 && fl < lines.findIndex((l) => /^CG 1-701 ADD /.test(l)))
	assert.ok(lines.includes('MIXER 1-701 OPACITY 1 12'))
})

test('continuity UPDATE re-applies the fill on the host layer', () => {
	const lines = buildSceneTemplateCgUpdateOnlyLines(1, 11, spec, { fill })
	assert.deepEqual(lines, ['MIXER 1-701 FILL 0.25 -0.1 0.5 0.5 0', 'CG 1-701 UPDATE 0 {}'])
})

test('no / unusable fill → exactly the previous output', () => {
	const base = buildSceneTemplateCgAmcpLines(1, 11, spec)
	assert.deepEqual(buildSceneTemplateCgAmcpLines(1, 11, spec, { fill: { x: 'a' } }), base)
	assert.ok(!base.some((l) => / FILL /.test(l)))
	assert.deepEqual(buildSceneTemplateCgUpdateOnlyLines(1, 11, spec), ['CG 1-701 UPDATE 0 {}'])
})

test('both take pipelines pass the job fill to the template builders', () => {
	const root = path.resolve(__dirname, '../..')
	const lbg = fs.readFileSync(path.join(root, 'src/engine/scene-take-lbg-amcp-pipeline.js'), 'utf8')
	assert.match(lbg, /buildSceneTemplateCgUpdateOnlyLines\(channel, job\.layer\.layerNumber, job\.templateCg, \{ fill: job\.f \}\)/)
	assert.match(lbg, /buildSceneTemplateCgAmcpLines\(channel, job\.layer\.layerNumber, job\.templateCg, \{ \.\.\.cgFade, fill: job\.f \}\)/)
	const pgm = fs.readFileSync(path.join(root, 'src/engine/scene-take-pgm-only.js'), 'utf8')
	assert.match(pgm, /const cgOpts = isShader \? cgFade : \{ \.\.\.cgFade, fill: job\.f \}/)
})
