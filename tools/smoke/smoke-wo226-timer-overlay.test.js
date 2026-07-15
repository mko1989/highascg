/**
 * Smoke tests for WO-226 (timer as per-screen overlay UX).
 *
 * T226.1 — fadeFrames on /api/timers/visible (engine line shape + band guard + route validation).
 * T226.2-T226.5 — source-greps confirming the drop-to-assign path, the per-screen icon wiring,
 *                 the timer inspector modal, and the compact transport cluster exist and are
 *                 wired the way the WO describes (these are DOM/browser features with no
 *                 offline harness, so this smoke checks the source shape, not runtime behavior).
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

// ---- T226.1: engine + route fadeFrames -----------------------------------------------------

const persistence = {
	_storage: {},
	get(key) {
		return this._storage[key] !== undefined ? this._storage[key] : null
	},
	set(key, value) {
		if (value == null) delete this._storage[key]
		else this._storage[key] = value
	},
	clear() {
		this._storage = {}
	},
}

const Module = require('module')
const originalRequire = Module.prototype.require
Module.prototype.require = function (id) {
	if (id === '../utils/persistence') return persistence
	return originalRequire.apply(this, arguments)
}

let screenTimers = require('../../src/engine/screen-timers')
let routesScreenTimers = require('../../src/api/routes-screen-timers')

// Mirrors smoke-wo210-screen-timers.test.js's resetScreenTimersModule: reassigns (not just
// reloads) both modules so each test gets a registry that isn't aliased to a previous test's
// in-memory records — _persistRegistry() stores record references as-is (no deep clone), so
// `persistence.get(...)` can return the very same object living in a stale module's registry.
function resetScreenTimersModule() {
	persistence.clear()
	delete require.cache[require.resolve('../../src/engine/screen-timers')]
	delete require.cache[require.resolve('../../src/api/routes-screen-timers')]
	screenTimers = require('../../src/engine/screen-timers')
	routesScreenTimers = require('../../src/api/routes-screen-timers')
	screenTimers.loadRegistry()
}

test('T226.1: engine setTimerVisible fadeFrames>0 emits fade form, 0/omitted stays instant-cut', () => {
	resetScreenTimersModule()
	screenTimers.assignTimerToScreen({ timerId: 't1', name: 'T1', config: {}, screenIdx: 0, channel: 1 })

	const fade = screenTimers.setTimerVisible({ timerId: 't1', screenIdx: 0, visible: true, fadeFrames: 25 })
	assert.strictEqual(fade.lines[0], 'MIXER 1-980 OPACITY 1 25 linear')

	const instant = screenTimers.setTimerVisible({ timerId: 't1', screenIdx: 0, visible: false })
	assert.strictEqual(instant.lines[0], 'MIXER 1-980 OPACITY 0')
})

test('T226.1: band guard suppresses lines even with fadeFrames set', () => {
	resetScreenTimersModule()
	screenTimers.assignTimerToScreen({ timerId: 't1', name: 'T1', config: {}, screenIdx: 0, channel: 1 })
	const stored = persistence.get('screenTimers')
	stored.t1.screens['0'].layer = 42 // corrupt: outside 980-989
	persistence.set('screenTimers', stored)
	delete require.cache[require.resolve('../../src/engine/screen-timers')]
	const st2 = require('../../src/engine/screen-timers')
	const result = st2.setTimerVisible({ timerId: 't1', screenIdx: 0, visible: true, fadeFrames: 25 })
	assert.strictEqual(result.lines.length, 0, 'band guard applies regardless of fadeFrames')
})

test('T226.1: route handleVisible via handlePost rejects out-of-range/non-integer fadeFrames', async () => {
	resetScreenTimersModule()
	screenTimers.assignTimerToScreen({ timerId: 't1', name: 'T1', config: {}, screenIdx: 0, channel: 1 })

	const sentLines = []
	const ctx = {
		amcp: { raw: (line) => { sentLines.push(line); return Promise.resolve() } },
		log: () => {},
	}

	const okRes = await routesScreenTimers.handlePost('/api/timers/visible', { timerId: 't1', screenIdx: 0, visible: true, fadeFrames: 25 }, ctx)
	assert.strictEqual(okRes.status, 200)
	const okBody = JSON.parse(okRes.body)
	assert.strictEqual(okBody.ok, true)
	assert.strictEqual(okBody.fadeFrames, 25)
	assert(sentLines.some((l) => l === 'MIXER 1-980 OPACITY 1 25 linear'), 'should send fade-form MIXER line')

	const tooBig = await routesScreenTimers.handlePost('/api/timers/visible', { timerId: 't1', screenIdx: 0, visible: true, fadeFrames: 501 }, ctx)
	assert.strictEqual(tooBig.status, 400)
	assert.strictEqual(JSON.parse(tooBig.body).ok, false)

	const negative = await routesScreenTimers.handlePost('/api/timers/visible', { timerId: 't1', screenIdx: 0, visible: true, fadeFrames: -1 }, ctx)
	assert.strictEqual(negative.status, 400)

	const nonInt = await routesScreenTimers.handlePost('/api/timers/visible', { timerId: 't1', screenIdx: 0, visible: true, fadeFrames: 2.5 }, ctx)
	assert.strictEqual(nonInt.status, 400)

	const omitted = await routesScreenTimers.handlePost('/api/timers/visible', { timerId: 't1', screenIdx: 0, visible: false }, ctx)
	assert.strictEqual(omitted.status, 200)
	assert.strictEqual(JSON.parse(omitted.body).fadeFrames, 0)
})

// ---- T226.2-T226.5: source-shape checks (no browser harness offline) ------------------------

function read(relPath) {
	return fs.readFileSync(path.join(__dirname, '../..', relPath), 'utf-8')
}

test('T226.2: deck-drop handler routes countdown/timerId payloads to /api/timers/assign, not a look', () => {
	const src = read('client/components/scenes-editor-deck-drop.js')
	assert(src.includes('isTimerDropPayload'), 'should gate timer-shaped payloads')
	assert(src.includes("includes('countdown')"), 'should identify countdown template drops by value')
	assert(src.includes('data.timerId'), 'should also route payloads that already carry a timerId')
	assert(src.includes("/api/timers/assign"), 'should POST to the assign endpoint')
	assert(src.includes("screen-timers-changed"), 'should dispatch the lightweight refresh event on success')
	assert(src.includes('⏱ Timer assigned to'), 'should toast confirmation using the ⏱ glyph')
})

test('T226.3: scene-list-column renders a per-screen timer icon next to FTB, listens for refresh', () => {
	const src = read('client/components/scene-list-column.js')
	assert(src.includes("scenes-btn--timer"), 'should render the timer icon button')
	assert(src.includes('scenes-deck-col__timer-btn'), 'icon should be queryable for cache refresh')
	assert(src.includes("addEventListener('screen-timers-changed'"), 'should listen for the lightweight refresh event')
	assert(src.includes('/api/timers/list'), 'should source assignment/visibility state from the list endpoint')
	assert(src.includes('showTimerInspectorModal'), 'click should open the T226.4 inspector')
	assert(src.includes('scenes-btn--timer-on'), 'on-air state should get a distinct (accent) class')
})

test('T226.4: timer inspector modal reuses buildTimerSettings and wires Fade In/Out to fadeFrames', () => {
	const src = read('client/components/timer-inspector-modal.js')
	assert(src.includes("import { buildTimerSettings } from './timer-control-panel-settings-form.js'"), 'must reuse, not duplicate, the settings form')
	assert(src.includes("modal-overlay"), 'should use the existing lightweight modal shell')
	assert(src.includes("data-fade=\"in\"") || src.includes("data-fade='in'"), 'should have a Fade In control')
	assert(src.includes("data-fade=\"out\"") || src.includes("data-fade='out'"), 'should have a Fade Out control')
	assert(src.includes('/api/timers/visible'), 'fade buttons should post to the visible endpoint')
	assert(src.includes('fadeFrames'), 'fade buttons should pass fadeFrames')

	const formSrc = read('client/components/timer-control-panel-settings-form.js')
	assert(formSrc.includes('timerFontSize'), 'settings form should expose the Size (timerFontSize) field')
	assert(formSrc.includes("config.position || 'center'"), 'settings form already carries the Position field (reused as-is)')
})

test('T226.5: audio-mixer-panel mounts a compact per-active-screen timer transport cluster', () => {
	const src = read('client/components/audio-mixer-panel.js')
	assert(src.includes('audio-mixer__timers-compact'), 'should mount the compact cluster in the root render')
	assert(src.includes('sceneState.activeScreenIndex'), 'cluster should scope to the ACTIVE screen')
	assert(src.includes('/api/timers/cmd'), 'transport buttons should post cmd')
	assert(src.includes('/api/timers/visible'), 'eye toggle should post visible')
	assert(src.includes("screen-timers-changed"), 'successful posts should dispatch the refresh event')
})

test('CSS: WO-226 classes exist in their stylesheets', () => {
	const scenesCss = read('client/styles/06a3-scenes-deck-multi.css')
	assert(scenesCss.includes('.scenes-btn--timer'), 'icon base class')
	assert(scenesCss.includes('.scenes-btn--timer-on'), 'icon on-air class')

	const modalsCss = read('client/styles/08c-modals-misc.css')
	assert(modalsCss.includes('.timer-inspector-modal'), 'inspector modal layout class')
	assert(modalsCss.includes('.timer-inspector-modal__fade-row'), 'fade button row class')

	const audioCss = read('client/styles/07b-audio-mixer-modal-shell.css')
	assert(audioCss.includes('.audio-mixer__timers-compact'), 'compact transport cluster class')
	assert(audioCss.includes('.audio-mixer__timer-compact-btn'), 'compact transport button class')
})
