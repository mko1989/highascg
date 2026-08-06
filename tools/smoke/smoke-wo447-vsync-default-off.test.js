'use strict'

/**
 * WO-447 — screen-consumer vsync defaults OFF (todos06.08.26).
 *
 * With CASPAR_GL_SYNC_DISPLAY pacing frames (WO-407→444), consumer vsync on top adds a
 * competing wait; the owner verified GL sync + vsync off is perfect. An UNSET
 * screen_N_vsync must resolve to false in every place that supplies a default, while an
 * explicit true (owner override) must survive untouched.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** Strip comments so prose about the old default can never satisfy an assertion. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

test('WO-447: server-side screen defaults seed vsync false', () => {
	const src = code(read('src/config/defaults-caspar-server.js'))
	assert.match(src, /\[`\$\{p\}vsync`\]: false/, 'casparScreenDefaults must seed vsync off')
})

test('WO-447: client SCREEN_CONSUMER_DEFAULTS has vsync false', () => {
	const src = code(read('client/lib/screen-consumer-defaults.js'))
	const m = /export const SCREEN_CONSUMER_DEFAULTS = \{([\s\S]*?)\}/.exec(src)
	assert.ok(m, 'SCREEN_CONSUMER_DEFAULTS still exists')
	assert.match(m[1], /vsync: false/, 'unset keys must render as vsync off in the client')
})

test('WO-447: generator emits <vsync>false</vsync> for an unset key, keeps explicit true', () => {
	const { buildScreenPairChannels } = require('../../src/config/config-generator-consumer-attach-screen.js')
	const routeMap = { programCh: () => 1, previewCh: () => 2, programChannels: [1], previewChannels: [2] }
	const ctx = { n: 1, dims: { width: 1920, height: 1080 }, cumulativeX: 0, nextDevice: 1 }
	const unset = JSON.stringify(buildScreenPairChannels({}, routeMap, ctx))
	assert.match(unset, /vsync>false</, 'unset screen_1_vsync must generate vsync false')
	const explicit = JSON.stringify(buildScreenPairChannels({ screen_1_vsync: true }, routeMap, ctx))
	assert.match(explicit, /vsync>true</, 'an explicit vsync true must be respected')
})
