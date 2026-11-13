'use strict'

/**
 * WO-1060 — LTC out is per timeline: only a timeline marked `ltcOut: true` sends timecode while it is on air; the
 * flag survives the engine's create() whitelist (a server start re-creates timelines from the stored project).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { ltcOutPlayhead } = require('../../src/timecode/ltc-service')
const { targetFramesAt } = require('../../src/timecode/ltc-output')
const { fpsMode } = require('../../src/timecode/timecode-math')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

function eng(timelines, airId, pb = { playing: true, position: 2000 }) {
	return { _airTimelineId: airId, get: (id) => timelines[id] || null, getPlayback: () => pb }
}

describe('WO-1060: LTC out only on chosen timelines', () => {
	it('a chosen timeline on air gives its playhead', () => {
		assert.deepEqual(ltcOutPlayhead(eng({ a: { id: 'a', ltcOut: true } }, 'a')), { playing: true, position: 2000 })
	})
	it('a timeline that was not chosen is silent, playing or not', () => {
		assert.equal(ltcOutPlayhead(eng({ a: { id: 'a' } }, 'a')), null)
		assert.equal(ltcOutPlayhead(eng({ a: { id: 'a', ltcOut: false } }, 'a')), null)
		assert.equal(ltcOutPlayhead(eng({ a: { id: 'a', ltcOut: 'yes' } }, 'a')), null)
	})
	it('the choice is per timeline: the other one being chosen does not count', () => {
		assert.equal(ltcOutPlayhead(eng({ a: { id: 'a' }, b: { id: 'b', ltcOut: true } }, 'a')), null)
	})
	it('nothing on air / no engine: silent', () => {
		assert.equal(ltcOutPlayhead(eng({}, null)), null)
		assert.equal(ltcOutPlayhead(null), null)
	})
	it('a silent playhead keeps the encoder stopped (target = null)', () => {
		const mode = fpsMode('25')
		const cfg = { source: 'timeline', leadMs: 0 }
		assert.equal(targetFramesAt(cfg, mode, 0, ltcOutPlayhead(eng({ a: { id: 'a' } }, 'a')), 1000), null)
		assert.equal(targetFramesAt(cfg, mode, 0, ltcOutPlayhead(eng({ a: { id: 'a', ltcOut: true } }, 'a')), 1000), 50)
	})
	it('the engine keeps the flag through create() and update()', () => {
		const e = new TimelineEngine({ config: {} })
		assert.equal(e.create({ id: 'x', ltcOut: true }).ltcOut, true)
		assert.equal('ltcOut' in e.create({ id: 'y' }), false)
		e.update('y', { ...e.get('y'), ltcOut: true })
		assert.equal(e.get('y').ltcOut, true)
	})
})
