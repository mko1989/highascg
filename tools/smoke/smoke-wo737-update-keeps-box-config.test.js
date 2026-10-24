'use strict'

/** WO-737 — an update never replaces the box's config/*.json; factory files only fill gaps. */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const test = require('node:test')
const assert = require('node:assert/strict')

const REPO = path.resolve(__dirname, '../..')
const APPLY = path.join(REPO, 'scripts/exfat/highascg-apply-server-drop.sh')
const EXCLUDES = path.join(REPO, 'config/server-update-rsync-excludes.txt')

const write = (file, text) => {
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, text)
}
const read = (file) => fs.readFileSync(file, 'utf8')

test('an update keeps the box config, adds new factory files and still updates code and support files', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-wo737-'))
	const drop = path.join(root, 'drop-update')
	const dest = path.join(root, 'highascg')
	write(path.join(drop, 'package.json'), JSON.stringify({ version: '2026-10-24T200000Z' }))
	write(path.join(drop, 'index.js'), '// new\n')
	write(path.join(drop, 'dist-web/index.html'), '<!doctype html><html></html>\n')
	write(path.join(drop, 'tools/runtime/exfat-sync-cli.js'), '// stub\n')
	write(path.join(drop, 'BUILD_STAMP'), '2026-10-24T200000Z\n')
	write(path.join(drop, 'config/screen_destinations.json'), '{"factory":true}\n')
	write(path.join(drop, 'config/brand_new.json'), '{"factory":"new"}\n')
	write(path.join(drop, 'config/server-update-rsync-excludes.txt'), 'new excludes, longer\n')
	write(path.join(drop, 'src/config/screen-destinations.js'), '// new code, longer\n')
	write(path.join(drop, 'client/lib/transition-presets.js'), 'export const x = 1\n')
	write(path.join(drop, 'client/assets/big.png'), 'png')

	write(path.join(dest, 'config/screen_destinations.json'), '{"box":"PGM/PRV 1"}\n')
	write(path.join(dest, 'config/server-update-rsync-excludes.txt'), 'old excludes\n')
	write(path.join(dest, 'src/config/screen-destinations.js'), '// old code\n')

	execFileSync(
		APPLY,
		['--source', drop, '--dest', dest, '--drop-update-root', drop, '--retain-drop', '--user', os.userInfo().username, '--excludes', EXCLUDES],
		{ cwd: REPO, encoding: 'utf8', env: { ...process.env, HIGHASCG_SERVER_UPDATE_NPM_CI: '0', HIGHASCG_UPDATE_STAGING: path.join(root, '.staging') } },
	)

	assert.equal(read(path.join(dest, 'config/screen_destinations.json')), '{"box":"PGM/PRV 1"}\n', 'the box config is kept')
	assert.equal(read(path.join(dest, 'config/brand_new.json')), '{"factory":"new"}\n', 'a missing factory file arrives')
	assert.equal(read(path.join(dest, 'config/server-update-rsync-excludes.txt')), 'new excludes, longer\n', 'support files update')
	assert.equal(read(path.join(dest, 'src/config/screen-destinations.js')), '// new code, longer\n', 'src/config is code, not box config')
	assert.equal(read(path.join(dest, 'BUILD_STAMP')).trim(), '2026-10-24T200000Z')
	assert.ok(fs.existsSync(path.join(dest, 'client/lib/transition-presets.js')), 'client/lib lands despite the /client/ exclude')
	assert.ok(!fs.existsSync(path.join(dest, 'client/assets')), 'the rest of client/ stays out')
})

test('a server running from a git checkout refuses a release update', async () => {
	const { startApplyJob } = require('../../src/system/server-update')
	const { REPO_ROOT } = require('../../src/repo-paths')
	if (!fs.existsSync(path.join(REPO_ROOT, '.git'))) return // a release tree (no .git) is what updates normally
	await assert.rejects(startApplyJob({ assetUrl: 'https://example.invalid/x.tar.gz' }), /git checkout/)
})

test('the apply refuses a git checkout and leaves it untouched (boot, USB and GUI paths alike)', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-wo737-git-'))
	const drop = path.join(root, 'drop-update')
	const dest = path.join(root, 'highascg')
	write(path.join(drop, 'package.json'), JSON.stringify({ version: '2026-10-24T200000Z' }))
	write(path.join(drop, 'index.js'), '// new, longer\n')
	write(path.join(drop, 'dist-web/index.html'), '<!doctype html><html></html>\n')
	write(path.join(drop, 'tools/runtime/exfat-sync-cli.js'), '// stub\n')
	write(path.join(drop, 'BUILD_STAMP'), '2026-10-24T200000Z\n')
	write(path.join(dest, '.git/HEAD'), 'ref: refs/heads/main\n')
	write(path.join(dest, 'index.js'), '// working tree\n')

	assert.throws(() =>
		execFileSync(
			APPLY,
			['--source', drop, '--dest', dest, '--drop-update-root', drop, '--retain-drop', '--user', os.userInfo().username, '--excludes', EXCLUDES],
			{ cwd: REPO, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, HIGHASCG_SERVER_UPDATE_NPM_CI: '0', HIGHASCG_UPDATE_STAGING: path.join(root, '.staging') } },
		),
	)
	assert.equal(read(path.join(dest, 'index.js')), '// working tree\n')
	assert.ok(!fs.existsSync(path.join(dest, 'BUILD_STAMP')))
})

/** Every module src/ imports from client/lib at runtime, followed through their own relative imports. */
function serverClientLibClosure() {
	const files = []
	const walk = (d) => {
		for (const f of fs.readdirSync(d)) {
			const p = path.join(d, f)
			if (fs.statSync(p).isDirectory()) walk(p)
			else if (p.endsWith('.js')) files.push(p)
		}
	}
	walk(path.join(REPO, 'src'))
	const entries = new Set()
	for (const f of files) {
		const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')
		if (!/client\/lib|'client',\s*'lib'/.test(code)) continue
		for (const m of code.matchAll(/'([a-z0-9-]+\.js)'/g)) entries.add(m[1])
		for (const m of code.matchAll(/client\/lib\/([a-z0-9-]+\.js)/g)) entries.add(m[1])
		const list = /CLIENT_LIB\s*=\s*\[([^\]]*)\]/.exec(code)
		if (list) for (const m of list[1].matchAll(/'([^']+)'/g)) entries.add(`${m[1]}.js`)
	}
	const seen = new Set()
	const queue = [...entries].map((n) => path.join('client/lib', n)).filter((f) => fs.existsSync(path.join(REPO, f)))
	while (queue.length) {
		const f = path.normalize(queue.pop())
		if (seen.has(f)) continue
		seen.add(f)
		for (const m of read(path.join(REPO, f)).matchAll(/(?:from|import\()\s*['"](\.\.?\/[^'"]+)['"]/g)) queue.push(path.join(path.dirname(f), m[1]))
	}
	return [...seen]
}

test('the server tarball ships client/lib, and all src/ needs from client/ is inside it', () => {
	const closure = serverClientLibClosure()
	assert.ok(closure.includes('client/lib/transition-presets.js') && closure.includes('client/lib/program-audio-layouts.js'))
	assert.deepEqual(closure.filter((f) => !f.startsWith('client/lib/')), [], 'a server-imported module reaches outside client/lib')
	const sh = (script) => execFileSync('bash', ['-c', `source scripts/lib/archive-common.sh; ${script}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
	assert.ok(sh('m=(); archive_common_server_tar_members m; printf "%s\\n" "${m[@]}"').split('\n').includes('client/lib'))
	const listed = sh('a=(-C "$PWD" -c); archive_common_server_tar_excludes a; archive_common_bulk_tar_excludes a; tar "${a[@]}" client/lib | tar -t')
	const missing = closure.filter((f) => !listed.includes(`${f}\n`))
	assert.deepEqual(missing, [], 'server-imported client/lib modules missing from the tarball')
})

test('verify-decklink reads /proc/modules (lsmod | grep -q under pipefail reported a loaded module missing)', () => {
	const sh = read(path.join(REPO, 'tools/startup/verify-decklink.sh'))
	assert.ok(sh.includes("if grep -q '^blackmagic' /proc/modules 2>/dev/null; then"))
	const code = sh.split('\n').filter((l) => !l.trim().startsWith('#'))
	assert.ok(!code.some((l) => /lsmod.*\|\s*grep -q/.test(l)))
})
