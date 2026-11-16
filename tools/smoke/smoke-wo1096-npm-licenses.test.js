'use strict'

/**
 * WO-1096: the npm licence gate (tools/ci/check-npm-licenses.js). Synthetic lockfiles cover each failure class —
 * no licence, "none" (the wetransfert entry WO-1095 found in the ISO), UNLICENSED, "SEE LICENSE IN" — plus SPDX
 * OR/AND evaluation, copyleft "notice required", dev packages ignored, the package.json fallback and the reviewed
 * override. Then the real tree must pass and the CLI must exit 1 on a lockfile carrying the old wetransfert entry.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
	checkLockLicenses,
	evaluateSpdx,
	licenseFromPackageJson,
	licenseCounts,
} = require('../ci/check-npm-licenses')

const REPO = path.join(__dirname, '../..')
const CLI = path.join(REPO, 'tools/ci/check-npm-licenses.js')

/** wetransfert@2.4.0 exactly as package-lock.json carried it before WO-1096 removed it */
const WETRANSFERT_ENTRY = {
	version: '2.4.0',
	resolved: 'https://registry.npmjs.org/wetransfert/-/wetransfert-2.4.0.tgz',
	license: 'none',
}

const lockOf = (packages) => ({ lockfileVersion: 3, packages: { '': { name: 'x' }, ...packages } })
const byName = (res, name) => res.rows.find((r) => r.name === name)

describe('WO-1096 SPDX evaluation', () => {
	it('allows permissive ids and OR-expressions with one allowed side', () => {
		for (const id of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0', 'Unlicense']) {
			assert.equal(evaluateSpdx(id).ok, true, id)
		}
		const dual = evaluateSpdx('(MIT OR GPL-2.0)')
		assert.deepEqual([dual.ok, dual.elected, dual.notice], [true, ['MIT'], []], 'osc/slip elect MIT')
		assert.deepEqual(evaluateSpdx('(MIT OR GPL-3.0-or-later)').elected, ['MIT'], 'jszip elects MIT')
		assert.deepEqual(evaluateSpdx('(MIT AND Zlib)').elected, ['MIT', 'Zlib'], 'pako needs both')
	})
	it('fails what nothing on the allowlist satisfies', () => {
		assert.equal(evaluateSpdx('GPL-2.0').ok, false, 'GPL-2.0-only cannot ship under AGPLv3')
		assert.equal(evaluateSpdx('(MIT AND GPL-2.0)').ok, false, 'AND needs every side')
		assert.equal(evaluateSpdx('CC-BY-NC-4.0').ok, false)
		assert.equal(evaluateSpdx('(MIT OR').ok, false, 'unparseable')
	})
	it('copyleft is allowed but flagged as notice required', () => {
		const lg = evaluateSpdx('LGPL-3.0-or-later')
		assert.deepEqual([lg.ok, lg.notice], [true, ['LGPL-3.0-or-later']])
		assert.deepEqual(evaluateSpdx('MPL-2.0 OR Apache-2.0').notice, [], 'permissive side preferred')
		assert.deepEqual(evaluateSpdx('GPL-2.0+').notice, ['GPL-2.0-or-later'], '"+" means or-later')
		assert.equal(evaluateSpdx('GPL-3.0-or-later WITH Classpath-exception-2.0').ok, true)
	})
})

describe('WO-1096 lockfile classification', () => {
	it('fails missing, none, UNLICENSED and SEE LICENSE IN; ignores dev packages', () => {
		const res = checkLockLicenses(
			lockOf({
				'node_modules/ok': { version: '1.0.0', license: 'MIT' },
				'node_modules/nolicence': { version: '1.0.0' },
				'node_modules/wetransfert': WETRANSFERT_ENTRY,
				'node_modules/closed': { version: '1.0.0', license: 'UNLICENSED' },
				'node_modules/custom': { version: '1.0.0', license: 'SEE LICENSE IN EULA.txt' },
				'node_modules/devonly': { version: '1.0.0', license: 'none', dev: true },
				'node_modules/a/node_modules/nested': { version: '2.0.0', license: '(MIT OR GPL-2.0)', optional: true },
			})
		)
		assert.equal(res.failures, 4)
		assert.equal(byName(res, 'ok').ok, true)
		assert.match(byName(res, 'nolicence').reason, /no licence declared/)
		assert.match(byName(res, 'wetransfert').reason, /"none" is not a redistributable licence/)
		assert.equal(byName(res, 'closed').ok, false)
		assert.equal(byName(res, 'custom').ok, false)
		assert.equal(byName(res, 'devonly'), undefined, 'dev-only packages do not ship')
		assert.deepEqual([byName(res, 'nested').ok, byName(res, 'nested').optional], [true, true])
		assert.deepEqual(new Map(licenseCounts(res.rows)).get('none'), 1)
		assert.deepEqual(new Map(licenseCounts(res.rows)).get('(missing)'), 1)
	})
	it('falls back to package.json (legacy licenses array) and to reviewed overrides', () => {
		const lock = lockOf({
			'node_modules/busboy': { version: '1.6.0' },
			'node_modules/jspack': { version: '0.0.4' },
			'node_modules/jspack2': { name: 'jspack', version: '0.0.5' },
		})
		const pj = { 'node_modules/busboy': { licenses: [{ type: 'MIT', url: 'x' }] } }
		const res = checkLockLicenses(lock, { readPackageJson: (p) => pj[p] || {}, fileExists: () => true })
		assert.deepEqual([byName(res, 'busboy').ok, byName(res, 'busboy').source], [true, 'package.json'])
		const jspack = res.rows.find((r) => r.version === '0.0.4')
		assert.deepEqual([jspack.ok, jspack.license], [true, 'BSD-3-Clause'])
		assert.equal(res.rows.find((r) => r.version === '0.0.5').ok, false, 'override is pinned to the reviewed version')
		const gone = checkLockLicenses(lock, { readPackageJson: () => ({}), fileExists: () => false })
		assert.match(gone.rows.find((r) => r.version === '0.0.4').reason, /names LICENSE, which is not in the package/)
		assert.equal(licenseFromPackageJson({ license: { type: 'ISC' } }), 'ISC')
		assert.equal(licenseFromPackageJson({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }), '(MIT OR Apache-2.0)')
	})
})

describe('WO-1096 CLI', () => {
	it('passes on the real production tree', () => {
		const r = spawnSync(process.execPath, [CLI], { cwd: REPO, encoding: 'utf8' })
		assert.equal(r.status, 0, r.stderr + r.stdout)
		assert.match(r.stdout, /OK: \d+ production packages/)
	})
	it('fails a lockfile that still carries wetransfert', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1096-lic-'))
		try {
			const lockFile = path.join(dir, 'package-lock.json')
			fs.writeFileSync(lockFile, JSON.stringify(lockOf({ 'node_modules/wetransfert': WETRANSFERT_ENTRY })))
			const r = spawnSync(process.execPath, [CLI, '--lock', lockFile], { cwd: REPO, encoding: 'utf8' })
			assert.equal(r.status, 1)
			assert.match(r.stderr, /NOT ALLOWED: wetransfert@2\.4\.0/)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
