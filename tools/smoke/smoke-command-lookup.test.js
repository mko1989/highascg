'use strict'

/**
 * `command` is a POSIX SHELL BUILTIN — /usr/bin/command does not exist on Debian/Ubuntu.
 *
 * Probing for an executable with execFileSync('/usr/bin/command', ['-v', name]) therefore throws
 * ENOENT for EVERY name, reporting installed tools as missing. This shipped in four modules and
 * broke the operator-GUI helper feature outright: xdotool is installed, was reported missing, and
 * the helper-window lookup returned nothing on every poll ("nothing can be shown over the gui").
 * These tests keep the pattern from coming back.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const { lookupCommandPath, commandExistsSync } = require('../../src/utils/which')

/** Files that used to carry the broken probe. */
const FORMERLY_BROKEN = [
	'src/audio/alsa-mixer-enumerate.js',
	'src/network/tailscale-service.js',
	'src/api/system-hardware-gui.js',
	'src/utils/x-display-session-runtime.js',
]

describe('executable lookup', () => {
	it('resolves a binary that really exists, and rejects one that does not', () => {
		const sh = lookupCommandPath('sh')
		assert.ok(sh && fs.existsSync(sh), 'sh must resolve to a real path')
		assert.equal(lookupCommandPath('highascg-definitely-not-a-real-binary'), null)
		assert.equal(commandExistsSync('sh'), true)
		assert.equal(commandExistsSync(''), false)
	})

	it('/usr/bin/command genuinely does not exist — the premise of this test', () => {
		assert.equal(fs.existsSync('/usr/bin/command'), false, 'if this ever exists, revisit this test')
	})

	it('no source file CALLS /usr/bin/command to probe for an executable', () => {
		/* Match the call form only — several of these files document the old bug in prose, and a
		 * comment explaining why the pattern is wrong must not itself fail the test. */
		const CALL = /execFile(?:Sync)?\(\s*['"]\/usr\/bin\/command['"]/
		const stripComments = (src) =>
			src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
		const offenders = []
		for (const rel of FORMERLY_BROKEN) {
			const src = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'))
			if (CALL.test(src)) offenders.push(rel)
		}
		assert.deepEqual(offenders, [], 'these must use lookupCommandPath() instead')
	})
})
