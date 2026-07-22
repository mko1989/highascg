'use strict'

/**
 * Template CG fade-OUT — template→media transitions must MIX out, not cut.
 *
 * Template CG lives on a fixed 700+ overlay host, outside the bank crossfade, so on exit it used to
 * be cleared flat (a hard cut) while the media crossfaded. The teardown now fades the exiting
 * template's host opacity to 0 over the (remaining) crossfade window BEFORE the wait, then the
 * existing CG CLEAR after the wait completes the removal. It also resets the host opacity to 1 after
 * the clear, so a later CUT-in template on the same host is not left invisible.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { runSceneTakeLbgTeardown } = require('../../src/engine/scene-take-lbg-teardown')

function spyAmcp() {
	const lines = []
	return {
		lines,
		_send: (line) => {
			lines.push(String(line))
			return Promise.resolve({ ok: true })
		},
		mixerCommit: () => Promise.resolve(),
	}
}

/** Minimal teardown ctx with one EXITING template layer (layer 20 → host 710). */
function ctxWith(amcp, { fadeDur }) {
	return {
		amcp,
		self: { config: {}, log: () => {} },
		channel: 3,
		exitMedia: [{ layerNumber: 20, source: { type: 'template', value: 'tpl/lower_third' } }],
		needsBorderOnlyTeardown: false,
		fadeClockStart: fadeDur > 0 ? Date.now() - 10 : null, // a hair elapsed → teardownWait > 0
		fadeDur,
		fadeMs: fadeDur > 0 ? (fadeDur / 50) * 1000 : 0,
		takeJobs: [],
		isMergeTransition: false,
		currentSceneLayers: [],
		currentGbEnabled: false,
		incomingGbEnabled: false,
		activeBank: 'a',
		inactiveBank: 'b',
		phys: (ln, bank) => (bank === 'a' ? ln : ln + 100),
		incomingTemplateHostLayers: new Set(), // template not replaced → it is exiting
	}
}

test('crossfade exit: template host fades to 0 BEFORE the clear, then resets to 1 AFTER', async () => {
	const amcp = spyAmcp()
	await runSceneTakeLbgTeardown(ctxWith(amcp, { fadeDur: 12 }))
	const l = amcp.lines

	const fadeAt = l.findIndex((x) => /^MIXER 3-710 OPACITY 0 \d+/.test(x))
	const clearAt = l.findIndex((x) => /^CG 3-710 CLEAR$/.test(x))
	const resetAt = l.findIndex((x) => /^MIXER 3-710 OPACITY 1 0$/.test(x))

	assert.ok(fadeAt >= 0, 'exiting template host fades out')
	assert.ok(clearAt >= 0, 'and is cleared')
	assert.ok(resetAt >= 0, 'and its opacity is reset for reuse')
	assert.ok(fadeAt < clearAt, 'the fade-out is emitted BEFORE the clear (the wait lets it complete)')
	assert.ok(clearAt < resetAt, 'the opacity reset comes AFTER the clear (empty layer → next cut-in visible)')
})

test('cut exit (no fade): flat clear, NO opacity fade-out (unchanged behaviour)', async () => {
	const amcp = spyAmcp()
	await runSceneTakeLbgTeardown(ctxWith(amcp, { fadeDur: 0 }))
	const l = amcp.lines
	assert.ok(!l.some((x) => /^MIXER 3-710 OPACITY 0 \d/.test(x)), 'a cut exit never fades the template out')
	assert.ok(l.some((x) => /^CG 3-710 CLEAR$/.test(x)), 'the template is still cleared')
})
