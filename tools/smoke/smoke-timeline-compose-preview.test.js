'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { timelineComposeCellShowsTimeline } = require('../../client/lib/timeline-state-model.js')

describe('timeline compose preview routing', () => {
	it('PRV-only sendTo paints timeline on PRV cell only', () => {
		const sendTo = { preview: true, program: false, screenIdx: 0 }
		assert.equal(timelineComposeCellShowsTimeline(sendTo, 'prv'), true)
		assert.equal(timelineComposeCellShowsTimeline(sendTo, 'pgm'), false)
	})

	it('PGM-only sendTo paints timeline on PGM cell only', () => {
		const sendTo = { preview: false, program: true, screenIdx: 0 }
		assert.equal(timelineComposeCellShowsTimeline(sendTo, 'prv'), false)
		assert.equal(timelineComposeCellShowsTimeline(sendTo, 'pgm'), true)
	})

	it('both buses show timeline on both cells', () => {
		const sendTo = { preview: true, program: true, screenIdx: 0 }
		assert.equal(timelineComposeCellShowsTimeline(sendTo, 'prv'), true)
		assert.equal(timelineComposeCellShowsTimeline(sendTo, 'pgm'), true)
	})
})
