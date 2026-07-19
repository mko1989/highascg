/**
 * DeckLink input failure handling (2026-07-19 follow-up).
 *
 * `PLAY <ch>-<l> DECKLINK <dev>` fails with `404 PLAY FAILED` when the source is powered
 * off / not cabled — the old setupInputsChannel counted that as SUCCESS, so the dead input
 * never appeared in `_decklinkInputsStatus.failed`, the GUI had nothing to toast, and no
 * retry ever ran. Now: 404s are real failures with a friendly message, `retrying` is set,
 * and a 20s timer re-attempts until the source comes up.
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')

const src = require('fs').readFileSync(
	require('path').join(__dirname, '../../src/config/routing-setup.js'),
	'utf8',
)

test('404 PLAY FAILED is no longer swallowed as success', () => {
	assert.ok(
		!/already playing\|404\|PLAY FAILED.*playOk\+\+/.test(src),
		'the old success-regex over 404/PLAY FAILED must stay gone',
	)
	assert.match(src, /tryPlayDecklinkInput/, 'classified play helper exists')
	assert.match(
		src,
		/source powered off \/ not cabled, or connector-profile conflict/,
		'404 maps to a human-readable message',
	)
})

test('failed inputs schedule bounded retries and mark retrying', () => {
	assert.match(src, /DECKLINK_INPUT_RETRY_MS = 20000/, '20s retry cadence')
	assert.match(src, /scheduleDecklinkInputRetries\(self\)/, 'retry scheduler wired after setup')
	assert.match(src, /retrying: failed\.length > 0/, 'initial status carries retrying flag')
	assert.match(src, /clearTimeout\(self\._decklinkInputRetryTimer\)/, 're-runs replace the pending timer')
	assert.match(src, /\.unref === 'function'/, 'retry timer does not hold the process open')
})

test('client toast module is wired into app bootstrap', () => {
	const app = require('fs').readFileSync(
		require('path').join(__dirname, '../../client/app.js'),
		'utf8',
	)
	assert.match(app, /initDecklinkInputToasts\(stateStore\)/)
	const toast = require('fs').readFileSync(
		require('path').join(__dirname, '../../client/lib/decklink-input-toast.js'),
		'utf8',
	)
	assert.match(toast, /stateStore\.on\('\*', check\)/, 'listens on the WS full-state feed')
	assert.match(toast, /input is back/, 'recovery toast exists')
})
