'use strict'

/**
 * WO-730 — the post-update sweep (tools/sweep/run-sweep.js): the pure rules, the report files, the code id that
 * decides "an update happened", the server wiring, and one real run of the sandbox checks against fixture projects
 * (a throwaway sandbox server, like smoke-wo725 — no Caspar, no live server).
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const REPO = path.resolve(__dirname, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo730-'))
process.env.HIGHASCG_SWEEP_DIR = path.join(tmp, 'state')
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const { diskStatus, plainReplicationKeys } = require('../sweep/checks-system')
const { CASPAR_NOISE } = require('../sweep/checks-app')
const { getRoutes } = require('../sweep/checks-sandbox')
const { runSweep, markdown, save } = require('../sweep/run-sweep')
const { codeId, gitHead, lastReport, startSweepAfterUpdate } = require('../../src/system/sweep-after-update')

describe('WO-730 sweep rules', () => {
	it('disk: fail under 2 % or 1 GB, warn under 10 % or 10 GB', () => {
		assert.equal(diskStatus({ size: 1000e9, avail: 500e9 }), 'pass')
		assert.equal(diskStatus({ size: 1000e9, avail: 50e9 }), 'warn')
		assert.equal(diskStatus({ size: 100e9, avail: 9e9 }), 'warn')
		assert.equal(diskStatus({ size: 1000e9, avail: 15e9 }), 'fail')
		assert.equal(diskStatus({ size: 20e9, avail: 0.5e9 }), 'fail')
	})

	it('a replication key without options is a full shell; a forced one is not', () => {
		const text = [
			'ssh-ed25519 AAAA1 highascg-replication@box-a',
			'command="/usr/local/bin/highascg-replication-ssh",no-pty ssh-ed25519 AAAA2 highascg-replication@box-b',
			'ssh-ed25519 AAAA3 owner@mac',
		].join('\n')
		assert.deepEqual(plainReplicationKeys(text), ['ssh-ed25519 AAAA1 highascg-replication@box-a'])
	})

	it('media copy on a box that never sent media: a warning that names the button, no ssh (WO-753)', async () => {
		const check = require('../sweep/checks-cluster').find((c) => c.id === 'cluster.media-copy')
		const prev = process.env.HIGHASCG_REPL_SSH_KEY
		process.env.HIGHASCG_REPL_SSH_KEY = path.join(tmp, 'no-such-key')
		try {
			const r = await check.run({ cluster: { peers: [{ id: 'peer', host: '192.0.2.1' }] } })
			assert.equal(r.status, 'warn')
			assert.match(r.summary, /Send media/)
		} finally {
			if (prev === undefined) delete process.env.HIGHASCG_REPL_SSH_KEY
			else process.env.HIGHASCG_REPL_SSH_KEY = prev
		}
	})

	it('Caspar socket bookkeeping is noise, a real error is not', () => {
		const noise = (l) => CASPAR_NOISE.some((n) => n.test(l))
		for (const l of [
			'[error]    0# 0x0000623BD5B44AA7 in /home/casparcg/highascg/bin/casparcg',
			'[error]   Dynamic exception type: boost::wrapexcept<boost::system::system_error>',
			'[error]   std::exception::what: remote_endpoint: Transport endpoint is not connected [system:107',
			'[error]   std::exception::what: local_endpoint: Bad file descriptor [system:9',
			'[error]   Exception: /usr/include/boost/asio/basic_socket_acceptor.hpp(1122): Throw',
			'[error]',
		])
			assert.ok(noise(l), l)
		assert.ok(!noise('[error] Failed to open file: AMB.mp4'))
	})

	it('the sandbox probes every parameterless GET route except the support bundle', () => {
		const routes = getRoutes()
		assert.ok(routes.length > 50, `${routes.length} routes`)
		assert.ok(routes.includes('/api/state') && routes.includes('/api/project/list'))
		assert.ok(!routes.includes('/api/support/bundle'))
		assert.ok(routes.every((r) => !/[:*]/.test(r)))
	})
})

describe('WO-730 code id and the once-per-update run', () => {
	it('reads HEAD through a loose ref and through packed-refs', () => {
		const repo = path.join(tmp, 'repo')
		fs.mkdirSync(path.join(repo, '.git/refs/heads'), { recursive: true })
		fs.writeFileSync(path.join(repo, 'BUILD_STAMP'), '2026-10-24_120000\n')
		fs.writeFileSync(path.join(repo, '.git/HEAD'), 'ref: refs/heads/main\n')
		fs.writeFileSync(
			path.join(repo, '.git/packed-refs'),
			'# pack-refs\n0123456789abcdef0123456789abcdef01234567 refs/heads/main\n'
		)
		assert.equal(gitHead(repo), '0123456789ab')
		fs.writeFileSync(path.join(repo, '.git/refs/heads/main'), 'fedcba9876543210fedcba9876543210fedcba98\n')
		assert.equal(codeId(repo), '2026-10-24_120000+fedcba987654')
		fs.rmSync(path.join(repo, '.git'), { recursive: true })
		assert.equal(codeId(repo), '2026-10-24_120000')
	})

	it('runs only when the code id differs from the last report', () => {
		const dir = process.env.HIGHASCG_SWEEP_DIR
		fs.mkdirSync(dir, { recursive: true })
		const logs = []
		const ctx = { log: (lvl, m) => logs.push(m), config: { server: { httpPort: 4200 } } }
		fs.writeFileSync(path.join(dir, 'last.json'), JSON.stringify({ codeId: codeId() }))
		assert.equal(startSweepAfterUpdate(ctx), null)
		fs.writeFileSync(path.join(dir, 'last.json'), JSON.stringify({ codeId: 'older' }))
		const timer = startSweepAfterUpdate(ctx)
		assert.ok(timer)
		clearTimeout(timer)
		assert.match(logs[0], /^\[sweep\] new code .*: sweep in 120 s$/)
	})

	it('the server starts it and serves the last report', () => {
		const idx = fs.readFileSync(path.join(REPO, 'index.js'), 'utf8')
		assert.ok(idx.includes('startSweepAfterUpdate(appCtx) // WO-730: once per update'))
		const upd = fs.readFileSync(path.join(REPO, 'src/api/routes-system-update.js'), 'utf8')
		assert.ok(upd.includes("if (path === '/api/system/update/sweep') {"))
	})
})

describe('WO-730 report files', () => {
	const rep = (at, fail = 0) => ({
		at,
		host: 'h',
		codeId: 'c',
		ms: 1500,
		totals: { pass: 1, warn: 0, fail, skip: 0 },
		results: [{ id: 'x', name: 'a | b', status: fail ? 'fail' : 'pass', summary: 's|t', details: ['d'] }],
	})

	it('markdown escapes table pipes', () => {
		const md = markdown(rep('2026-10-24T10:00:00.000Z'))
		assert.match(md, /\| PASS \| a \/ b \| s\/t<br>d \|/)
	})

	it('save keeps the 20 newest and last.json', () => {
		const dir = path.join(tmp, 'reports')
		for (let i = 0; i < 23; i++) save(rep(`2026-10-24T10:${String(i).padStart(2, '0')}:00.000Z`, i === 22 ? 1 : 0), dir)
		const json = fs
			.readdirSync(dir)
			.filter((f) => /^\d{4}-.*\.json$/.test(f))
			.sort()
		assert.equal(json.length, 20)
		assert.equal(json[0], '2026-10-24T10-03-00.json')
		assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length, 20)
		assert.equal(lastReport(dir).totals.fail, 1)
	})
})

describe('WO-730 sandbox checks on fixture projects', () => {
	it('loads every project on a sandbox and names the one that does not load', async () => {
		const projects = path.join(tmp, 'projects')
		fs.mkdirSync(projects)
		fs.writeFileSync(
			path.join(projects, 'wo730_good.json'),
			JSON.stringify({ version: 1, name: 'wo730_good', scenes: [] })
		)
		fs.writeFileSync(path.join(projects, 'wo730_broken.json'), '{ not json')
		fs.writeFileSync(path.join(projects, 'wo730_good.sync-conflict-20260101-000000-ABCDEFG.json'), '{}')
		process.env.HIGHASCG_PROJECTS_DIR = projects
		try {
			const r = await runSweep({ url: 'http://127.0.0.1:9', only: 'sandbox' })
			const routes = r.results.find((x) => x.id === 'sandbox.routes')
			const load = r.results.find((x) => x.id === 'sandbox.projects')
			assert.equal(routes.status, 'pass', `${routes.summary} ${routes.details || ''}`)
			assert.equal(load.status, 'fail')
			assert.match(load.summary, /^1\/2 projects fail to load/)
			assert.match(load.details[0], /^wo730_broken: /)
		} finally {
			delete process.env.HIGHASCG_PROJECTS_DIR
		}
	})
})
