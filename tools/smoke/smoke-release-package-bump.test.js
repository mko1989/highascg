'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')
const test = require('node:test')
const assert = require('node:assert/strict')

const REPO = path.resolve(__dirname, '../..')
const RELEASE_LIB = path.join(REPO, 'tools/release/release-lib.sh')

test('release_lib_bump_package_json sets version then restores', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-pkg-bump-'))
	const pkgPath = path.join(tmp, 'package.json')
	fs.writeFileSync(pkgPath, JSON.stringify({ name: 'test', version: '1.0.0' }, null, '\t') + '\n')

	const stamp = '2026-06-28T120000Z'
	execFileSync(
		'bash',
		[
			'-c',
			`
			source "${RELEASE_LIB}"
			release_lib_bump_package_json "${tmp}" "${stamp}"
			node -e "const j=require('${pkgPath}'); if(j.version!=='${stamp}') process.exit(1)"
			release_lib_restore_package_json "${tmp}"
			node -e "const j=require('${pkgPath}'); if(j.version!=='1.0.0') process.exit(2)"
			`,
		],
		{ encoding: 'utf8' },
	)
	assert.equal(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version, '1.0.0')
})
