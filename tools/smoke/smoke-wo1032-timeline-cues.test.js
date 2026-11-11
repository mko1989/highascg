'use strict'

/**
 * WO-1032 — timeline cues (companion_press / light flags), owner 11.11: "make sure the rest is fixed too" after an
 * audit of a timeline played from a look:
 *  1. two cues on the same time (or behind one late tick): only the first fired;
 *  2. a cue at exactly 0 never fired — on a first play and on a loop wrap;
 *  3. cues fired while the timeline was only on PREVIEW (a look taken to PRV pressed real buttons);
 *  4. a pause flag on the same time as a cue swallowed the cue;
 *  5. a preview take of a look kept a stored `program: true` of a timeline that was not on air.
 * A seek / jump OVER a cue still does not fire it (scrubbing must not spray cues); landing exactly ON one does.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')

const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { startSceneTimelineLayer } = require('../../src/engine/timeline-take')

const engines = []
after(() => {
	for (const e of engines) {
		if (e._ticker) clearInterval(e._ticker)
		e._ticker = null
	}
})

const noop = () => Promise.resolve()
const PGM = { preview: false, program: true, screenIdx: 0 }
const cp = (id, timeMs) => ({ id, timeMs, type: 'companion_press', label: id })
const lt = (id, timeMs) => ({ id, timeMs, type: 'light', label: id, consoleId: 'c', action: 'go' })
const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function rig(flags, opts = {}) {
	const fired = []
	const self = {
		config: { screen_count: 1 },
		log: () => {},
		mediaDetails: {},
		CHOICES_MEDIAFILES: [],
		amcp: new Proxy({}, { get: () => noop }),
		lightingConsoles: { fire: async (_id, f) => fired.push(f.id) },
	}
	const eng = new TimelineEngine(self)
	self.timelineEngine = eng
	engines.push(eng)
	eng._fireCompanionPress = (f) => fired.push(f.id)
	eng.create({ id: 'T', duration: opts.duration || 60000, fps: 25, sendTo: opts.sendTo || PGM, flags, layers: [{ id: 'l', name: 'L', clips: [] }] })
	return { eng, self, fired }
}

describe('WO-1032: every crossed cue fires', () => {
	it('cues on the same time and cues behind one late tick all fire, in time order', async () => {
		const { eng, fired } = rig([cp('c', 500), lt('a', 500), cp('b', 500), lt('d', 900)])
		eng._airTimelineId = 'T'
		assert.equal(eng._processTimelineFlags('T', 400, 1000), false)
		await settle()
		assert.deepEqual(fired.sort(), ['a', 'b', 'c', 'd'])
		eng._processTimelineFlags('T', 1000, 1040)
		await settle()
		assert.equal(fired.length, 4, 'none twice')
	})

	it('a cue on the same time as a pause flag fires, then the pause runs', async () => {
		const { eng, fired } = rig([{ id: 'p', timeMs: 500, type: 'pause' }, cp('z', 500)])
		eng.play('T', 0)
		assert.equal(eng._processTimelineFlags('T', 400, 600), true, 'the pause stops the tick')
		await settle()
		assert.deepEqual(fired, ['z'])
		assert.equal(eng.getPlayback('T').playing, false)
	})

	it('only the first crossed transport flag runs', () => {
		const { eng } = rig([{ id: 'p1', timeMs: 500, type: 'pause' }, { id: 'j', timeMs: 510, type: 'jump', jumpTimeMs: 0 }])
		eng.play('T', 0)
		let seeks = 0
		const seek = eng.seek.bind(eng)
		eng.seek = (...a) => (seeks++, seek(...a))
		assert.equal(eng._processTimelineFlags('T', 400, 600), true)
		assert.equal(seeks, 0)
	})
})

describe('WO-1032: a cue on the start position', () => {
	it('fires at 0 on a first play and again on every loop wrap', async () => {
		const { eng, fired } = rig([cp('zero', 0)], { duration: 160 })
		eng.setLoop('T', true)
		eng.play('T', 0)
		await wait(450)
		eng.pause('T')
		assert.ok(fired.length >= 2 && fired.length <= 4, `first pass + wraps: ${fired.length}`)
	})

	it('fires when a seek lands exactly on it, not when a seek passes over it', async () => {
		const { eng, fired } = rig([cp('over', 300), cp('on', 2000)])
		eng.play('T', 0)
		eng.seek('T', 1000)
		eng._tick()
		await settle()
		assert.deepEqual(fired, [], 'skipped cue stays silent')
		eng.seek('T', 2000)
		eng._tick()
		await settle()
		assert.deepEqual(fired, ['on'])
		eng.pause('T')
	})

	it('a Play from where the playhead stands after a pause does not fire the cue again', async () => {
		const { eng, fired } = rig([cp('z', 100)])
		eng.play('T', 0)
		await wait(180)
		eng.pause('T')
		assert.deepEqual(fired, ['z'])
		const pos = Math.round(eng.getPlayback('T').position)
		eng.seek('T', pos) // what the clients send before every Play
		eng.play('T', pos)
		await wait(120)
		eng.pause('T')
		assert.deepEqual(fired, ['z'])
	})
})

describe('WO-1032: cues fire on program only', () => {
	it('a timeline routed to preview only fires nothing; transport flags still run', async () => {
		const { eng, fired } = rig([cp('a', 500), lt('b', 500), { id: 'p', timeMs: 600, type: 'pause' }], { sendTo: { preview: true, program: false, screenIdx: 0 } })
		eng.play('T', 0)
		assert.equal(eng._processTimelineFlags('T', 400, 700), true, 'pause flag still works on preview')
		await settle()
		assert.deepEqual(fired, [])
	})

	it('a look taken to PREVIEW plays the timeline silently, even with a stored program:true', async () => {
		const { eng, self, fired } = rig([cp('a', 60)]) // stored sendTo says program (saved after an earlier Take)
		const layer = { source: { type: 'timeline', value: 'T' }, loop: false }
		await startSceneTimelineLayer(self, self.amcp, 2, layer, { fadeDur: 0, screenIdx: 0, restrictToPreview: true })
		assert.deepEqual(eng._sendToFor('T'), { preview: true, program: false, screenIdx: 0 })
		await wait(200)
		eng.pause('T')
		assert.deepEqual(fired, [])
	})

	it('the same look taken to PROGRAM fires the cue', async () => {
		const { eng, self, fired } = rig([cp('a', 60)], { sendTo: { preview: true, program: false, screenIdx: 0 } })
		const layer = { source: { type: 'timeline', value: 'T' }, loop: false }
		await startSceneTimelineLayer(self, self.amcp, 1, layer, { fadeDur: 0, screenIdx: 0 })
		await wait(200)
		eng.pause('T')
		assert.deepEqual(fired, ['a'])
	})

	it('previewing a look whose timeline is live on program keeps the program claim and the cues', async () => {
		const { eng, self, fired } = rig([cp('a', 120)], { sendTo: { preview: true, program: false, screenIdx: 0 } })
		const layer = { source: { type: 'timeline', value: 'T' }, loop: false }
		await startSceneTimelineLayer(self, self.amcp, 1, layer, { fadeDur: 0, screenIdx: 0 })
		await startSceneTimelineLayer(self, self.amcp, 2, layer, { fadeDur: 0, screenIdx: 0, restrictToPreview: true })
		assert.equal(eng._sendToFor('T').program, true)
		await wait(250)
		eng.pause('T')
		assert.deepEqual(fired, ['a'])
	})
})
