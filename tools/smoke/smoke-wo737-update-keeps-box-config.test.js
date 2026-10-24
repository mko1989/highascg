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
