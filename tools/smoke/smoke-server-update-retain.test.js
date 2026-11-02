'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const test = require('node:test')
const assert = require('node:assert/strict')

const REPO = path.resolve(__dirname, '../..')
const APPLY = path.join(REPO, 'scripts/exfat/highascg-apply-server-drop.sh')
const EXCLUDES = path.join(REPO, 'config/server-update-rsync-excludes.txt')

function seedDrop(root) {
	const drop = path.join(root, 'drop-update')
	fs.mkdirSync(path.join(drop, 'src'), { recursive: true })
	fs.mkdirSync(path.join(drop, 'dist-web'), { recursive: true })
	fs.mkdirSync(path.join(drop, 'tools/runtime'), { recursive: true })
	fs.writeFileSync(path.join(drop, 'package.json'), JSON.stringify({ version: '2026-06-28T120000Z' }))
	fs.writeFileSync(path.join(drop, 'index.js'), '// smoke\n')
	fs.writeFileSync(path.join(drop, 'dist-web/index.html'), '<!doctype html><html></html>\n')
	fs.writeFileSync(path.join(drop, 'BUILD_STAMP'), '2026-06-28T120000Z\n')
	fs.writeFileSync(path.join(drop, 'tools/runtime/exfat-sync-cli.js'), '// stub\n')
	return drop
}

function runApply(args, env = {}) {
	return execFileSync(APPLY, args, {
		cwd: REPO,
		env: { ...process.env, ...env },
		encoding: 'utf8',
	})
}

test('retain mode leaves drop-update/ in place', () => {
	const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ha-drop-'))
	const drop = seedDrop(root)
	const dest = path.join(root, 'highascg')
	fs.mkdirSync(dest, { recursive: true })

	runApply(
		[
			'--source',
			drop,
			'--dest',
			dest,
			'--drop-update-root',
			drop,
			'--retain-drop',
			'--user',
			process.env.USER || 'nobody',
			'--excludes',
			EXCLUDES,
		],
		{
			HIGHASCG_SERVER_UPDATE_NPM_CI: '0',
			HIGHASCG_UPDATE_STAGING: path.join(root, '.staging'),
		},
	)

	assert.ok(fs.existsSync(path.join(drop, 'package.json')), 'drop-update/package.json must remain')
	assert.equal(fs.readFileSync(path.join(dest, 'BUILD_STAMP'), 'utf8').trim(), '2026-06-28T120000Z')
	assert.equal(fs.readFileSync(path.join(drop, '.applied-stamp'), 'utf8').trim(), '2026-06-28T120000Z')
})

test('consume mode moves drop to applied/', () => {
	const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ha-drop-'))
	const drop = seedDrop(root)
	const dest = path.join(root, 'highascg')
	fs.mkdirSync(dest, { recursive: true })

	runApply(
		[
			'--source',
			drop,
			'--dest',
			dest,
			'--drop-update-root',
			drop,
			'--consume-drop',
			'--user',
			process.env.USER || 'nobody',
			'--excludes',
			EXCLUDES,
		],
		{
			HIGHASCG_SERVER_UPDATE_NPM_CI: '0',
			HIGHASCG_UPDATE_STAGING: path.join(root, '.staging'),
		},
	)

	assert.ok(!fs.existsSync(path.join(drop, 'package.json')), 'drop-update should be empty after consume')
	const applied = fs.readdirSync(path.join(drop, 'applied'))
	assert.equal(applied.length, 1)
	assert.ok(fs.existsSync(path.join(drop, 'applied', applied[0], 'package.json')))
})

test('--print-retain-mode honours marker env', () => {
	const retain = runApply(['--print-retain-mode'], { HIGHASCG_SERVER_UPDATE_RETAIN_DROP: '1' }).trim()
	const consume = runApply(['--print-retain-mode'], { HIGHASCG_SERVER_UPDATE_RETAIN_DROP: '0' }).trim()
	assert.equal(retain, 'retain')
	assert.equal(consume, 'consume')
})

test('validation rejects drop missing dist-web', () => {
	const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ha-drop-'))
	const drop = seedDrop(root)
	fs.rmSync(path.join(drop, 'dist-web'), { recursive: true, force: true })
	const dest = path.join(root, 'highascg')
	fs.mkdirSync(dest, { recursive: true })
	assert.throws(
		() =>
			runApply([
				'--source',
				drop,
				'--dest',
				dest,
				'--retain-drop',
				'--user',
				process.env.USER || 'nobody',
				'--excludes',
				EXCLUDES,
			]),
		/validation failed|refusing/,
	)
})

// WO-925: a Ventoy re-flash keeps the stick's exFAT — a 25.10 drop was merged over the 01.11 ISO on every boot.
function applyOver(installedStamp, extra = () => {}) {
	const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ha-drop-'))
	const drop = seedDrop(root)
	extra(drop)
	const dest = path.join(root, 'highascg')
	fs.mkdirSync(dest, { recursive: true })
	fs.writeFileSync(path.join(dest, 'BUILD_STAMP'), `${installedStamp}\n`)
	fs.writeFileSync(path.join(dest, 'index.js'), '// installed\n')
	const r = require('child_process').spawnSync(
		APPLY,
		['--source', drop, '--dest', dest, '--drop-update-root', drop, '--retain-drop', '--user', process.env.USER || 'nobody', '--excludes', EXCLUDES],
		{ cwd: REPO, encoding: 'utf8', env: { ...process.env, HIGHASCG_SERVER_UPDATE_NPM_CI: '0', HIGHASCG_UPDATE_STAGING: path.join(root, '.staging') } },
	)
	assert.equal(r.status, 0, r.stderr)
	const out = r.stdout + r.stderr
	return { out, stamp: fs.readFileSync(path.join(dest, 'BUILD_STAMP'), 'utf8').trim(), index: fs.readFileSync(path.join(dest, 'index.js'), 'utf8') }
}

test('WO-925: a drop older than the installed code is not applied', () => {
	const r = applyOver('2026-11-01_170159')
	assert.match(r.out, /older than the installed 2026-11-01_170159 — not applied/)
	assert.deepEqual([r.stamp, r.index], ['2026-11-01_170159', '// installed\n'])
})

test('WO-925: a newer drop still applies; ALLOW_DOWNGRADE rolls back on purpose', () => {
	assert.equal(applyOver('2026-06-01_090000').stamp, '2026-06-28T120000Z')
	const back = applyOver('2026-11-01_170159', (drop) => fs.writeFileSync(path.join(drop, 'ALLOW_DOWNGRADE'), ''))
	assert.deepEqual([back.stamp, back.index], ['2026-06-28T120000Z', '// smoke\n'])
})
