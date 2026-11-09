'use strict'

/**
 * WO-1022 — the update installs the Caspar a release carries (scripts/exfat/highascg-caspar-swap.sh).
 *
 * Runs the REAL helper against a fake install root: bin/ + lib/ + caspar/{bin/casparcg,PINNED.json}, with systemctl,
 * the VERSION probe (normally node's GET /api/state) and the "is a casparcg process running" test replaced by stubs.
 * Real dynamic executables (/usr/bin/true, /usr/bin/false) stand in for the old and the new Caspar so ldd resolves.
 * Nothing touches ~/highascg/bin, Caspar or node.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '../..')
const SWAP = path.join(REPO, 'scripts/exfat/highascg-caspar-swap.sh')
const APPLY = path.join(REPO, 'scripts/exfat/highascg-apply-server-drop.sh')
const OLD = '/usr/bin/true'
const NEW = '/usr/bin/false'
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

function fixture({ cef = 'cef-ok', pinSha } = {}) {
	const t = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1022-'))
	const root = path.join(t, 'highascg')
	for (const d of ['bin', 'lib', 'caspar/bin']) fs.mkdirSync(path.join(root, d), { recursive: true })
	fs.copyFileSync(OLD, path.join(root, 'bin/casparcg'))
	fs.copyFileSync(NEW, path.join(root, 'caspar/bin/casparcg'))
	fs.writeFileSync(path.join(root, 'lib/libcef.so'), cef)
	const pin = {
		version: '2.5.1 abc123def Stable',
		shortSha: 'abc123def',
		binarySha256: pinSha || sha(NEW),
		libcefSha256: crypto.createHash('sha256').update('cef-ok').digest('hex'),
		cefVersion: '142.0.17',
	}
	fs.writeFileSync(path.join(root, 'caspar/PINNED.json'), `${JSON.stringify(pin, null, '\t')}\n`)
	const calls = path.join(t, 'calls.txt')
	const active = path.join(t, 'active')
	fs.mkdirSync(active)
	const fake = path.join(t, 'systemctl')
	fs.writeFileSync(
		fake,
		`#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(calls)}\n` +
			`if [[ "$1" == is-active ]]; then u="\${@: -1}"; [[ -e ${JSON.stringify(active)}/$u ]]; exit $?; fi\nexit 0\n`,
		{ mode: 0o755 }
	)
	const version = path.join(t, 'version')
	const env = {
		...process.env,
		HIGHASCG_CASPAR_SYSTEMCTL: fake,
		HIGHASCG_CASPAR_HOLD: path.join(t, 'hold'),
		HIGHASCG_CASPAR_VERSION_PROBE: `[[ -f ${version} ]] || exit 2; cat ${version}`,
		HIGHASCG_CASPAR_RUNNING_CMD: 'true',
		HIGHASCG_CASPAR_GATE_CMD: 'false', // never read this box's real boot screen gate
		HIGHASCG_CASPAR_VERIFY_POLL_SEC: '0.1',
		HIGHASCG_CASPAR_VERIFY_UP_SEC: '1',
		HIGHASCG_CASPAR_VERIFY_MAX_SEC: '2',
	}
	const run = (...args) => {
		const r = spawnSync('bash', [SWAP, ...args, '--root', root], { env, encoding: 'utf8' })
		return { code: r.status, out: `${r.stdout}${r.stderr}` }
	}
	const state = () => {
		try {
			return Object.fromEntries(
				fs
					.readFileSync(path.join(root, 'bin/caspar-swap.state'), 'utf8')
					.trim()
					.split('\n')
					.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
			)
		} catch {
			return {}
		}
	}
	return {
		t,
		root,
		env,
		run,
		state,
		setActive: (u, on) => (on ? fs.writeFileSync(path.join(active, u), '') : fs.rmSync(path.join(active, u), { force: true })),
		calls: () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''),
		setVersion: (v) => (v == null ? fs.rmSync(version, { force: true }) : fs.writeFileSync(version, v)),
		bin: () => sha(path.join(root, 'bin/casparcg')),
		done: () => fs.rmSync(t, { recursive: true, force: true }),
	}
}

test('swap: backup + .prev hard links, .new + mv -f, Caspar restarted only while it runs', () => {
	const f = fixture()
	try {
		f.setActive('casparcg-server.service', true)
		const r = f.run('apply')
		assert.equal(r.code, 0, r.out)
		assert.equal(f.bin(), sha(NEW))
		const pre = fs.readdirSync(path.join(f.root, 'bin')).filter((n) => /^casparcg\.pre-\d{8}T\d{6}Z$/.test(n))
		assert.equal(pre.length, 1)
		assert.equal(sha(path.join(f.root, 'bin', pre[0])), sha(OLD))
		assert.equal(sha(path.join(f.root, 'bin/casparcg.prev')), sha(OLD))
		assert.ok(!fs.existsSync(path.join(f.root, 'bin/casparcg.new')))
		assert.equal(fs.statSync(path.join(f.root, 'bin/casparcg')).mode & 0o777, 0o755)
		assert.match(f.calls(), /^restart casparcg-server\.service$/m)
		assert.doesNotMatch(f.calls(), /restart highascg/, 'node is not running: no node restart')
		assert.equal(f.state().result, 'swapped')
		assert.equal(f.state().pinned, 'abc123def')
		// second run: already current, nothing restarted again
		const before = f.calls()
		assert.match(f.run('apply').out, /already the pinned/)
		assert.equal(f.calls(), before)
	} finally {
		f.done()
	}
})

test('swap at boot (Caspar not started yet): no restart', () => {
	const f = fixture()
	try {
		const r = f.run('apply')
		assert.equal(r.code, 0, r.out)
		assert.equal(f.bin(), sha(NEW))
		assert.doesNotMatch(f.calls(), /restart/)
		assert.match(r.out, /not running — the new binary starts with it/)
	} finally {
		f.done()
	}
})

test('no swap: hold, CEF mismatch, wrong candidate, unresolved libs — logged + state "skipped"', () => {
	const cases = [
		{ re: /held by/, setup: (f) => fs.writeFileSync(f.env.HIGHASCG_CASPAR_HOLD, '') },
		{ re: /not the CEF the build needs/, opts: { cef: 'other-cef' } },
		{ re: /is not the pinned/, opts: { pinSha: 'f'.repeat(64) } },
		{
			re: /unresolved libraries/,
			setup: (f) => {
				const c = path.join(f.root, 'caspar/bin/casparcg')
				fs.writeFileSync(c, '#!/bin/sh\n')
				const p = JSON.parse(fs.readFileSync(path.join(f.root, 'caspar/PINNED.json'), 'utf8'))
				p.binarySha256 = sha(c)
				fs.writeFileSync(path.join(f.root, 'caspar/PINNED.json'), JSON.stringify(p, null, '\t'))
			},
		},
	]
	for (const c of cases) {
		const f = fixture(c.opts)
		try {
			c.setup?.(f)
			f.setActive('casparcg-server.service', true)
			const r = f.run('apply')
			assert.equal(r.code, 0, r.out)
			assert.match(r.out, /NOT swapping/)
			assert.match(r.out, c.re)
			assert.equal(f.bin(), sha(OLD), `${c.re}: bin/casparcg untouched`)
			assert.doesNotMatch(f.calls(), /restart/)
			assert.equal(f.state().result, 'skipped')
			assert.match(f.state().reason, c.re)
		} finally {
			f.done()
		}
	}
})

test('verify: the pinned sha in node VERSION → verified, binary stays', () => {
	const f = fixture()
	try {
		f.run('apply')
		f.setVersion('2.5.1 abc123def Stable')
		const r = f.run('verify')
		assert.equal(r.code, 0, r.out)
		assert.equal(f.state().result, 'verified')
		assert.equal(f.bin(), sha(NEW))
	} finally {
		f.done()
	}
})

test('verify: Caspar runs but never reports the pin → rollback, Caspar + node restarted, no retry of that build', () => {
	const f = fixture()
	try {
		f.run('apply')
		f.setActive('highascg.service', true)
		f.setVersion('2.5.1 2476644c4 Stable')
		const r = f.run('verify')
		assert.equal(r.code, 1, r.out)
		assert.match(r.out, /ROLLBACK/)
		assert.equal(f.bin(), sha(OLD))
		assert.equal(f.state().result, 'rolled-back')
		assert.match(f.calls(), /restart casparcg-server\.service/)
		assert.match(f.calls(), /restart highascg\.service/)
		const again = f.run('apply')
		assert.match(again.out, /was rolled back/)
		assert.equal(f.bin(), sha(OLD))
		assert.equal(f.state().result, 'rolled-back', 'the rollback record survives a retry')
	} finally {
		f.done()
	}
})

test('verify: gate released but no casparcg process ever runs (dies at start) → rollback', () => {
	const f = fixture()
	try {
		f.run('apply')
		f.setVersion('')
		f.env.HIGHASCG_CASPAR_RUNNING_CMD = 'false'
		f.env.HIGHASCG_CASPAR_GATE_CMD = 'true'
		const r = f.run('verify')
		assert.equal(r.code, 1, r.out)
		assert.match(r.out, /ROLLBACK: the boot screen gate was released/)
		assert.equal(f.bin(), sha(OLD))
		assert.equal(f.state().result, 'rolled-back')
	} finally {
		f.done()
	}
})

test('verify: gate still closed and Caspar not running → waits, "unverified", the new binary stays', () => {
	const f = fixture()
	try {
		f.run('apply')
		f.setVersion('')
		f.env.HIGHASCG_CASPAR_RUNNING_CMD = 'false'
		const r = f.run('verify')
		assert.equal(r.code, 0, r.out)
		assert.equal(f.state().result, 'unverified')
		assert.equal(f.bin(), sha(NEW))
	} finally {
		f.done()
	}
})

test('verify: node never answers → "unverified", the new binary stays (no blind rollback)', () => {
	const f = fixture()
	try {
		f.run('apply')
		f.setVersion(null)
		const r = f.run('verify')
		assert.equal(r.code, 0, r.out)
		assert.equal(f.state().result, 'unverified')
		assert.equal(f.bin(), sha(NEW))
	} finally {
		f.done()
	}
})

test('manual rollback + only 3 timestamped backups kept', () => {
	const f = fixture()
	try {
		for (const s of ['20260101T000000Z', '20260102T000000Z', '20260103T000000Z', '20260104T000000Z'])
			fs.copyFileSync(OLD, path.join(f.root, `bin/casparcg.pre-${s}`))
		fs.copyFileSync(OLD, path.join(f.root, 'bin/casparcg.pre-wo1020'))
		f.run('apply')
		const pre = fs.readdirSync(path.join(f.root, 'bin')).filter((n) => n.startsWith('casparcg.pre-'))
		assert.equal(pre.filter((n) => /\d{8}T\d{6}Z$/.test(n)).length, 3)
		assert.ok(pre.includes('casparcg.pre-wo1020'), 'hand-made backups are never pruned')
		const r = f.run('rollback')
		assert.equal(r.code, 0, r.out)
		assert.equal(f.bin(), sha(OLD))
	} finally {
		f.done()
	}
})

test('drop apply runs the swap from the drop it just merged (fake drop, retain mode, no npm)', () => {
	const f = fixture()
	try {
		const drop = path.join(f.t, 'drop-update')
		for (const d of ['src', 'dist-web', 'tools/runtime', 'scripts/exfat', 'caspar/bin']) fs.mkdirSync(path.join(drop, d), { recursive: true })
		for (const [p, c] of [['package.json', '{}'], ['index.js', ''], ['dist-web/index.html', ''], ['BUILD_STAMP', '2099-01-01T000000Z']])
			fs.writeFileSync(path.join(drop, p), c)
		fs.copyFileSync(SWAP, path.join(drop, 'scripts/exfat/highascg-caspar-swap.sh'))
		fs.copyFileSync(NEW, path.join(drop, 'caspar/bin/casparcg'))
		fs.copyFileSync(path.join(f.root, 'caspar/PINNED.json'), path.join(drop, 'caspar/PINNED.json'))
		fs.rmSync(path.join(f.root, 'caspar'), { recursive: true })
		const user = os.userInfo().username
		const r = spawnSync(
			'bash',
			[APPLY, '--source', drop, '--dest', f.root, '--drop-update-root', drop, '--retain-drop', '--user', user, '--excludes', '/nonexistent'],
			{
				encoding: 'utf8',
				env: { ...f.env, HIGHASCG_SERVER_UPDATE_NPM_CI: '0', HIGHASCG_UPDATE_STAGING: path.join(f.t, 'staging') },
			}
		)
		assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
		assert.equal(f.bin(), sha(NEW))
		assert.match(r.stderr, /swapped bin\/casparcg/)
		assert.equal(f.state().result, 'swapped')
	} finally {
		f.done()
	}
})
