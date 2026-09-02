'use strict'

/**
 * WO-543 — owner QA (02.09): "timeline playhead passing thru the companion button flag does not
 * trigger that companion button press."
 *
 * Investigation: `_processTimelineFlags`'s crossing detection and `_fireCompanionPress`'s dispatch
 * were verified correct in every constructed scenario (direct play, the real setInterval ticker,
 * resume-from-pause, loop restart) — see the probe scripts this WO's work order records. No
 * reproducible defect was found in the crossing logic itself. Two real gaps WERE found by
 * comparing the flag's HTTP-press fallback against the "Test press" route it was modeled on
 * (`routes-companion-preview.js`, confirmed working by the owner):
 *
 * 1. The Test-press route checks `r.ok`/`r.status` and reports it back to the operator. The flag's
 *    HTTP fallback only had a `.catch` for network-level failures — `fetch()` does NOT reject on a
 *    non-2xx response, so a real Companion-side error (wrong location, Companion busy) would have
 *    landed as a silent, unlogged "success".
 * 2. The `this._airTimelineId === capturedId` staleness guard (only one timeline is ever "on air"
 *    engine-wide — playing a second timeline stops the first's ticker) silently dropped the press
 *    with zero trace if a different timeline took over between the crossing and the deferred fire.
 *
 * Both paths now log, so the NEXT time this is reproduced, `journalctl -u highascg` will show
 * exactly which stage failed instead of nothing at all. This file locks in the crossing-detection
 * behavior that was verified correct, and the new response-status / staleness logging.
 *
 * **Follow-up, same day (WO-547):** the logging this WO added is exactly what caught the real
 * cause — `journalctl` showed "sent via Satellite" with no error, yet nothing pressed. Satellite's
 * `KEY-STATE` was never a real Companion trigger command, and the project's own architecture
 * reference explicitly says pressing stays HTTP-only. `_fireCompanionPress` is HTTP-only again
 * now, matching WO-24's original design — see the "WO-547" describe block below.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')

const { TimelineEngine } = require('../../src/engine/timeline-engine')

const originalFetch = global.fetch
after(() => {
	global.fetch = originalFetch
})

function noop() {
	return Promise.resolve()
}

function makeEngine(logSink) {
	const self = {
		config: { screen_count: 1, companion: { host: '127.0.0.1', port: 8001 } },
		log: (level, msg) => logSink.push({ level, msg }),
		mediaDetails: {},
		CHOICES_MEDIAFILES: [],
		amcp: {
			raw: noop,
			stop: noop,
			pause: noop,
			resume: noop,
			call: noop,
			loadbg: noop,
			mixerFill: noop,
			mixerOpacity: noop,
			mixerVolume: noop,
			mixerCommit: noop,
			batchSendChunked: noop,
			sendBatch: noop,
		},
	}
	return new TimelineEngine(self)
}

function makeFlagTimeline(eng, flagOverrides = {}) {
	return eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'L1', clips: [] }],
		flags: [
			Object.assign(
				{ id: 'f1', type: 'companion_press', timeMs: 500, companionPage: 1, companionRow: 0, companionColumn: 2 },
				flagOverrides,
			),
		],
	})
}

describe('WO-543: crossing detection dispatches to _fireCompanionPress', () => {
	it('a direct crossing window (prevMs < flagMs <= ms) fires the flag exactly once', async () => {
		const log = []
		const eng = makeEngine(log)
		makeFlagTimeline(eng)
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 })
		eng.play('tl1', 0)
		const fired = []
		eng._fireCompanionPress = (f) => fired.push(f.id)

		eng._processTimelineFlags('tl1', 400, 600)
		await new Promise((r) => setImmediate(r))

		assert.deepEqual(fired, ['f1'])
		assert.ok(log.some((l) => /crossed companion_press flag/.test(l.msg)), 'crossing was logged')
		eng.pause('tl1')
	})

	it('the real setInterval ticker crosses the flag during normal playback', async () => {
		const log = []
		const eng = makeEngine(log)
		makeFlagTimeline(eng, { timeMs: 120 })
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 })
		const fired = []
		eng._fireCompanionPress = (f) => fired.push(f.id)

		eng.play('tl1', 0)
		await new Promise((r) => setTimeout(r, 400))
		eng.pause('tl1')

		assert.deepEqual(fired, ['f1'])
	})

	it('resuming from a pause before the flag still fires it once reached', async () => {
		const log = []
		const eng = makeEngine(log)
		makeFlagTimeline(eng, { timeMs: 250 })
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 })
		const fired = []
		eng._fireCompanionPress = (f) => fired.push(f.id)

		eng.play('tl1', 0)
		await new Promise((r) => setTimeout(r, 80)) // well before the flag at 250ms
		eng.pause('tl1')
		assert.deepEqual(fired, [], 'not reached yet')

		eng.play('tl1') // resume, no explicit fromMs
		await new Promise((r) => setTimeout(r, 400))
		eng.pause('tl1')

		assert.deepEqual(fired, ['f1'])
	})

	it('a loop restart re-arms the flag for the next pass', async () => {
		const log = []
		const eng = makeEngine(log)
		const tl = makeFlagTimeline(eng, { timeMs: 60 })
		tl.duration = 150
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 })
		const fired = []
		eng._fireCompanionPress = (f) => fired.push(f.id)

		eng.setLoop('tl1', true)
		eng.play('tl1', 0)
		await new Promise((r) => setTimeout(r, 500)) // several loop passes at 150ms duration
		eng.pause('tl1')

		assert.ok(fired.length >= 2, `flag re-fired across loop passes: ${fired.length}`)
	})

	it('a different timeline taking over drops the press but logs why', async () => {
		const log = []
		const eng = makeEngine(log)
		makeFlagTimeline(eng)
		eng.create({ id: 'tl2', duration: 10000, fps: 25, layers: [] })
		eng.setSendTo({ preview: false, program: true, screenIdx: 0 })
		eng.play('tl1', 0)
		const fired = []
		eng._fireCompanionPress = (f) => fired.push(f.id)

		eng._processTimelineFlags('tl1', 400, 600) // detects the crossing, schedules setImmediate
		eng.play('tl2', 0) // takes over air BEFORE the setImmediate callback runs
		await new Promise((r) => setImmediate(r))

		assert.deepEqual(fired, [], 'press correctly dropped — tl2 is air now, not tl1')
		assert.ok(
			log.some((l) => l.level === 'warn' && /different timeline .* took over/.test(l.msg)),
			`the drop was logged, not silent: ${JSON.stringify(log)}`,
		)
	})
})

describe('WO-547: _fireCompanionPress is HTTP-only (Satellite press attempt removed)', () => {
	// WO-535 (08-14) added a Satellite-first attempt here, which this session's owner report and
	// docs/reference/companion-satellite-api.md ("Timeline press/trigger stays on the HTTP Remote
	// Control API") both say was wrong: Satellite's KEY-STATE is not a real Companion trigger
	// command (the documented one, SUB-PRESS, was itself explicitly rejected for triggering back
	// in WO-75 — "adds connection state; HTTP is the established show trigger"), so the write
	// succeeded silently and nothing was ever pressed. Restored to WO-24's original direct-HTTP
	// design; these tests pin that satellite-preview-client is never touched by this function.

	it('never requires the satellite module — calling it does not even attempt to load satellite-preview-client', async () => {
		const modPath = require.resolve('../../src/companion/satellite-preview-client')
		const wasCached = !!require.cache[modPath]
		if (wasCached) delete require.cache[modPath]

		const log = []
		const eng = makeEngine(log)
		makeFlagTimeline(eng)
		global.fetch = async () => ({ ok: true, status: 200 })
		eng._fireCompanionPress({ id: 'f1', companionPage: 1, companionRow: 0, companionColumn: 2 })
		await new Promise((r) => setImmediate(r))

		assert.equal(
			!!require.cache[modPath],
			wasCached,
			'satellite-preview-client must not get pulled into the module cache by a press',
		)
	})

	it('HTTP succeeds: logs the confirmed status, hits the documented URL/method/headers', async () => {
		const log = []
		const eng = makeEngine(log)
		makeFlagTimeline(eng)
		let captured = null
		global.fetch = async (url, opts) => {
			captured = { url, opts }
			return { ok: true, status: 200 }
		}
		eng._fireCompanionPress({ id: 'f1', companionPage: 1, companionRow: 0, companionColumn: 2 })
		await new Promise((r) => setImmediate(r))

		assert.equal(captured.url, 'http://127.0.0.1:8001/api/location/1/0/2/press')
		assert.equal(captured.opts.method, 'POST')
		assert.equal(captured.opts.headers['Content-Type'], 'application/json')
		assert.ok(log.some((l) => l.level === 'debug' && /HTTP \(status 200\)/.test(l.msg)))
	})

	it('HTTP responds with an error status: warns instead of silently succeeding (the WO-543 gap, still fixed)', async () => {
		const log = []
		const eng = makeEngine(log)
		makeFlagTimeline(eng)
		global.fetch = async () => ({ ok: false, status: 404 })
		eng._fireCompanionPress({ id: 'f1', companionPage: 1, companionRow: 0, companionColumn: 2 })
		await new Promise((r) => setImmediate(r))
		assert.ok(
			log.some((l) => l.level === 'warn' && /status 404/.test(l.msg) && /did not confirm/.test(l.msg)),
			`a non-ok response is surfaced, not swallowed: ${JSON.stringify(log)}`,
		)
	})

	it('HTTP throws (network failure): logs a warning', async () => {
		const log = []
		const eng = makeEngine(log)
		makeFlagTimeline(eng)
		global.fetch = async () => {
			throw new Error('ECONNREFUSED')
		}
		eng._fireCompanionPress({ id: 'f1', companionPage: 1, companionRow: 0, companionColumn: 2 })
		await new Promise((r) => setImmediate(r))
		assert.ok(log.some((l) => l.level === 'warn' && /ECONNREFUSED/.test(l.msg)))
	})
})
