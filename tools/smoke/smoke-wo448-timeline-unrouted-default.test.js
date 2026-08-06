'use strict'

/**
 * WO-448 — timeline must not touch PGM until explicitly routed (todos06.08).
 *
 * Two halves of the same leak:
 * 1. Engine: `_channelsFor` had a last-resort fallback that crossed a PRV-only request over
 *    to programCh(1) when the screen had no PRV bus (pgm_only/pixelmap) — so a "preview-only"
 *    timeline scrub still painted over the live look on PGM-only rigs.
 * 2. Client: `coerceTimelineSendTo` forced program:true on pgm_only (covered by the repointed
 *    assertions in smoke-preview-amcp-channel.mjs).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

const engineWithMode = (mode) =>
	new TimelineEngine({
		config: {
			screen_count: 1,
			screenDestinations: {
				destinations: [{ id: 'd1', type: 'screen', enabled: true, mode, mainScreenIndex: 0 }],
			},
		},
	})
const pgmPrvEngine = () => engineWithMode('pgm_prv')
const pgmOnlyEngine = () => engineWithMode('pgm_only')

test('WO-448: unrouted sendTo resolves to NO channels', () => {
	assert.deepEqual(pgmPrvEngine()._channelsFor({ preview: false, program: false, screenIdx: 0 }), [])
	assert.deepEqual(pgmOnlyEngine()._channelsFor({ preview: false, program: false, screenIdx: 0 }), [])
})

test('WO-448: PRV-only request on a pgm_only screen routes NOWHERE, never to PGM', () => {
	const ch = pgmOnlyEngine()._channelsFor({ preview: true, program: false, screenIdx: 0 })
	assert.deepEqual(ch, [], 'the old fallback pushed programCh(1) here — the todos06.08 bleed')
})

test('WO-448: explicit program request still routes to PGM (Take / look playback path)', () => {
	const ch = pgmOnlyEngine()._channelsFor({ preview: false, program: true, screenIdx: 0 })
	assert.equal(ch.length, 1, 'program request resolves one channel')
	const both = pgmPrvEngine()._channelsFor({ preview: true, program: true, screenIdx: 0 })
	assert.equal(both.length, 2, 'PRV+PGM on a pgm_prv screen resolves both channels')
})

test('WO-448: PRV-only on a pgm_prv screen still routes to the preview channel', () => {
	const ch = pgmPrvEngine()._channelsFor({ preview: true, program: false, screenIdx: 0 })
	assert.equal(ch.length, 1, 'preview bus exists → exactly the PRV channel')
})
