'use strict'

/**
 * WO-447 — screen-consumer vsync defaults OFF (todos06.08.26).
 *
 * With CASPAR_GL_SYNC_DISPLAY pacing frames (WO-407→444), consumer vsync on top adds a
 * competing wait; the owner verified GL sync + vsync off is perfect. An UNSET
 * screen_N_vsync must resolve to false in every place that supplies a default. (WO-716: an explicit
 * true no longer survives either — see smoke-wo716-vsync-off-gpu-texture-every-screen.test.js. WO-995: the keys
 * themselves are gone from every default and save path.)
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** Strip comments so prose about the old default can never satisfy an assertion. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/* WO-995: the screen_N_vsync / multiview_vsync keys are gone. Nothing seeds, reads or writes them any more, so an
 * unset key and an explicit true both fall to the generator's fixed vsync off (next test). */
test('WO-447/995: server-side screen defaults seed no vsync key at all', () => {
	const src = code(read('src/config/defaults-caspar-server.js'))
	assert.match(src, /function casparScreenDefaults\(/, 'casparScreenDefaults still exists')
	assert.doesNotMatch(src, /vsync/, 'no screen_N_vsync / multiview_vsync default')
})

test('WO-447/995: neither client seeds or writes a vsync key', () => {
	const src = code(read('client/lib/screen-consumer-defaults.js'))
	const m = /export const SCREEN_CONSUMER_DEFAULTS = \{([\s\S]*?)\}/.exec(src)
	assert.ok(m, 'SCREEN_CONSUMER_DEFAULTS still exists')
	assert.doesNotMatch(src, /vsync/, 'web defaults / seed / patch helpers carry no vsync')
	assert.doesNotMatch(code(read('client/components/device-view-inspector-gpu.js')), /vsync/i, 'web inspector saves no vsync')
	const seed = read('godot/client/features/devices/cable_seed.gd')
	assert.match(seed, /const SCREEN_DEFAULTS := \{"windowed": true, "borderless": true\}/, 'Godot SCREEN_DEFAULTS without vsync')
	assert.doesNotMatch(seed, /vsync/)
	const model = read('godot/client/features/devices/gpu_output_model.gd')
	assert.doesNotMatch(model, /"vsync"|\.vsync\b/, 'Godot consumer_state / caspar_patch / reset_patch carry no vsync')
})

test('WO-447/716: generator emits <vsync>false</vsync> for an unset key AND for an explicit true', () => {
	const { buildScreenPairChannels } = require('../../src/config/config-generator-consumer-attach-screen.js')
	const routeMap = { programCh: () => 1, previewCh: () => 2, programChannels: [1], previewChannels: [2] }
	const ctx = { n: 1, dims: { width: 1920, height: 1080 }, cumulativeX: 0, nextDevice: 1 }
	const unset = JSON.stringify(buildScreenPairChannels({}, routeMap, ctx))
	assert.match(unset, /vsync>false</, 'unset screen_1_vsync must generate vsync false')
	const explicit = JSON.stringify(buildScreenPairChannels({ screen_1_vsync: true }, routeMap, ctx))
	/* WO-716 (owner 23.10.26) supersedes the WO-447 "explicit true survives" rule: vsync is always off. */
	assert.doesNotMatch(explicit, /vsync>true</, 'an explicit vsync true is ignored (WO-716)')
})
