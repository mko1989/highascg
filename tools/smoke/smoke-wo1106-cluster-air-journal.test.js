'use strict'

/**
 * WO-1106 C28 — cluster-air-journal.js drops a channel-layer once its last entry is cleared (it used to keep every
 * layer ever touched until Caspar restarted).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createAirJournal } = require('../../src/cluster/cluster-air-journal')

describe('WO-1106 C28 air journal drops cleared layers', () => {
	it('PLAY then STOP / CLEAR on many layers leaves nothing kept; the replay is unchanged', () => {
		const j = createAirJournal()
		for (let l = 1; l <= 200; l++) {
			j.record(`PLAY 1-${l} "CLIP${l}"`)
			j.record(l % 2 ? `STOP 1-${l}` : `CLEAR 1-${l}`)
		}
		assert.equal(j.layerCount(), 0)
		assert.equal(j.channelCount(), 0)
		assert.deepEqual(j.replay(), [])
	})

	it('a layer keeps its key while anything is left (mixer after STOP), and loses it on MIXER CLEAR', () => {
		const j = createAirJournal()
		j.record('PLAY 1-10 "A"')
		j.record('MIXER 1-10 OPACITY 0.5')
		j.record('STOP 1-10')
		assert.equal(j.layerCount(), 1)
		assert.deepEqual(j.replay(), ['MIXER 1-10 OPACITY 0.5'], 'the mixer setting is still on air')
		j.record('MIXER 1-10 CLEAR')
		assert.equal(j.layerCount(), 0)
		assert.deepEqual(j.replay(), [])
	})

	it('CG CLEAR, channel CLEAR, channel MIXER CLEAR and bare queries leave no empty keys behind', () => {
		const j = createAirJournal()
		j.record('CG 2-20 ADD 1 "lower" 1')
		j.record('CG 2-20 CLEAR')
		j.record('MIXER 2-30 OPACITY') // a query
		j.record('PLAY 3-1 "A"')
		j.record('PLAY 3-2 "B"')
		j.record('CLEAR 3')
		j.record('MIXER 4-1 VOLUME 0.5')
		j.record('MIXER 4 MASTERVOLUME 0.8')
		j.record('MIXER 4 CLEAR')
		assert.equal(j.layerCount(), 0)
		assert.equal(j.channelCount(), 0)
	})

	it('what is still on air is kept exactly as before', () => {
		const j = createAirJournal()
		j.record('LOADBG 1-10 "B"')
		j.record('PLAY 1-10')
		j.record('PLAY 1-11 "C"')
		j.record('STOP 1-11')
		j.record('MIXER 1 MASTERVOLUME 0.5')
		assert.deepEqual(j.replay(), ['MIXER 1 MASTERVOLUME 0.5', 'LOADBG 1-10 "B"', 'PLAY 1-10'])
		assert.equal(j.layerCount(), 1)
	})
})
