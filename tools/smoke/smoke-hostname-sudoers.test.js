'use strict'

/**
 * The hostname is how an operator tells one box from another, so setting it must not need a
 * password. `sudo -n hostnamectl set-hostname <name>` cannot be allowlisted: the argument differs
 * per box and scripts/setup/12-passwordless-sudo.sh grants exact command paths only (WO-97 — no
 * NOPASSWD wildcards). The installed helper derives the same MAC-based name itself, so granting
 * that single path is both sufficient and wildcard-free.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const HELPER = '/usr/local/lib/highascg/highascg-apply-hardware-hostname.sh'

describe('hardware hostname can be applied without a password', () => {
	it('the sudoers installer grants the helper path', () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/setup/12-passwordless-sudo.sh'), 'utf8')
		assert.ok(src.includes(`NOPASSWD: ${HELPER}`), 'the helper must be in the sudoers allowlist')
	})

	it('the grant carries no wildcard (WO-97)', () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/setup/12-passwordless-sudo.sh'), 'utf8')
		const line = src.split('\n').find((l) => l.includes(HELPER))
		assert.ok(line, 'grant line must exist')
		assert.doesNotMatch(line, /\*/, 'no wildcard may appear in a NOPASSWD grant')
	})

	it('the helper the grant points at is the one the repo ships', () => {
		const repoCopy = path.join(REPO_ROOT, 'tools/runtime/highascg-apply-hardware-hostname.sh')
		assert.ok(fs.existsSync(repoCopy), 'repo must ship the helper that gets installed to the granted path')
		assert.ok(fs.readFileSync(repoCopy, 'utf8').includes('root required'), 'helper must still refuse to run unprivileged')
	})

	it('applySystemHostname falls back to the granted helper', () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, 'src/system/hardware-identity.js'), 'utf8')
		assert.ok(src.includes(HELPER), 'the fallback must invoke exactly the granted path')
		const directIdx = src.indexOf("'hostnamectl', ['set-hostname'")
		const helperIdx = src.indexOf(HELPER)
		assert.ok(directIdx < helperIdx, 'direct hostnamectl (works as root) must be tried before the sudo helper')
	})
})
