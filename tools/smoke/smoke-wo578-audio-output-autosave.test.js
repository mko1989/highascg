'use strict'

/**
 * WO-578 — audio output device dropdown reverted after "Save audio settings": the save handler
 * itself was correct, but the `await load()` that followed it had no `forceRefresh`, so it hit
 * Device View's 5s payload cache (WO-490's bug class) and re-rendered the pre-save state. Fixed
 * by passing `forceRefresh: true`, and separately converted the whole panel to auto-save on
 * `change` (owner: "just like most settings are auto saved") instead of requiring the button.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

test('WO-578: save() reloads with forceRefresh so it never re-renders the pre-save state', () => {
	const src = read('client/components/device-view-inspector-audio.js')
	assert.match(src, /await load\(\{ forceRefresh: true \}\)/, 'save must force a real fetch, not answer from the 5s payload cache')
	assert.doesNotMatch(src, /await load\(\)\s*\n\s*\}/, 'no bare load() left after a mutation in this file')
})

test('WO-578: there is no more manual "Save audio settings" button — every field auto-saves', () => {
	const src = read('client/components/device-view-inspector-audio.js')
	assert.doesNotMatch(src, /Save audio settings/, 'manual save button removed')
	for (const el of ['typeSel', 'deviceSel', 'manualDevIn', 'monitorChk', 'hostApiSel', 'bufferIn', 'latencyIn', 'fifoIn', 'layoutSel', 'nameIn']) {
		const re = new RegExp(`${el}\\.addEventListener\\('change', \\(\\) *(?:=>|\\{)[\\s\\S]{0,240}?save\\(\\)`)
		assert.match(src, re, `${el} must trigger save() on change`)
	}
})

test('WO-578: save() still writes the exact monitor-role/type fields WO-406 pins', () => {
	const src = read('client/components/device-view-inspector-audio.js')
	assert.match(src, /role: monitorChk\.checked \? 'monitor' : ''/)
	assert.match(src, /type: monitorChk\.checked \? 'system-audio' : typeSel\.value/)
})
