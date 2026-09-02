'use strict'

/**
 * WO-552 — the real root cause of "sending a look to prv when the timeline look is on pgm results
 * in sending the look to pgm" / "PRV can't have an effect on PGM!!!!"
 *
 * The whole WO-546/548/549/550 investigation was chasing the server's take-orchestration guard
 * (`resolveActiveTimelineIdToFadeOut`) — and that guard was innocent the entire time. Added a
 * stack-trace diagnostic to `TimelineEngine.stop()` itself (WO-551) and the next reproduction
 * named the real caller directly: `routes-timeline.js`'s generic `/api/timelines/:id/stop` route,
 * invoked from `scenes-editor-preview-actions.js`'s `stopActiveTimelineOnServer()` —
 * client-side code that runs on EVERY look preview and EVERY look take, unconditionally stopping
 * whatever timeline happens to be open in the operator's Timeline Editor (`timelineState.getActive()`,
 * a purely client-side, per-operator notion), with no check for whether that timeline happens to
 * be the exact one currently live on program. A comment already on this code path documented the
 * intent plainly: *"Timeline is stopped only when previewing a look ... or when taking a look to
 * program."* — by design, not a coding slip. It just never distinguished "an unrelated timeline
 * left open in the editor" from "the timeline that is this second the actual program output."
 *
 * Fix, at the layer that actually has the truth (the server, not any one client call site): the
 * stop route refuses to stop a timeline that is currently routed to program unless the caller
 * explicitly says `force: true`. The Timeline Editor's own Stop button — a deliberate operator
 * action — opts in. Every incidental caller (previewing or taking an unrelated look) does not, and
 * is now safely refused instead of silently taking PGM off air.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { handleTimelineRoutes } = require('../../src/api/routes-timeline.js')

function makeEng({ airId, onProgram }) {
	const stopped = []
	return {
		stopped,
		get: (id) => (id === airId ? { id } : null),
		getPlayback: (id) => {
			// Mirrors the real TimelineEngine: an explicit id reads that timeline's own stored
			// sendTo; no id reflects the engine's actual current air timeline.
			if (id != null) return { timelineId: id, sendTo: id === airId ? { program: onProgram } : { program: false } }
			return airId ? { timelineId: airId, sendTo: { program: onProgram } } : { timelineId: null, sendTo: {} }
		},
		stop: (id) => {
			stopped.push(id)
		},
	}
}

describe('WO-552: POST /api/timelines/:id/stop refuses to touch a program-live timeline', () => {
	it('a timeline live on program is refused without force', async () => {
		const eng = makeEng({ airId: 'tl-1', onProgram: true })
		const res = await handleTimelineRoutes('POST', '/api/timelines/tl-1/stop', JSON.stringify({}), {
			timelineEngine: eng,
		})
		assert.equal(res.status, 409)
		assert.equal(JSON.parse(res.body).onProgram, true)
		assert.deepEqual(eng.stopped, [], 'eng.stop must never have been called')
	})

	it('the same request WITH force: true is allowed', async () => {
		const eng = makeEng({ airId: 'tl-1', onProgram: true })
		const res = await handleTimelineRoutes('POST', '/api/timelines/tl-1/stop', JSON.stringify({ force: true }), {
			timelineEngine: eng,
		})
		assert.equal(res.status, 200)
		assert.deepEqual(eng.stopped, ['tl-1'])
	})

	it('a timeline that is NOT on program is stopped normally, force or not', async () => {
		for (const body of [{}, { force: true }, { force: false }]) {
			const eng = makeEng({ airId: 'tl-1', onProgram: false })
			const res = await handleTimelineRoutes('POST', '/api/timelines/tl-1/stop', JSON.stringify(body), {
				timelineEngine: eng,
			})
			assert.equal(res.status, 200, `body=${JSON.stringify(body)}`)
			assert.deepEqual(eng.stopped, ['tl-1'])
		}
	})

	it('a timeline that is NOT even the current air timeline is stopped normally (no program to protect)', async () => {
		const eng = makeEng({ airId: 'tl-OTHER', onProgram: true })
		const res = await handleTimelineRoutes('POST', '/api/timelines/tl-1/stop', JSON.stringify({}), {
			timelineEngine: eng,
		})
		assert.equal(res.status, 200)
		assert.deepEqual(eng.stopped, ['tl-1'])
	})

	it('does not use the stale per-id sendTo — only the engine’s actual current air timeline counts', async () => {
		// tl-1 itself still remembers program:true from when IT was air, but tl-OTHER is air now.
		// Stopping tl-1 must be allowed: it is not what is actually live.
		const eng = makeEng({ airId: 'tl-OTHER', onProgram: true })
		eng.getPlayback = (id) => {
			if (id === 'tl-1') return { timelineId: 'tl-1', sendTo: { program: true } } // stale
			if (id == null) return { timelineId: 'tl-OTHER', sendTo: { program: true } }
			return { timelineId: id, sendTo: { program: false } }
		}
		const res = await handleTimelineRoutes('POST', '/api/timelines/tl-1/stop', JSON.stringify({}), {
			timelineEngine: eng,
		})
		assert.equal(res.status, 200, 'must not be fooled by tl-1’s own stale sendTo')
		assert.deepEqual(eng.stopped, ['tl-1'])
	})
})

describe('WO-552: client wiring', () => {
	it('the Timeline Editor’s own Stop button passes force: true (a deliberate operator action)', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../client/components/timeline-transport.js'), 'utf8')
		assert.match(src, /api\.post\(`\/api\/timelines\/\$\{tl\.id\}\/stop`, \{ force: true \}\)/)
	})

	it('the incidental preview/take cleanup does NOT pass force (must be safely refusable)', () => {
		const src = fs.readFileSync(
			path.join(__dirname, '../../client/components/scenes-editor-preview-actions.js'),
			'utf8',
		)
		// The actual API call has no second (body) argument at all — checked precisely, not just
		// "no force:true anywhere in the file" (the explanatory comment above it says those words).
		assert.match(src, /api\.post\(`\/api\/timelines\/\$\{encodeURIComponent\(tl\.id\)\}\/stop`\)\.catch/)
	})
})
