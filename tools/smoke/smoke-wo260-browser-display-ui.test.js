'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

/**
 * WO-260: browser_display client UI branch parity. Every client file carrying a `webpage_host`
 * branch must carry the `browser_display` counterpart (the WO-258 backend source type), and the
 * creation payload must match the server's gate (routes-device-view.js accepts
 * `addExtraLiveSource: { mode: 'browser_display', url, ... }`). Grep-level guards in the
 * established style — a missed branch renders browser sources invisible/uncreatable in the UI.
 */

const ROOT = path.join(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// Files whose webpage_host branch must have a browser_display sibling; the live-input modal
// files key source kinds without the _host suffix, so they only assert the new branch exists.
const PARITY_FILES = [
	'client/lib/device-view-host-channels.js',
	'client/lib/planned-channel-map.js',
	'client/components/device-view-ui-utils.js',
	'client/components/sources-panel-live-render.js',
	'client/components/device-view-live-sources-render.js',
	'client/components/device-view-destinations-inspector-host-channel.js',
]
const BRANCH_ONLY_FILES = ['client/components/live-input-modal-shell.js', 'client/components/live-input-modal-submit.js']

test('WO-260: every webpage_host client branch has a browser_display counterpart', () => {
	for (const p of PARITY_FILES) {
		const src = read(p)
		assert.ok(src.includes('webpage_host'), `${p} should contain the webpage_host precedent this parity is based on`)
		assert.ok(src.includes('browser_display'), `${p} is missing its browser_display branch`)
	}
	for (const p of BRANCH_ONLY_FILES) {
		assert.ok(read(p).includes('browser_display'), `${p} is missing its browser_display branch`)
	}
})

test('WO-260: creation payload matches the server addExtraLiveSource gate', () => {
	const submit = read('client/components/live-input-modal-submit.js')
	assert.match(submit, /addExtraLiveSource/, 'creation goes through addExtraLiveSource')
	assert.match(submit, /mode:\s*'browser_display'/, 'payload carries mode browser_display')
	const server = read('src/api/routes-device-view.js')
	assert.match(server, /item\.mode === 'browser_display' && item\.url/, 'server gate accepts url-keyed browser_display items')
})

test('WO-260: inspector wires the interact route with the real body shape', () => {
	const insp = read('client/components/inspector-browser-display.js')
	assert.match(insp, /\/api\/host-live\/browser\/interact/, 'interact endpoint used')
	assert.match(insp, /\/api\/host-live\/browser/, 'update endpoint used')
	const handler = read('src/api/host-live-browser.js')
	for (const action of ['interact', 'return']) {
		assert.ok(handler.includes(`'${action}'`), `server handler supports action '${action}'`)
		assert.ok(insp.includes(action), `inspector references action '${action}'`)
	}
})
