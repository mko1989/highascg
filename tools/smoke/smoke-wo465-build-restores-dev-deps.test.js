'use strict'

/**
 * WO-465 — the build must put the dev dependencies back when it is done.
 *
 * install-iso-defaults.sh runs `npm prune --omit=dev --omit=optional` so the squashfs carries
 * production deps only. That prune outlives the build: afterwards `tools/ci/run-offline-tests.js`
 * dies with `Cannot find module 'acorn'`. It bit three times in one afternoon, including on a
 * build that failed at the audit and never produced an ISO at all.
 *
 * Two things must hold. It has to run AFTER `eggs produce` has cloned the tree, or the restored
 * devDependencies end up inside the ISO. And it has to run as casparcg, because npm as root
 * leaves root-owned node_modules and ~/.npm entries that EACCES the operator's next npm run.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD = 'tools/eggs/live-usb/build-highascg-egg.sh'
const src = fs.readFileSync(path.join(ROOT, BUILD), 'utf8')
const at = (needle) => src.indexOf(needle)

describe('WO-465 build restores dev deps', () => {
	it('the build ends by restoring the dev dependencies it pruned', () => {
		assert.match(src, /npm install --include=optional/)
	})

	it('it runs as casparcg, never as root', () => {
		const line = src.split('\n').find((l) => l.includes('npm install --include=optional') && !l.trimStart().startsWith('#'))
		assert.ok(line, 'restore command must exist outside a comment')
		assert.match(line, /sudo -u "\$\{USER_CASPAR:-casparcg\}"/, 'npm as root poisons node_modules ownership')
	})

	it('it runs after eggs produce, so nothing restored reaches the ISO', () => {
		assert.ok(at('eggs produce --nointeractive') < at('npm install --include=optional'))
	})

	it('the safe-to-copy sidecar is still the last thing written', () => {
		assert.ok(at('npm install --include=optional') < at('Completion sidecar'), 'WO-462: sidecar stays last')
	})

	it('a failed restore warns instead of failing the build', () => {
		const after = src.slice(at('npm install --include=optional'))
		assert.match(after.split('\n').slice(0, 3).join('\n'), /\|\|\s*echo "WARN/, 'the ISO is already built — do not fail on it')
	})
})
