'use strict'

/**
 * WO-172 T172.3/T172.8 — restart-dirty flag decision matrix (A172.2).
 *
 * End-state:
 *  - stream_out cabling, attach mode (dedicatedOutputChannel !== true): NOT dirty.
 *  - stream_out cabling, dedicated mode (dedicatedOutputChannel === true): DIRTY.
 *  - record_out cabling: NEVER dirty (no "dedicated channel" concept for record).
 *  - v4l2_out cabling: never dirty.
 *  - everything else (DeckLink/GPU/screen output): dirty (unchanged from WO-81).
 *
 * Also covers the WO-81 regression this WO fixes: `removeStreamOutputConnector` /
 * `removeRecordOutputConnector` (client/components/device-view-cable.js) used to unconditionally
 * `setCasparRestartDirty(true)`, contradicting WO-81 T81.3's own log claiming that was removed.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

describe('WO-172 T172.3: cableSinkAffectsCasparRestart is mode-aware for stream_out', () => {
	it('stream_out cabling in attach mode (default / dedicatedOutputChannel unset) is NOT dirty', async () => {
		const { cableSinkAffectsCasparRestart } = await import('../../client/lib/caspar-restart-dirty-policy.js')
		assert.equal(cableSinkAffectsCasparRestart({ kind: 'stream_out' }), false)
		assert.equal(cableSinkAffectsCasparRestart({ kind: 'stream_out' }, {}), false)
		assert.equal(cableSinkAffectsCasparRestart({ kind: 'stream_out' }, { dedicatedStreamingChannel: false }), false)
	})

	it('stream_out cabling in dedicated-output-channel mode IS dirty', async () => {
		const { cableSinkAffectsCasparRestart } = await import('../../client/lib/caspar-restart-dirty-policy.js')
		assert.equal(cableSinkAffectsCasparRestart({ kind: 'stream_out' }, { dedicatedStreamingChannel: true }), true)
	})

	it('record_out cabling is never dirty, regardless of dedicated-mode flag', async () => {
		const { cableSinkAffectsCasparRestart } = await import('../../client/lib/caspar-restart-dirty-policy.js')
		assert.equal(cableSinkAffectsCasparRestart({ kind: 'record_out' }), false)
		assert.equal(cableSinkAffectsCasparRestart({ kind: 'record_out' }, { dedicatedStreamingChannel: true }), false)
	})

	it('v4l2_out cabling is never dirty', async () => {
		const { cableSinkAffectsCasparRestart } = await import('../../client/lib/caspar-restart-dirty-policy.js')
		assert.equal(cableSinkAffectsCasparRestart({ kind: 'v4l2_out' }, { dedicatedStreamingChannel: true }), false)
	})

	it('DeckLink/GPU/screen output cabling is unchanged (dirty)', async () => {
		const { cableSinkAffectsCasparRestart } = await import('../../client/lib/caspar-restart-dirty-policy.js')
		assert.equal(cableSinkAffectsCasparRestart({ kind: 'decklink_out' }), true)
		assert.equal(cableSinkAffectsCasparRestart({ kind: 'gpu_out' }), true)
		assert.equal(cableSinkAffectsCasparRestart({ kind: 'decklink_io' }), true)
		assert.equal(cableSinkAffectsCasparRestart(null), true)
	})
})

describe('WO-172 T172.3: isStreamingDedicatedOutputChannel', () => {
	it('reads streamingChannel.dedicatedOutputChannel from settings (boolean or string "true")', async () => {
		const { isStreamingDedicatedOutputChannel } = await import('../../client/lib/caspar-restart-dirty-policy.js')
		assert.equal(isStreamingDedicatedOutputChannel(null), false)
		assert.equal(isStreamingDedicatedOutputChannel({}), false)
		assert.equal(isStreamingDedicatedOutputChannel({ streamingChannel: {} }), false)
		assert.equal(isStreamingDedicatedOutputChannel({ streamingChannel: { dedicatedOutputChannel: false } }), false)
		assert.equal(isStreamingDedicatedOutputChannel({ streamingChannel: { dedicatedOutputChannel: true } }), true)
		assert.equal(isStreamingDedicatedOutputChannel({ streamingChannel: { dedicatedOutputChannel: 'true' } }), true)
	})
})

describe('WO-172 T172.3: WO-81 regression fix — device-view-cable.js source text', () => {
	it('removeStreamOutputConnector no longer unconditionally sets the restart-dirty flag', () => {
		const fs = require('fs')
		// WO-172's target functions moved out of device-view-cable.js into device-view-cable-outputs.js
		// during a line-count split; read the pair concatenated so the source-shape assertion still holds.
		const src =
			fs.readFileSync(require('path').join(__dirname, '../../client/components/device-view-cable.js'), 'utf8') +
			fs.readFileSync(require('path').join(__dirname, '../../client/components/device-view-cable-outputs.js'), 'utf8')
		const fnBody = src.slice(src.indexOf('ctx.removeStreamOutputConnector'), src.indexOf('ctx.removeRecordOutputConnector'))
		assert.match(fnBody, /isStreamingDedicatedOutputChannel\(state\.currentSettings\)/)
	})

	it('removeRecordOutputConnector never calls setCasparRestartDirty', () => {
		const fs = require('fs')
		const src =
			fs.readFileSync(require('path').join(__dirname, '../../client/components/device-view-cable.js'), 'utf8') +
			fs.readFileSync(require('path').join(__dirname, '../../client/components/device-view-cable-outputs.js'), 'utf8')
		const start = src.indexOf('ctx.removeRecordOutputConnector')
		const fnBody = src.slice(start, src.indexOf('ctx.removeAudioOutputConnector', start))
		assert.doesNotMatch(fnBody, /setCasparRestartDirty/)
	})
})
