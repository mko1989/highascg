'use strict'

/**
 * WO-319 — the GUI stream status route MUST return a { status, headers, body } envelope with a
 * JSON body, not a bare object. A bare object serialises to an EMPTY body (HTTP 200, no content),
 * which made the client's res.json() throw → availability read as false → the "Live preview" toggle
 * silently never appeared. This test pins the envelope shape so that regression cannot return.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { handleGet } = require('../../src/api/routes-gui-stream')

function assertJsonEnvelope(res) {
	assert.equal(res.status, 200)
	assert.ok(res.headers && /json/i.test(String(res.headers['Content-Type'] || res.headers['content-type'] || '')), 'JSON content-type')
	assert.equal(typeof res.body, 'string', 'body must be a serialised string, not a live object')
	assert.ok(res.body.length > 0, 'body must not be empty — the empty-body bug that hid the toggle')
	return JSON.parse(res.body)
}

test('disabled: envelope with enabled:false and a non-empty JSON body', () => {
	const body = assertJsonEnvelope(handleGet({}))
	assert.equal(body.ok, true)
	assert.equal(body.enabled, false)
})

test('enabled: envelope carries channel + running + watching from the ingest', () => {
	const ctx = {
		_guiStreamIngest: { stats: () => ({ channel: 4, running: true, seq: 42, lastError: null }) },
		_guiStreamRelay: { clientCount: () => 2 },
	}
	const body = assertJsonEnvelope(handleGet(ctx))
	assert.equal(body.enabled, true)
	assert.equal(body.channel, 4)
	assert.equal(body.running, true)
	assert.equal(body.watching, 2)
	assert.equal(body.framesIngested, 42)
})
