'use strict'

/**
 * WO-881 — a Caspar that came up with "[html] Failed to initialize CEF" (AMCP fine, every HTML layer 404) is noticed by
 * the supervisor: the watcher reads Caspar's own log from the launch on, restarts Caspar ONCE (fast, not a crash), and
 * when that start fails too it leaves Caspar running and raises the health file node shows in the GUI. A stale CEF
 * profile lock (the KILLed main's pid) is dropped before a start.
 *
 * Like smoke-wo805-supervisor-exit-wait: run.sh under /bin/sh against a STUB "casparcg" (a node script in a temp dir that
 * serves a free port as its AMCP and writes the CEF line into CASPAR_LOG_DIR on the launches listed in STUB_CEF_FAIL).
 * Paths go in through env, never argv, so the pgrep -f kill sweep can only match the stub.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const net = require('net')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const LIB = path.join(ROOT, 'tools/runtime/casparcg-supervisor-lib.sh')
const RUN_SH = path.join(ROOT, 'run.sh')

let dir
let env

function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer()
		s.once('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address()
			s.close(() => resolve(port))
		})
	})
}

function runSh(file, extraEnv = {}) {
	return new Promise((resolve) => {
		const t0 = Date.now()
		const p = spawn('/bin/sh', [file], { env: { ...env, ...extraEnv } })
		let out = ''
		p.stdout.on('data', (d) => (out += d))
		p.stderr.on('data', (d) => (out += d))
		p.on('close', (code) => resolve({ code, ms: Date.now() - t0, out }))
	})
}

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')
const launches = () => Number(read(path.join(dir, 'launches')) || 0)

/** A fresh case: no counter, logs, state, health or supervisor log from the previous one. */
function reset() {
	for (const f of ['launches', 'caspar.log', 'cef.state', 'crash.state']) fs.rmSync(path.join(dir, f), { force: true })
	fs.rmSync(path.join(dir, 'log'), { recursive: true, force: true })
	fs.mkdirSync(path.join(dir, 'log'))
	fs.rmSync(path.join(dir, 'home'), { recursive: true, force: true })
	fs.mkdirSync(path.join(dir, 'home'))
	// Yesterday's run failed CEF too: an old line BEFORE the launch mark must not count.
	fs.writeFileSync(path.join(dir, 'log', 'caspar_2026-10-30.log'), '[error] [html] Failed to initialize CEF\n')
	fs.utimesSync(path.join(dir, 'log', 'caspar_2026-10-30.log'), new Date(Date.now() - 86400e3), new Date(Date.now() - 86400e3))
	fs.writeFileSync(path.join(dir, 'log', 'caspar_2026-10-31.log'), '[error] [html] Failed to initialize CEF\n[info] old run\n')
}

before(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo881-cef-'))
	fs.mkdirSync(path.join(dir, 'tools/runtime'), { recursive: true })
	fs.symlinkSync(LIB, path.join(dir, 'tools/runtime/casparcg-supervisor-lib.sh'))
	fs.mkdirSync(path.join(dir, 'bin'))
	fs.mkdirSync(path.join(dir, 'cef-cache'))
	const bin = path.join(dir, 'bin', 'casparcg')
	// Stub Caspar: counts its launches; on a launch listed in STUB_CEF_FAIL it logs the CEF failure (else the html module
	// comes up); AMCP after 100 ms; from launch STUB_EXIT_FROM on it exits STUB_EXIT after STUB_EXIT_MS.
	fs.writeFileSync(
		bin,
		`#!${process.execPath}
const fs = require('fs'), path = require('path')
const dir = process.env.CASPAR_ROOT, cnt = path.join(dir, 'launches')
const n = (Number(fs.existsSync(cnt) ? fs.readFileSync(cnt, 'utf8') : 0) || 0) + 1
fs.writeFileSync(cnt, String(n))
const log = path.join(process.env.CASPAR_LOG_DIR, 'caspar_2026-10-31.log')
const fail = String(process.env.STUB_CEF_FAIL || '').split(',').includes(String(n))
fs.appendFileSync(log, fail ? '[error] [html] Failed to initialize CEF\\n[info] Initialized html module.\\n' : '[info] Initialized html module.\\n')
const srv = require('net').createServer()
setInterval(() => {}, 1 << 30)
setTimeout(() => srv.listen(Number(process.env.CASPAR_AMCP_PORT), '0.0.0.0'), 100)
if (n >= Number(process.env.STUB_EXIT_FROM || 1)) setTimeout(() => { srv.close(); process.exit(Number(process.env.STUB_EXIT || 7)) }, Number(process.env.STUB_EXIT_MS || 3000))
`,
		{ mode: 0o755 },
	)
	fs.writeFileSync(path.join(dir, 'casparcg.config'), '<configuration/>\n')
	env = {
		PATH: process.env.PATH,
		HOME: path.join(dir, 'home'),
		CASPAR_ROOT: dir,
		CASPAR_BIN: bin,
		CASPAR_CONFIG_PATH: path.join(dir, 'casparcg.config'),
		CASPAR_CEF_CACHE: path.join(dir, 'cef-cache'),
		CASPAR_LOG_DIR: path.join(dir, 'log'),
		CASPAR_CEF_STATE: path.join(dir, 'cef.state'),
		CASPAR_SUPERVISOR_LOG: path.join(dir, 'caspar.log'),
		CASPAR_RUNSH_LOCK: path.join(dir, 'runsh.lock'),
		CASPAR_INHIBIT_FILE: path.join(dir, 'inhibit'),
		CASPAR_CRASH_STATE: path.join(dir, 'crash.state'),
		CASPAR_SCREEN_GATE_SEC: '0',
		CASPAR_RESTART_GRACE_SEC: '0',
		CASPAR_RESTART_EXIT_CODES: '5', // the stub's final exit 7 ends run.sh
		HIGHASCG_CONFIG_PATH: path.join(dir, 'config'),
		CASPAR_HANG_FLAG: path.join(dir, 'hang.flag'),
		DISPLAY: ':999',
	}
})

after(() => {
	if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

const health = () => path.join(dir, 'home', '.highascg', 'run', 'caspar-cef-failed')

describe('WO-881: Caspar without CEF is noticed', () => {
	it('CEF fails once → one fast relaunch; the second start is clean → no warning, state cleared', async () => {
		reset()
		const r = await runSh(RUN_SH, { CASPAR_AMCP_PORT: String(await freePort()), STUB_CEF_FAIL: '1', STUB_EXIT_FROM: '2', STUB_EXIT_MS: '12500' })
		const sup = read(env.CASPAR_SUPERVISOR_LOG)
		assert.equal(r.code, 7, r.out + sup)
		assert.equal(launches(), 2, 'exactly one relaunch')
		assert.match(sup, /CEF failed to initialize \(HTML layers dead\) — restarting Caspar once/)
		assert.match(sup, /\[run\.sh\] CEF retry — fast relaunch/)
		assert.doesNotMatch(sup, /backoff|crash loop/i, 'the retry is not crash-damped')
		assert.equal(fs.existsSync(health()), false, 'no health warning')
		assert.equal(fs.existsSync(env.CASPAR_CEF_STATE), false, 'a clean start clears the retry state')
	})

	it('CEF fails on the relaunch too → Caspar left running, health file raised, no third start', async () => {
		reset()
		const r = await runSh(RUN_SH, { CASPAR_AMCP_PORT: String(await freePort()), STUB_CEF_FAIL: '1,2', STUB_EXIT_FROM: '2', STUB_EXIT_MS: '3000' })
		const sup = read(env.CASPAR_SUPERVISOR_LOG)
		assert.equal(r.code, 7, r.out + sup)
		assert.equal(launches(), 2, 'no restart loop')
		assert.match(sup, /CEF failed again after a restart — health warning raised, Caspar left running/)
		assert.match(read(health()), /Caspar HTML \(CEF\) failed to start twice/)
	})

	it('a clean start with old CEF lines in the logs (before the launch mark) is left alone', async () => {
		reset()
		fs.mkdirSync(path.dirname(health()), { recursive: true })
		fs.writeFileSync(health(), 'stale warning\n')
		const r = await runSh(RUN_SH, { CASPAR_AMCP_PORT: String(await freePort()), STUB_CEF_FAIL: '', STUB_EXIT_MS: '12500' })
		assert.equal(r.code, 7, r.out)
		assert.equal(launches(), 1)
		assert.doesNotMatch(read(env.CASPAR_SUPERVISOR_LOG), /CEF failed/)
		assert.equal(fs.existsSync(health()), false, 'a clean start clears an old warning')
	})

	it('a stale CEF profile lock is dropped: its pid gone, or reused by a program that is no casparcg', () => {
		const cache = env.CASPAR_CEF_CACHE
		const lock = path.join(cache, 'SingletonLock')
		const drive = (target) => {
			fs.rmSync(lock, { force: true })
			fs.symlinkSync(target, lock)
			fs.writeFileSync(path.join(cache, 'SingletonCookie'), '')
			return spawnSync('/bin/sh', ['-c', '. "$CASPAR_ROOT/tools/runtime/casparcg-supervisor-lib.sh"; caspar_drop_stale_cef_lock'], { env })
		}
		const has = (f) => fs.readdirSync(cache).includes(f)  // existsSync follows the (dangling) link
		drive('box-999999999')
		assert.equal(has('SingletonLock'), false, 'dead pid → lock gone')
		assert.equal(fs.existsSync(path.join(cache, 'SingletonCookie')), false)
		// A pid that is alive but no casparcg (this test runner) → the lock is not Caspar's → dropped too.
		drive(`box-${process.pid}`)
		assert.equal(has('SingletonLock'), false, 'a reused pid of another program → dropped')
	})

	it('sources: the fixed 1 s after the KILL sweep is gone; the scripts parse under /bin/sh', () => {
		const lib = fs.readFileSync(LIB, 'utf8')
		const fn = lib.slice(lib.indexOf('caspar_ensure_fully_stopped()'), lib.indexOf('caspar_wait_amcp_port_free()'))
		assert.match(fn, /caspar_kill_all_processes KILL\n\tcaspar_wait_tree_gone/)
		assert.doesNotMatch(fn, /\n\tsleep 1\n/)
		const run = fs.readFileSync(RUN_SH, 'utf8')
		assert.match(run, /caspar_drop_stale_cef_lock\n\tCASPAR_LOG_MARK="\$\(caspar_log_mark\)"\n\t"\$CASPAR_BIN"/)
		for (const f of [RUN_SH, LIB]) assert.equal(spawnSync('/bin/sh', ['-n', f]).status, 0, `${f} parses`)
	})
})
