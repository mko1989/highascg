'use strict'

/**
 * Offline smoke — WO-393: zero stream/record outputs must be possible (2026-07-30).
 *
 * Removing the LAST stream/record output used to be undone by empty-array re-seeding:
 * settings GET and the device-graph suggester treated `[]` like a missing key and
 * resurrected a phantom `str_1`/`rec_1`. "Key absent" (legacy/fresh config → seed one
 * default) stays; "empty array" (operator removed all outputs) must survive round-trips.
 *
 * Pure logic + source-text guards: no server, no network.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { suggestConnectorsAndDevicesFromLive } = require('../../src/config/device-graph-suggest')

const LIVE = { screens: [], decklinkInputs: [], v4l2Inputs: [] }

describe('device-graph suggester honours empty output arrays (WO-393)', () => {
	it('suggests NO stream/record connectors when the arrays are empty', () => {
		const { connectors } = suggestConnectorsAndDevicesFromLive(LIVE, {
			streamOutputs: [],
			recordOutputs: [],
			audioOutputs: [],
		})
		assert.deepEqual(connectors.filter((c) => c.kind === 'stream_out'), [])
		assert.deepEqual(connectors.filter((c) => c.kind === 'record_out'), [])
	})

	/* WO-473/474 retire WO-393's "key absent → seed one default" entirely. A fresh box ships every
	 * output array empty and must open a CLEAN device view: no phantom str_1 or rec_1 band before
	 * the operator adds one. "Absent" and "empty" now mean the same thing — none. */
	it('seeds nothing when the keys are absent (fresh/legacy config)', () => {
		const { connectors } = suggestConnectorsAndDevicesFromLive(LIVE, {})
		assert.equal(connectors.filter((c) => c.kind === 'stream_out').length, 0)
		assert.equal(connectors.filter((c) => c.kind === 'record_out').length, 0)
		assert.equal(connectors.filter((c) => c.kind === 'v4l2_out').length, 0)
	})
})

describe('settings GET does not resurrect phantom outputs (WO-393)', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/api/settings-get.js'), 'utf8')

	it('stream/record output arrays are passed through without a length re-seed', () => {
		assert.match(src, /streamOutputs: \(Array\.isArray\(cfg\.streamOutputs\) \? cfg\.streamOutputs : \[\]\)/)
		/* WO-473: the record fallback is now `[]`, not a literal rec_1 — see the note above. */
		assert.match(src, /recordOutputs: Array\.isArray\(cfg\.recordOutputs\) \? cfg\.recordOutputs : \[\]/)
		assert.doesNotMatch(
			src,
			/(streamOutputs|recordOutputs)\.length \?/,
			'a length-conditional re-seed makes 0 outputs impossible (WO-393 regression)'
		)
	})
})
