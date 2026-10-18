'use strict'

/**
 * WO-618 — every tween the UI can pick must reach Caspar as a name its tweener knows
 * (Caspar answers `403 … FAILED` for `easein` / `easeout` / `easeboth`, which the UI offered).
 */

const assert = require('assert')
const { toCasparTween, CASPAR_TWEENS } = require('../../src/caspar/caspar-tween')
const { mapKeyframeTween } = require('../../src/engine/timeline-keyframe-mixer')
const { normalizeTransition } = require('../../src/engine/scene-transition')
const { buildClipCommandPlan, serializeClipCommandPlan } = require('../../src/caspar/amcp-command-plan')

// transition shorthands (client/lib/transition-presets.js TRANSITION_TWEENS)
for (const [ui, caspar] of [
	['linear', 'linear'],
	['easein', 'easeinquad'],
	['easeout', 'easeoutquad'],
	['easeboth', 'easeinoutquad'],
]) {
	assert.strictEqual(toCasparTween(ui), caspar, `transition ${ui}`)
	assert.ok(CASPAR_TWEENS.has(toCasparTween(ui)))
}
// keyframe easings (client/components/inspector-fill-timeline.js)
for (const [ui, caspar] of [
	['linear', 'linear'],
	['ease-in', 'easeinquad'],
	['ease-out', 'easeoutquad'],
	['ease-in-out', 'easeinoutquad'],
]) {
	assert.strictEqual(mapKeyframeTween(ui), caspar, `keyframe ${ui}`)
}
assert.strictEqual(toCasparTween('EaseInOutSine'), 'easeinoutsine', 'Caspar names pass through (case-folded)')
assert.strictEqual(toCasparTween('easeoutelastic:2:0.5'), 'easeoutelastic:2:0.5', 'parameter suffix kept')
assert.strictEqual(toCasparTween('easeoutinback'), 'linear', 'not in Caspar (it spells it easeoutintback)')
assert.strictEqual(toCasparTween('bogus'), 'linear', 'unknown never fails a take')
assert.strictEqual(toCasparTween(undefined), 'linear')
assert.strictEqual(toCasparTween(''), 'linear')

// the take path and the PLAY/LOADBG line
assert.strictEqual(normalizeTransition({ type: 'MIX', duration: 25, tween: 'easeboth' }).tween, 'easeinoutquad')
const plan = buildClipCommandPlan('PLAY', 1, 10, 'CLIP', { transition: 'MIX', duration: 25, tween: 'easein' })
assert.match(serializeClipCommandPlan(plan), / MIX 25 easeinquad$/)

console.log('smoke-wo618-caspar-tween: OK')
