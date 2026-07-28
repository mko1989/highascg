'use strict'

/**
 * WO-367 smoke — the gates against "written, reviewed, marked DONE, never called".
 *
 * Three of these shipped on 28.07.26 (`6e53abe`, `9d2f6dd`, `185d200`), all past the offline
 * suite, the 500-line gate, the boot check and ESLint. This pins the three countermeasures:
 * the eslint warning cap, the unwired-export ratchet, and — reproducing `6e53abe` exactly — the
 * rule that an imported `initX` in the client bootstrap must also be CALLED there.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

test('WO-367 — every init* imported by the client bootstrap is called there', () => {
	const app = read('client/app.js')
	const imported = new Set()
	for (const m of app.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
		for (const part of m[1].split(',')) {
			const name = part.trim().split(/\s+as\s+/).pop()?.trim()
			if (name && /^init[A-Z]/.test(name)) imported.add(name)
		}
	}
	assert.ok(imported.size >= 3, `expected the bootstrap to import several init* helpers (got ${imported.size})`)

	const uncalled = [...imported].filter((n) => !new RegExp(`(?<!import\\s*\\{[^}]*)\\b${n}\\s*\\(`).test(app))
	assert.deepEqual(uncalled, [], `imported but never called in client/app.js: ${uncalled.join(', ')}`)
})

test('WO-367 — the exact 6e53abe regression is named, not just pattern-matched', () => {
	const app = read('client/app.js')
	// These were imported with their calls dropped in a batch edit; WO-360's feature shipped dead.
	for (const fn of ['initMediaExistsIndex', 'initLiveInputFailureToasts', 'initMediaDurationIndex']) {
		assert.ok(new RegExp(`${fn}\\(stateStore\\)`).test(app), `${fn}(stateStore) must be called at boot`)
	}
})

test('WO-367 — eslint warnings are capped (the ratchet, not a suggestion)', () => {
	const pkg = JSON.parse(read('package.json'))
	const cap = /--max-warnings\s+(\d+)/.exec(pkg.scripts.lint)
	assert.ok(cap, '`npm run lint` must pass --max-warnings, or CI stays green on new dead code')
	// Recorded starting point: 224 on 28.07.26. This number may go DOWN; a raise is a regression
	// and should be argued for in the WO, not slipped into a batch edit.
	assert.ok(Number(cap[1]) <= 224, `warning cap must not be raised above 224 (found ${cap[1]})`)
})

test('WO-367 — the unwired-export gate runs in CI', () => {
	const ci = read('.github/workflows/ci.yml')
	assert.ok(/node tools\/ci\/check-unwired-exports\.js/.test(ci), 'the gate must be a CI step, not a local habit')
})

test('WO-367 — unwired-export detection actually works', async (t) => {
	const { findOrphans, exportedNames } = require('../ci/check-unwired-exports.js')

	await t.test('parses the export forms this repo uses', () => {
		const names = exportedNames(`
			export function alpha() {}
			export async function beta() {}
			export const GAMMA = 1
			export class Delta {}
			function eps() {}
			export { eps as epsilon }
			module.exports = {
				zeta,
				eta: 1,
			}
			exports.theta = 2
		`)
		for (const n of ['alpha', 'beta', 'GAMMA', 'Delta', 'epsilon', 'zeta', 'eta', 'theta']) {
			assert.ok(names.has(n), `missed export: ${n}`)
		}
	})

	await t.test('flags an export nothing references, and only that one', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wo367-'))
		fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
		fs.mkdirSync(path.join(root, 'app'), { recursive: true })
		fs.writeFileSync(
			path.join(root, 'lib', 'thing.js'),
			'export function usedThing() {}\nexport function orphanThing() {}\n',
		)
		fs.writeFileSync(path.join(root, 'app', 'main.js'), "import { usedThing } from '../lib/thing.js'\nusedThing()\n")

		const { orphans } = findOrphans({ root, exportRoots: ['lib'], referenceRoots: ['lib', 'app'] })
		assert.deepEqual(orphans, ['lib/thing.js: orphanThing'])

		fs.rmSync(root, { recursive: true, force: true })
	})

	await t.test('a namespace member access counts as a reference (no false positive)', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wo367-'))
		fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
		fs.mkdirSync(path.join(root, 'app'), { recursive: true })
		fs.writeFileSync(path.join(root, 'lib', 'actions.js'), 'export function addCable() {}\n')
		fs.writeFileSync(
			path.join(root, 'app', 'main.js'),
			"import * as Actions from '../lib/actions.js'\nActions.addCable()\n",
		)

		const { orphans } = findOrphans({ root, exportRoots: ['lib'], referenceRoots: ['lib', 'app'] })
		assert.deepEqual(orphans, [])

		fs.rmSync(root, { recursive: true, force: true })
	})

	await t.test('the repo baseline exists and is a shrink-only list', () => {
		const base = JSON.parse(read('tools/ci/unwired-exports-baseline.json'))
		assert.ok(Array.isArray(base.entries) && base.entries.length > 0)
		assert.equal(base.count, base.entries.length)
		assert.ok(/SHRINK, never grow/.test(base.note))
	})
})
