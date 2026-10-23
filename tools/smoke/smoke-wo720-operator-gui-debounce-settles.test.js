'use strict'

/**
 * WO-720 (found by the WO-719 GUI e2e run) — applyOperatorGuiLayout debounces per channel: a second
 * report inside the window cleared the first one's timer and the first caller's promise NEVER
 * settled. POST /api/operator-gui/layout then never answered; the Godot client's threaded
 * HTTPRequest sat in recv() forever (a leaked Api pool slot) and quitting joined that thread — hang.
 * Media preview's open path reports twice back to back, so this hit on every preview open.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const defaults = require('../../src/config/defaults')
const {
	applyOperatorGuiLayout,
	clearOperatorGuiLayout,
	resetOperatorGuiStateForTests,
} = require('../../src/system/operator-gui-channel')

function ctx() {
	const config = JSON.parse(JSON.stringify(defaults))
	config.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv' },
			{ id: 'og1', mainScreenIndex: 5, mode: 'operator_gui' },
		],
	}
	const store = new Map()
	const noop = async () => {}
	return {
		config,
		amcp: { play: noop, mixerFill: noop, stop: noop, mixerClear: noop, mixerCommit: noop },
		log: () => {},
		persistence: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
	}
}

const cell = (x) => [{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x, y: 0, w: 0.5, h: 0.5 } }]

/** Rejects instead of hanging the test runner when a promise never settles. */
function within(p, ms = 3000) {
	return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('never settled')), ms).unref())])
}

test('a report superseded inside the debounce window still settles, with the newer outcome', async () => {
	resetOperatorGuiStateForTests()
	const c = ctx()
	const first = applyOperatorGuiLayout(c, cell(0))
	const second = applyOperatorGuiLayout(c, cell(0.5))
	const [a, b] = await within(Promise.all([first, second]))
	assert.notEqual(b.skipped, true, JSON.stringify(b))
	assert.deepEqual(a, b, 'the superseded caller gets the apply that actually ran')
})

test('a clear that cancels a pending report settles that report too', async () => {
	resetOperatorGuiStateForTests()
	const c = ctx()
	const pending = applyOperatorGuiLayout(c, cell(0))
	const cleared = clearOperatorGuiLayout(c)
	const [a, b] = await within(Promise.all([pending, cleared]))
	assert.deepEqual(a, b)
})
