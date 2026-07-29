'use strict'

/**
 * WO-381 client halves:
 *  1. "(planned)" on host channels now means "the running Caspar has no such channel" (INFO CONFIG
 *     via configComparison.serverChannels) instead of comparing two builds of the same saved
 *     config — a test that defaulted to `true` and could never clear.
 *  2. The compact timers dock is a live controller: the readout sets the time, and timer creation /
 *     screen assignment are gone (they live in the screen-timer Inspector).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('WO-381 planned badge reflects the running Caspar', () => {
	it('claims "planned" only for channels the running Caspar does not have', async () => {
		const { hostChannelPendingApply, liveCasparChannelSet } = await import(
			'../../client/lib/planned-channel-map.js'
		)

		const running = { serverChannels: [{ index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }] }
		assert.deepEqual([...liveCasparChannelSet(running)], [1, 2, 3, 4])

		// Live channels: not planned. A channel beyond what Caspar runs: planned until Apply+restart.
		assert.equal(hostChannelPendingApply(4, running), false)
		assert.equal(hostChannelPendingApply(8, running), true)

		// No evidence (Caspar down / nothing reported) must not label everything "planned" — that
		// was the stuck-forever behaviour the owner hit.
		assert.equal(hostChannelPendingApply(8, null), false)
		assert.equal(hostChannelPendingApply(8, {}), false)
		assert.equal(hostChannelPendingApply(8, { serverChannels: [] }), false)

		// Unusable channel numbers claim nothing.
		assert.equal(hostChannelPendingApply(null, running), false)
		assert.equal(hostChannelPendingApply('?', running), false)
	})

	it('device view reads the badge per channel from configComparison', () => {
		const src = read('client/components/device-view-destinations-ui.js')
		assert.match(src, /hostChannelPendingApply/)
		assert.match(src, /getAppStateStore\(\)\?\.getState\?\.\(\)\?\.configComparison/)
		assert.doesNotMatch(src, /hostChannelsPendingApplyForPayload/)

		const modal = read('client/components/live-input-modal.js')
		assert.match(modal, /hostChannelPendingApply\(entry\?\.channel, stateStore\.getState\(\)\?\.configComparison\)/)
		assert.doesNotMatch(modal, /casparHostChannelsPendingApply/)
	})
})

describe('WO-381 compact timers dock', () => {
	it('parses entered times and maps them onto the timer mode', async () => {
		const { parseTimeText, secondsToClockText, timeConfigPatch } = await import(
			'../../client/components/timer-control-panel-inline-time.js'
		)

		assert.equal(parseTimeText('90'), 90)
		assert.equal(parseTimeText('5:00'), 300)
		assert.equal(parseTimeText('01:30:00'), 5400)
		assert.equal(parseTimeText(' 90:00 '), 5400) // minutes are not clamped to 59
		assert.equal(parseTimeText(''), null)
		assert.equal(parseTimeText('abc'), null)
		assert.equal(parseTimeText('1:2:3:4'), null)

		assert.equal(secondsToClockText(5400), '01:30:00')

		assert.deepEqual(timeConfigPatch({ config: { mode: 'duration' } }, 300), { durationSec: 300 })
		assert.deepEqual(timeConfigPatch({ config: { mode: 'clock' } }, 64800), { targetTime: '18:00:00' })
	})

	it('writes the new time to every screen the timer is on', async () => {
		const { saveTimerConfigPatch } = await import('../../client/components/timer-control-panel-inline-time.js')
		const { api } = await import('../../client/lib/api-client.js')

		const posts = []
		const realPost = api.post
		api.post = async (url, body) => {
			posts.push({ url, body })
			return { ok: true }
		}
		try {
			await saveTimerConfigPatch(
				{ timerId: 't1', config: { mode: 'duration', durationSec: 300, position: 'center' }, screens: { 0: {}, 2: {} } },
				{ durationSec: 90 },
			)
			assert.deepEqual(posts.map((p) => p.body.screenIdx), [0, 2])
			assert.equal(posts[0].url, '/api/timers/assign')
			assert.equal(posts[0].body.config.durationSec, 90)
			assert.equal(posts[0].body.config.position, 'center') // merged, not replaced

			await assert.rejects(
				() => saveTimerConfigPatch({ timerId: 't2', config: {}, screens: {} }, { durationSec: 5 }),
				/not assigned to a screen/,
			)
		} finally {
			api.post = realPost
		}
	})

	it('has no timer creation or screen assignment left in the dock', () => {
		const src = read('client/components/timer-control-panel.js')
		assert.doesNotMatch(src, /new-timer-btn/)
		assert.doesNotMatch(src, /'Add to screen:'/)
		assert.doesNotMatch(src, /timer-control-panel__screen-select/)
		assert.doesNotMatch(src, /createTimerForScreen/)
		assert.doesNotMatch(src, /prompt\(/)
		// still a live controller: transport, visibility chips, and the editable readout
		assert.match(src, /attachInlineTimeEditor\(displayEl, timer/)
		assert.match(src, /\/api\/timers\/cmd/)
		assert.match(src, /\/api\/timers\/visible/)
		// the tick must not overwrite the field while it is being edited
		assert.match(src, /displayEl\.dataset\.editing !== '1'/)

		// creation still exists where it belongs
		assert.match(read('client/components/inspector-screen-timer.js'), /createTimerForScreen/)
	})
})
