'use strict'

/**
 * Template CG crossfade — media↔template transitions must MIX, not cut.
 *
 * A CG/shader template lands on a fixed 700+ overlay host layer that the bank crossfade never
 * touches, so historically it popped at full opacity (a hard cut) while the media layers around it
 * mixed. The builder now optionally fades the template in on its OWN host layer (add hidden → tween
 * up), mirroring the global-border pattern. This pins:
 *  - CUT unchanged when no fade duration is given (must not regress existing takes);
 *  - a fade produces OPACITY 0 BEFORE the CG plays and OPACITY 1 <dur> AFTER, on the same host layer.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { buildSceneTemplateCgAmcpLines } = require('../../src/engine/scene-template-cg')

const spec = { cgName: 'lower_third', data: '{"t":"hi"}', playOnLoad: true }

test('no fade opts → CUT: exactly CLEAR/ADD/PLAY/UPDATE, no MIXER OPACITY (unchanged)', () => {
	const lines = buildSceneTemplateCgAmcpLines(3, 20, spec)
	assert.ok(!lines.some((l) => /MIXER .* OPACITY/.test(l)), 'a cut take emits no opacity ramp')
	assert.ok(lines.some((l) => /^CG 3-\d+ ADD /.test(l)))
	assert.ok(lines.some((l) => /^CG 3-\d+ PLAY 0$/.test(l)))
})

test('fadeDurFrames > 0 → CROSSFADE: hidden before play, tween up after, same host layer', () => {
	const lines = buildSceneTemplateCgAmcpLines(3, 20, spec, { fadeDurFrames: 12, fadeTween: 'easeinoutsine' })
	// Resolve the host layer id from the ADD line so the assertions are layer-exact.
	const add = lines.find((l) => /^CG 3-\d+ ADD /.test(l))
	const host = add.match(/^CG (3-\d+) ADD/)[1]
	const idx = (re) => lines.findIndex((l) => re.test(l))

	const hideAt = idx(new RegExp(`^MIXER ${host} OPACITY 0 0$`))
	const playAt = idx(new RegExp(`^CG ${host} PLAY 0$`))
	const fadeAt = idx(new RegExp(`^MIXER ${host} OPACITY 1 12 `))

	assert.ok(hideAt >= 0, 'starts hidden with OPACITY 0 0')
	assert.ok(playAt >= 0, 'CG plays')
	assert.ok(fadeAt >= 0, 'tweens to full opacity over the fade duration')
	assert.ok(hideAt < playAt, 'hidden BEFORE the template plays (else it flashes at full opacity)')
	assert.ok(fadeAt > playAt, 'the fade-in tween comes AFTER play')
	assert.match(lines[fadeAt], /easeinoutsine/, 'the tween easing rides the opacity ramp')
})

test('the opacity ramp targets the SAME host layer the CG is added to (not the bank layer)', () => {
	const lines = buildSceneTemplateCgAmcpLines(5, 120, spec, { fadeDurFrames: 25 })
	const hosts = new Set(lines.map((l) => (l.match(/(?:CG|MIXER) (5-\d+)/) || [])[1]).filter(Boolean))
	assert.equal(hosts.size, 1, 'every CG and MIXER line acts on one and the same host layer')
})

test('a zero/invalid fade duration falls back to a cut', () => {
	for (const bad of [0, -5, NaN, undefined]) {
		const lines = buildSceneTemplateCgAmcpLines(3, 20, spec, { fadeDurFrames: bad })
		assert.ok(!lines.some((l) => /MIXER .* OPACITY/.test(l)), `fadeDurFrames=${bad} must not fade`)
	}
})
