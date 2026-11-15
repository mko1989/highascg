'use strict'
/**
 * WO-1088: the keeping-up model — hysteresis (no flapping), the worst offender, incident history + journal lines.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { KeepingUpModel, journalLine, OK, BEHIND, FAILING } = require('../../src/health/keeping-up-model')

const res = (key, level, extra = {}) => ({ key, group: 'source', name: 'Visuals', level, target: 50, measured: 50 - level * 10, unit: 'fps',
	text: `${50 - level * 10} / 50 fps`, label: `Visuals at ${50 - level * 10} of 50 fps`, hint: 'h', severity: level, ...extra })

function clocked() {
	let t = 1000000
	const m = new KeepingUpModel({ now: () => t, maxIncidents: 3 })
	return { m, tick: (results, dt = 1000) => ((t += dt), m.update(results)) }
}

describe('WO-1088 keeping-up model', () => {
	it('one noisy sample never flips a check; two in a row do (default rise 2)', () => {
		const { m, tick } = clocked()
		tick([res('a', OK)])
		tick([res('a', BEHIND)])
		assert.equal(m.summary().level, OK)
		tick([res('a', OK)])
		tick([res('a', BEHIND)])
		assert.equal(m.summary().level, OK, 'the run restarted')
		tick([res('a', BEHIND)])
		assert.equal(m.summary().level, BEHIND)
		assert.equal(m.summary().label, 'Visuals at 40 of 50 fps')
	})
	it('rise 1 (a dropped frame) is immediate; falling takes `fall` calm samples (default 5)', () => {
		const { m, tick } = clocked()
		tick([res('a', BEHIND, { rise: 1 })])
		assert.equal(m.summary().status, 'behind')
		for (let i = 0; i < 4; i++) tick([res('a', OK)])
		assert.equal(m.summary().status, 'behind', 'still held after 4 calm samples')
		tick([res('a', OK)])
		assert.equal(m.summary().status, 'ok')
	})
	it('rises to the lowest level the run held and falls to the highest', () => {
		const { m, tick } = clocked()
		tick([res('a', FAILING)])
		tick([res('a', BEHIND)])
		assert.equal(m.summary().level, BEHIND, 'failing then behind → behind')
		tick([res('a', FAILING)])
		tick([res('a', FAILING)])
		assert.equal(m.summary().level, FAILING)
		for (let i = 0; i < 5; i++) tick([res('a', i === 2 ? BEHIND : OK)])
		assert.equal(m.summary().level, BEHIND, 'a behind sample in the calm run → falls to behind, not ok')
	})
	it('the worst offender: level first, then what the audience sees (output > source > … > box)', () => {
		const { m, tick } = clocked()
		const box = { key: 'gpu', group: 'box', name: 'GPU', level: BEHIND, label: 'GPU saturated (97 %)', text: '97 %', rise: 1 }
		const out = { key: 'out:2:600', group: 'output', name: 'Dioda output', level: BEHIND, label: 'Dioda output dropping frames', text: '50 / 50 fps · 2 dropped', rise: 1 }
		tick([box, out, res('v', OK)])
		assert.equal(m.summary().label, 'Dioda output dropping frames')
		tick([box, out, res('v', FAILING, { rise: 1 })])
		const s = m.summary()
		assert.equal(s.label, 'Visuals at 30 of 50 fps', 'failing beats behind')
		assert.deepEqual(s.checks.map((c) => c.key), ['v', 'out:2:600', 'gpu'], 'offenders first, ok last')
	})
	it('incidents: start + end with duration and the worst value; journal lines; history capped', () => {
		const { m, tick } = clocked()
		let r = tick([res('a', BEHIND, { rise: 1 })])
		assert.equal(r.events[0].type, 'start')
		assert.equal(journalLine(r.events[0]), '[keeping-up] behind: Visuals at 40 of 50 fps (40 / 50 fps)')
		tick([res('a', FAILING, { rise: 1 })])
		for (let i = 0; i < 4; i++) tick([res('a', OK)])
		r = tick([res('a', OK)])
		assert.equal(r.events[0].type, 'end')
		const inc = m.summary().incidents[0]
		assert.equal(inc.status, 'failing', 'worst level kept')
		assert.equal(inc.worst, '30 / 50 fps', 'worst measured value kept')
		assert.equal(inc.durationS, 6)
		assert.equal(journalLine(r.events[0]), '[keeping-up] recovered after 6 s: Visuals at 30 of 50 fps — worst failing, 30 / 50 fps')
		for (const k of ['b', 'c', 'd']) tick([res(k, BEHIND, { rise: 1 })])
		assert.equal(m.summary().incidents.length, 3, 'capped at maxIncidents')
		assert.equal(m.summary().incidents[2].key, 'b', 'newest first; the oldest fell off')
	})
	it('a check that disappears (output stopped, Caspar down) ends its incident as gone and leaves the list', () => {
		const { m, tick } = clocked()
		tick([res('a', BEHIND, { rise: 1 })])
		const r = tick([])
		assert.equal(r.changed, true)
		assert.equal(r.events[0].incident.ended, 'gone')
		assert.match(journalLine(r.events[0]), /^\[keeping-up\] ended \(check gone\) after 1 s: /)
		assert.equal(m.summary().checks.length, 0)
		assert.equal(m.summary().level, OK)
	})
	it('measured values alone do not count as a change (no WS broadcast every second)', () => {
		const { tick } = clocked()
		tick([res('a', OK)])
		assert.equal(tick([res('a', OK, { measured: 49, text: '49 / 50 fps' })]).changed, false)
	})
})
