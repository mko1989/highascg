'use strict'

/**
 * WO-558 — previewing a plain look still hit program, one tick after the (correctly protected)
 * release call.
 *
 * Owner todos03.09.26: *"sending looks on preview has effect on pgm channel which is just plain
 * wrong and should never ever happen."* Live wire capture (`log/caspar_2026-09-03.log`,
 * ~11:20:03.020-03.165) during the EXACT repro this session had already "fixed" (WO-555/556 Bug
 * A/B): a timeline live on program+preview, then a plain click-to-preview on a DIFFERENT,
 * timeline-free look. `MIXER 2-10/11/12 ...` (the new look, correctly on the preview channel) at
 * 11:20:03.020-03.021, immediately followed at 11:20:03.112-03.165 by a full, unprotected
 * `MIXER 1-210/211/212 FILL/OPACITY/.../CROP/CLIP/PERSPECTIVE` block AND `STOP 1-211` + `PLAY
 * 1-211 ...` — on PROGRAM's own timeline layers, ~90-140ms after the release call.
 *
 * That gap rules out the release call's own (`skipAmcpApply: true`, WO-556) reapply — it was
 * already suppressed. The actual source: `setSendTo`'s routing-change handler (WO-555) correctly
 * stopped only the REMOVED channel, but then wiped `_prevKey`/`_lastKfValues`/`_lastKfSegment`
 * ENTIRELY — these are single shared maps keyed `${ch}-${caspLayer}[...]`, not per-channel. Wiping
 * them drops the still-valid cached transport state for program too, even though program's routing
 * never changed. The very next regular tick (`_tick()`, an unrelated `setInterval` firing every
 * ~40ms, NOT triggered by the release call) reads `prev = this._prevKey.get(key)` for program's
 * layers, finds nothing, treats the transport as "never started", and force-restarts it — the exact
 * STOP+PLAY-plus-full-mixer-reset block measured on the wire, on a channel the preview action never
 * should have touched.
 *
 * Fix: only drop cache entries for channels actually being REMOVED (`removedCh`) — a channel
 * present in both the old and new routing keeps its cache, so the next tick still sees it as
 * unchanged and leaves it alone.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { startSceneTimelineLayer } = require('../../src/engine/timeline-take.js')

function makeEngine() {
	const sentLines = []
	const noop = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		log: () => {},
		amcp: {
			raw: (cmd) => {
				sentLines.push(cmd)
				return Promise.resolve()
			},
			stop: (ch, layer) => {
				sentLines.push(`STOP ${ch}-${layer}`)
				return Promise.resolve()
			},
			pause: noop,
			resume: noop,
			call: noop,
			mixerFill: noop,
			mixerOpacity: noop,
			mixerVolume: noop,
			mixerCommit: noop,
			batchSendChunked: (lines) => {
				sentLines.push(...(lines || []))
				return Promise.resolve()
			},
		},
	}
	const eng = new TimelineEngine(self)
	self.timelineEngine = eng
	eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'L1', clips: [{ id: 'c1', startTime: 0, duration: 60000, source: { value: 'a.mov' } }] }],
	})
	return { self, eng, sentLines }
}

function programLines(sentLines) {
	return sentLines.filter((l) => /^(PLAY|STOP|LOAD)\s+1-/.test(String(l)))
}

describe('WO-558: a regular tick after a routing change must not touch a persisting channel', () => {
	it('release-from-preview (WO-556 shape) + the NEXT tick: program is untouched', async () => {
		const { self, eng, sentLines } = makeEngine()
		// Timeline live on both channels — channel 1 = program, 2 = preview (default map fallback:
		// programCh(1)=1, previewCh(1)=2). WO-559: an unrestricted take alone only claims program now,
		// so the both-buses precondition is established explicitly here.
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		eng.setSendTo({ preview: true, program: true, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		sentLines.length = 0
		// The exact WO-556 release call shape: drop preview, keep program, skipAmcpApply:true.
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		const afterReleaseCount = sentLines.length
		assert.equal(programLines(sentLines).length, 0, 'the release call itself must not touch program (WO-556)')
		// Simulate the NEXT regular tick — an unrelated setInterval, not triggered by the call above.
		eng._tick()
		assert.equal(programLines(sentLines).length, 0, `the next tick must not restart program either, got: ${JSON.stringify(sentLines.slice(afterReleaseCount))}`)
	})

	it('regression check: reverting the cache fix reproduces the wire capture directly', async () => {
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		// WO-559: an unrestricted take alone no longer claims preview too — establish the both-buses
		// precondition this release scenario actually exercises explicitly.
		eng.setSendTo({ preview: true, program: true, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		sentLines.length = 0
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		// Reproduce the PRE-WO-558 behavior directly: wholesale-clear the caches, exactly as the old
		// code did unconditionally on any routing change (this test does it by hand since the fix
		// makes the real setSendTo call above no longer do this).
		eng._prevKey = new Map()
		eng._lastKfValues.clear()
		eng._lastKfSegment.clear()
		eng._tick()
		assert.ok(programLines(sentLines).length > 0, 'documents the pre-WO-558 mechanism: wholesale cache clear forces the next tick to restart program')
	})

	it('the preview channel (correctly removed) is unaffected by the fix — still cleared', async () => {
		const { self, eng, sentLines } = makeEngine()
		await startSceneTimelineLayer(self, self.amcp, 1, { source: { value: 'tl1' } }, {
			fadeDur: 0,
			screenIdx: 0,
			startAtCurrentPosition: false,
		})
		// WO-559: an unrestricted take alone no longer claims preview too — establish the both-buses
		// precondition this release scenario actually exercises explicitly.
		eng.setSendTo({ preview: true, program: true, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		sentLines.length = 0
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 }, 'tl1', { skipAmcpApply: true })
		const preview2Lines = sentLines.filter((l) => /^STOP\s+2-/.test(String(l)))
		assert.ok(preview2Lines.length > 0, 'the dropped preview channel must still be stopped (WO-555 differential stop, unaffected)')
	})
})

describe('WO-558: wired end-to-end', () => {
	it('timeline-playback-runtime.js only clears cache entries for removed channels', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/engine/timeline-playback-runtime.js'), 'utf8')
		assert.match(src, /if \(removedCh\.includes\(Number\(key\.split\('-'\)\[0\]\)\)\) this\._prevKey\.delete\(key\)/)
		assert.match(src, /if \(removedCh\.includes\(Number\(key\.split\('-'\)\[0\]\)\)\) this\._lastKfValues\.delete\(key\)/)
		assert.match(src, /if \(removedCh\.includes\(Number\(key\.split\('-'\)\[0\]\)\)\) this\._lastKfSegment\.delete\(key\)/)
	})
})
