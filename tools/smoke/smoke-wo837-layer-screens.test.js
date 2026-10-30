'use strict'

/**
 * WO-837 phase 1 — (1) per-layer screens: a layer with `screenIdx` is sent only to that screen's routed channels,
 * a layer without it behaves as before (every routed channel); wrap / end hold (WO-834) / stop / on-air edit stay
 * correct per screen. (2) `light` control flags call the lighting console service once per crossing, off-tick, and
 * are dropped when another timeline is on air. Mock AMCP like smoke-wo829; the box is a 2-screen rig (PGM ch1/ch3).
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')

const { TimelineEngine } = require('../../src/engine/timeline-engine')

const engines = []
after(() => {
	for (const eng of engines) for (const tl of eng.getAll()) eng.stop(tl.id)
})

function makeEngine(config = { screen_count: 2 }, extra = {}) {
	const sent = []
	const rec =
		(n) =>
		(...a) => {
			sent.push(`${n} ${a.join('-')}`)
			return Promise.resolve()
		}
	const amcp = {
		raw: (c) => {
			sent.push(c)
			return Promise.resolve()
		},
		stop: rec('STOP'),
		pause: rec('PAUSE'),
		resume: rec('RESUME'),
		call: rec('CALL'),
		mixerFill: rec('FILL'),
		mixerOpacity: rec('OPACITY'),
		mixerVolume: rec('VOLUME'),
		mixerCommit: rec('COMMIT'),
		batchSendChunked: (lines) => {
			sent.push(...lines)
			return Promise.resolve()
		},
	}
	const logs = []
	const self = {
		amcp,
		config,
		log: (lvl, m) => logs.push(`${lvl} ${m}`),
		variables: { channel_1_framerate: '50', channel_2_framerate: '50', channel_3_framerate: '50', channel_4_framerate: '50' },
		...extra,
	}
	const eng = new TimelineEngine(self)
	engines.push(eng)
	return { eng, sent, logs, self }
}

const clip = (id, startTime, duration) => ({ id, startTime, duration, source: { type: 'media', value: id } })
const transport = (sent) => sent.filter((l) => /^(STOP|PLAY|PAUSE)\b/.test(l))
const allScreens = { preview: false, program: true, screenIdx: null }

describe('WO-837 per-layer screens', () => {
	it('layer A (screen 0) only on ch1, layer B (screen 1) only on ch3, layer C (no screenIdx) on both', () => {
		const { eng, sent } = makeEngine()
		eng.create({
			id: 'T',
			duration: 30000,
			sendTo: allScreens,
			screens: [0, 1],
			layers: [
				{ id: 'a', screenIdx: 0, clips: [clip('A', 0, 30000)] },
				{ id: 'b', screenIdx: 1, clips: [clip('B', 0, 30000)] },
				{ id: 'c', clips: [clip('C', 0, 30000)] },
			],
		})
		assert.deepEqual(eng.get('T').screens, [0, 1], 'the screen sections survive create')
		eng.play('T', 1000)
		const plays = sent.filter((l) => l.startsWith('PLAY')).map((l) => l.split(' ').slice(0, 2).join(' '))
		assert.deepEqual([...plays].sort(), ['PLAY 1-210', 'PLAY 1-212', 'PLAY 3-211', 'PLAY 3-212'])
		// mixer lines follow the same filter: nothing addressed to a channel the layer is not on
		const touched = sent.map((l) => /\b([1-4])-(21[0-2])\b/.exec(l)).filter(Boolean).map((m) => `${m[1]}-${m[2]}`)
		for (const k of new Set(touched)) assert.ok(['1-210', '3-211', '1-212', '3-212'].includes(k), `unexpected ${k}`)
	})

	it('without any screenIdx a 2-screen timeline plays every layer on both screens, exactly as before', () => {
		const { eng, sent } = makeEngine()
		eng.create({
			id: 'T',
			duration: 30000,
			sendTo: allScreens,
			layers: [
				{ id: 'a', clips: [clip('A', 0, 30000)] },
				{ id: 'b', clips: [clip('B', 0, 30000)] },
			],
		})
		eng.play('T', 1000)
		const plays = sent.filter((l) => l.startsWith('PLAY')).map((l) => l.split(' ').slice(0, 2).join(' '))
		assert.deepEqual([...plays].sort(), ['PLAY 1-210', 'PLAY 1-211', 'PLAY 3-210', 'PLAY 3-211'])
	})

	it('_layerChannels: filters by screen, passes through without screenIdx, nothing for a missing screen', () => {
		const { eng } = makeEngine()
		eng.create({
			id: 'T',
			sendTo: { preview: true, program: true, screenIdx: null },
			layers: [{ id: 'a', screenIdx: 1 }, { id: 'b' }, { id: 'c', screenIdx: 7 }, { id: 'd', screenIdx: 0 }],
		})
		eng._airTimelineId = 'T'
		const ch = eng._channels()
		assert.deepEqual([...ch].sort(), [1, 2, 3, 4])
		assert.deepEqual(eng._layerChannels(0, ch).sort(), [3, 4])
		assert.deepEqual(eng._layerChannels(1, ch), ch)
		assert.deepEqual(eng._layerChannels(2, ch), [])
		assert.deepEqual(eng._layerChannels(3, ch).sort(), [1, 2])
		// a layer pinned to a screen the timeline is not routed to plays nowhere
		assert.deepEqual(eng._layerChannels(0, [1, 2]), [])
		eng._airTimelineId = null
	})

	it('loop wrap STOPs only on the layer own screen; screen-0 layer is never touched on ch3', () => {
		const { eng, sent } = makeEngine()
		eng.create({
			id: 'T',
			duration: 30000,
			sendTo: allScreens,
			layers: [
				{ id: 'a', screenIdx: 0, clips: [clip('A', 0, 30000)] },
				{ id: 'b', screenIdx: 1, clips: [clip('B', 20000, 10000)] },
				{ id: 'c', clips: [clip('C', 20000, 10000)] },
			],
		})
		eng.play('T', 25000)
		sent.length = 0
		eng.play('T', 0, { seamless: true })
		const t = transport(sent)
		assert.ok(t.includes('STOP 3-211'), `B ended on ch3: ${t.join(' | ')}`)
		assert.ok(t.includes('STOP 1-212') && t.includes('STOP 3-212'), `C ended on both: ${t.join(' | ')}`)
		assert.ok(!t.some((l) => /^STOP \d+-210/.test(l)), `running A is not stopped: ${t.join(' | ')}`)
		assert.ok(!t.includes('STOP 1-211'), `B was never on ch1: ${t.join(' | ')}`)
		assert.ok(t.some((l) => l.startsWith('PLAY 1-210 "A"')), t.join(' | '))
		assert.ok(!t.some((l) => l.startsWith('PLAY 3-210')), `A never goes to ch3: ${t.join(' | ')}`)
	})

	it('end hold (WO-834) PAUSEs each layer only on its own screen', () => {
		const { eng, sent } = makeEngine()
		eng.create({
			id: 'T',
			duration: 10000,
			fps: 25,
			sendTo: allScreens,
			layers: [
				{ id: 'a', screenIdx: 0, clips: [clip('A', 0, 10000)] },
				{ id: 'b', screenIdx: 1, clips: [clip('B', 0, 10000)] },
			],
		})
		eng.play('T', 8000)
		const cell = eng._pbFor('T')
		cell._p0 = 10020
		cell._t0 = Date.now()
		sent.length = 0
		eng._tick()
		const t = transport(sent)
		assert.ok(t.includes('PAUSE 1-210') && t.includes('PAUSE 3-211'), t.join(' | '))
		assert.ok(!t.includes('PAUSE 3-210') && !t.includes('PAUSE 1-211'), `no cross-screen PAUSE: ${t.join(' | ')}`)
		assert.equal(eng._airTimelineId, 'T')
	})

	it('stop STOPs each layer only on its own screen', () => {
		const { eng, sent } = makeEngine()
		eng.create({
			id: 'T',
			duration: 30000,
			sendTo: allScreens,
			layers: [
				{ id: 'a', screenIdx: 0, clips: [clip('A', 0, 30000)] },
				{ id: 'b', screenIdx: 1, clips: [clip('B', 0, 30000)] },
				{ id: 'c', clips: [clip('C', 0, 30000)] },
			],
		})
		eng.play('T', 1000)
		sent.length = 0
		eng.stop('T')
		const t = transport(sent).filter((l) => l.startsWith('STOP'))
		assert.deepEqual([...new Set(t)].sort(), ['STOP 1-210', 'STOP 1-212', 'STOP 3-211', 'STOP 3-212'])
	})

	it('moving an on-air layer to another screen STOPs the old channel and PLAYs the new one', () => {
		const { eng, sent } = makeEngine()
		eng.create({
			id: 'T',
			duration: 30000,
			sendTo: allScreens,
			layers: [{ id: 'a', screenIdx: 0, clips: [clip('A', 0, 30000)] }],
		})
		eng.play('T', 1000)
		sent.length = 0
		const tl = eng.get('T')
		eng.update('T', { ...tl, layers: [{ ...tl.layers[0], screenIdx: 1 }] })
		const t = transport(sent)
		assert.ok(t.includes('STOP 1-210'), `left screen 0: ${t.join(' | ')}`)
		assert.ok(t.some((l) => l.startsWith('PLAY 3-210 "A"')), `arrived on screen 1: ${t.join(' | ')}`)
		assert.equal(eng._prevKey.get('1-210'), undefined)
	})

	it('a one-screen rig: screenIdx 0 is the same as no screenIdx', () => {
		const { eng, sent } = makeEngine({})
		eng.create({
			id: 'T',
			duration: 30000,
			sendTo: { preview: false, program: true, screenIdx: 0 },
			layers: [{ id: 'a', screenIdx: 0, clips: [clip('A', 0, 30000)] }],
		})
		eng.play('T', 1000)
		assert.ok(sent.some((l) => l.startsWith('PLAY 1-210 "A"')))
	})
})

describe('WO-837 light control flags', () => {
	function lightRig(extra = {}) {
		const calls = []
		const broadcasts = []
		const service = { fire: (id, flag) => (calls.push({ id, flag }), extra.fire ? extra.fire(id, flag) : Promise.resolve({ ok: true })) }
		const rig = makeEngine({}, { lightingConsoles: service, _wsBroadcast: (t, p) => broadcasts.push({ t, p }) })
		rig.eng.create({
			id: 'T',
			duration: 10000,
			flags: [
				{ id: 'f1', timeMs: 500, type: 'light', label: 'Cue 5', consoleId: 'mq', action: 'go', list: 1, cue: 5 },
				{ id: 'f2', timeMs: 800, type: 'companion_press', label: 'x' },
			],
			layers: [],
		})
		rig.eng._airTimelineId = 'T'
		return { ...rig, calls, broadcasts }
	}
	const tick = () => new Promise((r) => setImmediate(() => setImmediate(r)))

	it('crossing a light flag calls the console service once, off-tick, with the flag', async () => {
		const { eng, calls } = lightRig()
		assert.equal(eng._processTimelineFlags('T', 400, 600), false, 'does not stop the tick')
		assert.equal(calls.length, 0, 'not fired inside the tick')
		await tick()
		assert.equal(calls.length, 1)
		assert.equal(calls[0].id, 'mq')
		assert.equal(calls[0].flag.action, 'go')
		assert.equal(calls[0].flag.cue, 5)
		eng._processTimelineFlags('T', 600, 700) // not crossed again
		await tick()
		assert.equal(calls.length, 1)
		eng._airTimelineId = null
	})

	it('dropped with a warning when a different timeline is on air', async () => {
		const { eng, calls, logs } = lightRig()
		eng._processTimelineFlags('T', 400, 600)
		eng._airTimelineId = 'other'
		await tick()
		assert.equal(calls.length, 0)
		assert.ok(logs.some((l) => l.startsWith('warn') && /light flag "Cue 5".*dropped/.test(l)), logs.join(' | '))
		eng._airTimelineId = null
	})

	it('a console error is logged and broadcast as lighting.error, never thrown into playback', async () => {
		const { eng, calls, logs, broadcasts } = lightRig({ fire: () => Promise.reject(new Error('no route to host')) })
		assert.doesNotThrow(() => eng._processTimelineFlags('T', 400, 600))
		await tick()
		assert.equal(calls.length, 1)
		assert.ok(logs.some((l) => l.startsWith('warn') && /no route to host/.test(l)), logs.join(' | '))
		assert.equal(broadcasts.length, 1)
		assert.equal(broadcasts[0].t, 'lighting.error')
		assert.deepEqual(broadcasts[0].p, { timelineId: 'T', flagId: 'f1', label: 'Cue 5', consoleId: 'mq', error: 'no route to host' })
		eng._airTimelineId = null
	})

	it('a synchronous throw from the service is also contained', async () => {
		const { eng, broadcasts } = lightRig({
			fire: () => {
				throw new Error('boom')
			},
		})
		assert.doesNotThrow(() => eng._processTimelineFlags('T', 400, 600))
		await tick()
		assert.equal(broadcasts[0]?.p.error, 'boom')
		eng._airTimelineId = null
	})
})
