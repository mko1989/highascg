'use strict'

/**
 * WO-860 (owner 30.10, 2nd pass): an overlay look on PGM is taken off once played out (its lower third's hold
 * duration + intro/outro), the deck's stop plays it out (CG STOP, then the clear), `scene.liveOverlay` tells the deck.
 */

const { describe, it, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

process.env.NODE_TEST_CONTEXT = process.env.NODE_TEST_CONTEXT || `wo860b-${process.pid}`

const L = require('../../src/engine/overlay-look-live')

function mockAmcp() {
	const log = []
	return { log, async _send(line) { log.push(line); return {} }, async mixerCommit() {} }
}
function mockSelf() {
	const sent = []
	return { sent, _wsBroadcast: (type, p) => sent.push([type, p]), log: () => {} }
}
const flush = () => new Promise((r) => setImmediate(r))
const lt = (data) => JSON.stringify(data)

describe('WO-860 overlay take-out', () => {
	it('hold seconds: lower-third precedence data step > style > top level > engine default; others hold', () => {
		assert.equal(L.templateHoldSec('lower-thirds/lt-classic-box', lt({ data: { displayDurationSec: '4' }, style: { displayDurationSec: 9 } })), 4)
		assert.equal(L.templateHoldSec('lower-thirds/x', lt({ data: [{ title: 'a' }], style: { displayDurationSec: 7 } })), 7)
		assert.equal(L.templateHoldSec('lower-thirds/x', lt({ displayDurationSec: 3 })), 3)
		assert.equal(L.templateHoldSec('lower-thirds/x', lt({ title: 'a' })), 10, 'lt-engine default')
		assert.equal(L.templateHoldSec('lower-thirds/x', lt({ style: { displayDurationSec: 0 } })), 0)
		assert.equal(L.templateHoldSec('my-template', lt({ displayDurationSec: 5 })), 0, 'no auto-out outside lower thirds')
		assert.equal(L.lookHoldSec([4, 7]), 7, 'the longest lower third')
		assert.equal(L.lookHoldSec([4, 0]), 0, 'one held template holds the look')
		assert.equal(L.lookHoldSec([]), 0)
	})

	it('auto take-out: CLEAR after hold + intro/outro, entry dropped, broadcast', async () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		try {
			const amcp = mockAmcp()
			const self = mockSelf()
			L.markOverlayLive({ amcp, self, channel: 5, sceneId: 'a', hosts: [700], holdSec: 2 })
			assert.deepEqual(L.getAll()['5'], [{ sceneId: 'a', hosts: [700], until: L.getAll()['5'][0].until }])
			assert.equal(self.sent.at(-1)[1].path, 'scene.liveOverlay')
			assert.ok(L.pgmOverlayHosts(5).has(700))
			mock.timers.tick(2000 + L.LT_IN_OUT_MS - 1)
			await flush()
			assert.equal(amcp.log.length, 0, 'not before the outro is over')
			mock.timers.tick(1)
			await flush()
			await flush()
			assert.deepEqual(amcp.log, ['CG 5-700 CLEAR', 'MIXER 5-700 OPACITY 1 0'])
			assert.equal(L.getAll()['5'], undefined)
			assert.equal(L.pgmOverlayHosts(5).size, 0)
			assert.deepEqual(self.sent.at(-1)[1].value, {})
		} finally {
			mock.timers.reset()
		}
	})

	it('hold 0: no timer; a re-take replaces the timer; another overlay on the same host replaces the entry', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		try {
			const amcp = mockAmcp()
			L.markOverlayLive({ amcp, self: null, channel: 6, sceneId: 'h', hosts: [700], holdSec: 0 })
			assert.equal(L.getAll()['6'][0].until, null)
			mock.timers.tick(3_600_000)
			assert.equal(amcp.log.length, 0)
			L.markOverlayLive({ amcp, self: null, channel: 6, sceneId: 'b', hosts: [700], holdSec: 0 })
			assert.deepEqual(L.getAll()['6'].map((e) => e.sceneId), ['b'], 'b took host 700 over')
			L.releasePgmOverlayHosts(6, [700])
			assert.equal(L.getAll()['6'], undefined, 'a normal look declaring 700 replaced it')
		} finally {
			mock.timers.reset()
		}
	})

	it('stop: CG STOP (outro), then CLEAR; ▶ returns as the outro starts', async () => {
		const amcp = mockAmcp()
		const self = mockSelf()
		L.markOverlayLive({ amcp, self, channel: 7, sceneId: 's', hosts: [700, 701], holdSec: 0 })
		const gone = await L.stopOverlayLook({ amcp, self, channel: 7, sceneId: 's', outroMs: 0 })
		assert.deepEqual(gone, ['s'])
		assert.deepEqual(amcp.log, ['CG 7-700 STOP 0', 'CG 7-701 STOP 0', 'CG 7-700 CLEAR', 'MIXER 7-700 OPACITY 1 0', 'CG 7-701 CLEAR', 'MIXER 7-701 OPACITY 1 0'])
		assert.equal(L.getAll()['7'], undefined)
		assert.deepEqual(await L.stopOverlayLook({ amcp, self, channel: 7, sceneId: 's', outroMs: 0 }), [], 'nothing on air: no-op')
	})

	it('POST /api/scene/overlay/stop by mainIdx; get-state carries scene.liveOverlay', async () => {
		const { handleOverlayLookStop } = require('../../src/api/routes-scene-take-overlay')
		const amcp = mockAmcp()
		const ctx = { amcp, config: { screen_count: 1, screen_1_mode: '1920x1080p25' }, _wsBroadcast: () => {}, log: () => {} }
		L.markOverlayLive({ amcp, self: ctx, channel: 1, sceneId: 'r', hosts: [700], holdSec: 0 })
		const res = await handleOverlayLookStop(JSON.stringify({ mainIdx: 0, sceneId: 'r' }), ctx) // raw body, like the router
		assert.equal(res.status, 200, JSON.stringify(res.body))
		assert.deepEqual(JSON.parse(res.body).stopped, ['r'])
		assert.deepEqual(amcp.log, ['CG 1-700 STOP 0'], 'answers once the outro started')
		assert.equal((await handleOverlayLookStop({}, ctx)).status, 400)
		const src = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
		assert.match(src('src/api/routes-scene.js'), /path === '\/api\/scene\/overlay\/stop'/)
		assert.match(src('src/api/get-state.js'), /liveOverlay: require\('\.\.\/engine\/overlay-look-live'\)\.getAll\(\)/)
		assert.match(src('src/engine/overlay-look.js'), /if \(!preview\) live\.markOverlayLive\(/)
	})
})
