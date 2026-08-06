'use strict'

/**
 * WO-449 — extending a clip past its media length MID-PLAY must re-send PLAY … LOOP
 * (todos06.08: "extending it does not have an effect on the actual playout, it only plays
 * the first segment and then blanks").
 *
 * The clip was started without LOOP (duration ≤ media length). The edge-drag PUT lands in
 * eng.update() → _syncAmcpLayers, but timelineClipTransportStale only compares
 * clipId/src/audioRoute/loopAlways/isRoute — the flipped implicitLoop never retriggered the
 * transport, so Caspar ran to file end and blanked. The fix adds loopStale detection.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

const MEDIA_MS = 10_000

function makeEngine() {
	const sent = []
	const record = (cmd) => sent.push(String(cmd))
	const self = {
		config: { screen_count: 1 },
		_mediaProbeCache: { 'test.mov': { durationMs: MEDIA_MS } },
		amcp: {
			raw: (cmd) => (record(cmd), Promise.resolve()),
			stop: () => Promise.resolve(),
			pause: () => Promise.resolve(),
			resume: () => Promise.resolve(),
			call: (ch, layer, ...args) => (record(`CALL ${ch}-${layer} ${args.join(' ')}`), Promise.resolve()),
			mixerFill: () => Promise.resolve(),
			mixerOpacity: () => Promise.resolve(),
			mixerVolume: () => Promise.resolve(),
			mixerCommit: () => Promise.resolve(),
			batchSendChunked: (lines) => ((lines || []).forEach(record), Promise.resolve()),
		},
	}
	return { eng: new TimelineEngine(self), sent }
}

const makeTl = (clipDuration) => ({
	id: 'tl1',
	duration: 60_000,
	fps: 25,
	sendTo: { preview: true, program: false, screenIdx: 0 },
	layers: [
		{
			id: 'l1',
			clips: [{ id: 'c1', startTime: 0, duration: clipDuration, inPoint: 0, source: { value: 'test.mov' } }],
		},
	],
})

test('WO-449: mid-play clip extension past media length re-sends PLAY … LOOP', async () => {
	const { eng, sent } = makeEngine()
	eng.create(makeTl(8_000))
	eng.play('tl1', 0)
	await new Promise((r) => setImmediate(r))

	const firstPlay = sent.filter((l) => l.startsWith('PLAY '))
	assert.ok(firstPlay.length >= 1, 'transport PLAY sent on play()')
	assert.ok(!firstPlay.some((l) => l.includes(' LOOP ')), 'clip within media length starts without LOOP')

	sent.length = 0
	// Owner drags the right edge to 30s (> 10s media) while the timeline is playing.
	eng.update('tl1', makeTl(30_000))
	await new Promise((r) => setImmediate(r))

	const rePlay = sent.filter((l) => l.startsWith('PLAY '))
	assert.ok(rePlay.length >= 1, 'loop-requirement flip must re-send the transport')
	assert.ok(
		rePlay.some((l) => l.includes(' LOOP ')),
		`re-sent PLAY must carry LOOP (got: ${rePlay.join(' | ')})`,
	)

	sent.length = 0
	// Same update again: no loop change → no transport churn.
	eng.update('tl1', makeTl(30_000))
	await new Promise((r) => setImmediate(r))
	assert.equal(sent.filter((l) => l.startsWith('PLAY ')).length, 0, 'no re-PLAY when nothing flipped')

	eng.stop('tl1')
})
