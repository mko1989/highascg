'use strict'

/**
 * WO-749 — the server runs the post-update sweep (tools/sweep, WO-730) after every update, so a release must carry it
 * and everything it runs. It did not: .4 kept a 24.10 copy, whose DeckLink check still had the bug WO-737 fixed.
 * Builds the shipped tree with the real tar rules and loads the sweep from it alone.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const test = require('node:test')
const assert = require('node:assert/strict')

const REPO = path.resolve(__dirname, '../..')
const sh = (script) => execFileSync('bash', ['-c', `source scripts/lib/archive-common.sh; ${script}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

test('the server tarball ships the sweep and what it runs; the sweep loads from the shipped files alone', () => {
	const members = sh('m=(); archive_common_server_tar_members m; printf "%s\\n" "${m[@]}"').split('\n')
	const wanted = ['tools/sweep', 'tools/startup', 'tools/e2e/sandbox-server.js', 'tools/e2e/replication-check.js', 'tools/ci/check-require-integrity.js']
	assert.deepEqual(wanted.filter((m) => !members.includes(m)), [], 'tarball members')
	const box = fs.mkdtempSync(path.join(os.tmpdir(), 'wo749-box-'))
	try {
		sh(`a=(-C "$PWD" -c); archive_common_server_tar_excludes a; archive_common_bulk_tar_excludes a; tar "\${a[@]}" index.js package.json src tools/runtime ${wanted.join(' ')} | tar -x -C '${box}'`)
		fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(box, 'node_modules'))
		// every verifier script checks-system.js names
		const scripts = [...fs.readFileSync(path.join(REPO, 'tools/sweep/checks-system.js'), 'utf8').matchAll(/verifier\([^)]*'([\w-]+\.sh)'/g)].map((m) => m[1])
		assert.ok(scripts.includes('verify-decklink.sh'), scripts.join())
		assert.deepEqual(scripts.filter((f) => !fs.existsSync(path.join(box, 'tools/startup', f))), [], 'verifiers missing from the tarball')
		const mods = ['tools/sweep/run-sweep.js', ...fs.readdirSync(path.join(box, 'tools/sweep')).map((f) => `tools/sweep/${f}`), 'tools/e2e/sandbox-server.js', 'tools/e2e/replication-check.js']
		const out = execFileSync(process.execPath, ['-e', `for (const m of ${JSON.stringify(mods)}) require('./' + m); console.log('ok')`], { cwd: box, encoding: 'utf8' })
		assert.equal(out.trim(), 'ok')
		const ri = execFileSync(process.execPath, ['tools/ci/check-require-integrity.js'], { cwd: box, encoding: 'utf8' })
		assert.match(ri, /OK/)
	} finally {
		fs.rmSync(box, { recursive: true, force: true })
	}
})
