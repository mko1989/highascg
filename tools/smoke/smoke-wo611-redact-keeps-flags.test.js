'use strict'

/**
 * WO-611 #6 (found porting Settings → Nuclear to Godot, 2026-10-20): GET /api/settings redacted every key matching
 * /password|auth|tailscale…/ — including the boolean `ui.nuclearRequirePassword`. Clients read '[REDACTED]' as "off";
 * the web Settings hydrated its checkbox unchecked and the next save posted `nuclearRequirePassword: false`.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { redactObject } = require('../../src/support/redact-settings')

test('booleans under sensitive keys stay readable; secrets stay redacted', () => {
	const out = redactObject({
		ui: { nuclearRequirePassword: true, nuclearPassword: 'x', nuclearPasswordHash: 'scrypt$a$b' },
		tailscale: { enabled: false, authKey: 'tskey-1' },
	})
	assert.equal(out.ui.nuclearRequirePassword, true)
	assert.equal(out.ui.nuclearPassword, '[REDACTED]')
	assert.equal(out.ui.nuclearPasswordHash, '[REDACTED]')
	assert.equal(out.tailscale, '[REDACTED]', 'a whole sensitive object is still redacted')
})

test('settings GET sends its whole payload through redactObject (source)', () => {
	const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/api/settings-get.js'), 'utf8')
	assert.match(src, /jsonBody\(redactObject\(payload\)\)/)
})
