'use strict'

/**
 * WO-805 fix 1 — run.sh notices Caspar's exit at once instead of when its 10 s healthy-poll `sleep` ends, and the
 * WO-398 hang detector (now caspar_hang_watch, beside the child) still kills a truly hung Caspar and returns 5.
 *
 * Everything runs under /bin/sh (dash on the box) against STUBS: the "casparcg" binary is a node script in a temp
 * dir that listens on a free port as its "AMCP" and exits with a chosen code. CASPAR_ROOT is a temp dir holding only
 * a link to the real supervisor lib, so run.sh's pre-launch helpers (screen-consumer policy, HDMI unmute) are absent
 * and skipped — no real mixer, config or Caspar is touched. Paths go in through env, never argv, so the
 * pgrep -f based kill sweep can only ever match the stub.
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

/** A free TCP port (listen on 0, read it, close). */
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

/** Run a /bin/sh script file with env; resolve { code, ms, stdout, stderr }. */
function runSh(file, extraEnv = {}, args = []) {
	return new Promise((resolve) => {
		const t0 = Date.now()
		const p = spawn('/bin/sh', [file, ...args], { env: { ...env, ...extraEnv } })
		let stdout = ''
		let stderr = ''
		p.stdout.on('data', (d) => (stdout += d))
		p.stderr.on('data', (d) => (stderr += d))
		p.on('close', (code) => resolve({ code, ms: Date.now() - t0, stdout, stderr }))
	})
}

const alive = (pid) => {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

before(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo805-sup-'))
	fs.mkdirSync(path.join(dir, 'tools/runtime'), { recursive: true })
	fs.symlinkSync(LIB, path.join(dir, 'tools/runtime/casparcg-supervisor-lib.sh'))
	fs.mkdirSync(path.join(dir, 'bin'))
	fs.mkdirSync(path.join(dir, 'home'))
	fs.mkdirSync(path.join(dir, 'stubs'))
	// Stub Caspar: AMCP up after STUB_UP_MS, closed again after STUB_DROP_MS (a hang: process stays), exit
	// STUB_EXIT after STUB_EXIT_MS (never, when 0).
	const bin = path.join(dir, 'bin', 'casparcg')
	fs.writeFileSync(
		bin,
		`#!${process.execPath}
const port = Number(process.env.CASPAR_AMCP_PORT)
const srv = require('net').createServer()
setInterval(() => {}, 1 << 30)
setTimeout(() => srv.listen(port, '0.0.0.0'), Number(process.env.STUB_UP_MS || 0))
if (process.env.STUB_DROP_MS) setTimeout(() => srv.close(), Number(process.env.STUB_DROP_MS))
const exitMs = Number(process.env.STUB_EXIT_MS || 0)
if (exitMs > 0) setTimeout(() => { srv.close(); process.exit(Number(process.env.STUB_EXIT || 0)) }, exitMs)
`,
		{ mode: 0o755 },
	)
	fs.writeFileSync(path.join(dir, 'casparcg.config'), '<configuration/>\n')
	// `sleep` wrapper: records every sleep pid the supervisor starts, so the test can prove none is orphaned.
	fs.writeFileSync(path.join(dir, 'stubs', 'sleep'), `#!/bin/sh\necho $$ >>"${dir}/sleep-pids"\nexec /bin/sleep "$@"\n`, { mode: 0o755 })
	env = {
		PATH: `${path.join(dir, 'stubs')}:${process.env.PATH}`,
		HOME: path.join(dir, 'home'),
		CASPAR_ROOT: dir,
		CASPAR_BIN: bin,
		CASPAR_CONFIG_PATH: path.join(dir, 'casparcg.config'),
		CASPAR_CEF_CACHE: path.join(dir, 'cef-cache'),
		CASPAR_SUPERVISOR_LOG: path.join(dir, 'caspar.log'),
		CASPAR_RUNSH_LOCK: path.join(dir, 'runsh.lock'),
		CASPAR_INHIBIT_FILE: path.join(dir, 'inhibit'),
		CASPAR_CRASH_STATE: path.join(dir, 'crash.state'),
		CASPAR_SCREEN_GATE_SEC: '0',
		CASPAR_RESTART_GRACE_SEC: '0',
		HIGHASCG_CONFIG_PATH: path.join(dir, 'config'),
		CASPAR_HANG_FLAG: path.join(dir, 'hang.flag'),
		DISPLAY: ':999',
	}
	// Driver for the lib-level cases: launch the stub like run_caspar does, then wait on it.
	fs.writeFileSync(
		path.join(dir, 'drive.sh'),
		`. "$CASPAR_ROOT/tools/runtime/casparcg-supervisor-lib.sh"
"$CASPAR_BIN" "$CASPAR_CONFIG_PATH" </dev/null &
_child=$!
echo "child=$_child"
caspar_wait_child_or_hang "$_child"
echo "ec=$?"
`,
	)
})

after(() => {
	if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe('WO-805: supervisor waits on the Caspar child', () => {
	it('lib: exit while AMCP is up (watcher in its 10 s sleep) is noticed at once, code passed through, no orphan sleep', async () => {
		fs.rmSync(path.join(dir, 'sleep-pids'), { force: true })
		const port = await freePort()
		const r = await runSh(path.join(dir, 'drive.sh'), {
			CASPAR_AMCP_PORT: String(port),
			STUB_UP_MS: '100',
			STUB_EXIT_MS: '2500',
			STUB_EXIT: '139',
		})
		assert.match(r.stdout, /ec=139\n/, r.stdout + r.stderr)
		// Old foreground loop: AMCP seen at the 1 s poll → `sleep 10` → exit noticed at ~11 s.
		assert.ok(r.ms < 4000, `exit must be noticed within ~1 s of 2.5 s, took ${r.ms} ms`)
		const sleeps = fs.readFileSync(path.join(dir, 'sleep-pids'), 'utf8').trim().split('\n').map(Number)
		assert.ok(sleeps.length >= 2, 'the watcher polled (1 s boot poll, then the 10 s healthy poll)')
		await new Promise((res) => setTimeout(res, 100))
		assert.deepEqual(sleeps.filter(alive), [], 'the stopped watcher must not leave its sleep behind')
		assert.ok(!fs.existsSync(env.CASPAR_HANG_FLAG), 'no hang flag on a normal exit')
	})

	it('lib: a Caspar whose AMCP never comes up is killed after CASPAR_BOOT_HANG_SEC and reported as 5', async () => {
		const port = await freePort()
		const r = await runSh(path.join(dir, 'drive.sh'), {
			CASPAR_AMCP_PORT: String(port),
			STUB_UP_MS: '600000',
			STUB_EXIT_MS: '0',
			CASPAR_BOOT_HANG_SEC: '2',
		})
		assert.match(r.stdout, /ec=5\n/, r.stdout + r.stderr)
		const child = Number(/child=(\d+)/.exec(r.stdout)[1])
		assert.equal(alive(child), false, 'the hung stub must be dead')
		assert.ok(r.ms >= 2000 && r.ms < 8000, `boot budget 2 s + TERM/2 s/KILL sweep, took ${r.ms} ms`)
		assert.match(fs.readFileSync(env.CASPAR_SUPERVISOR_LOG, 'utf8'), /hang \(2s, amcp_seen=0\) — stopping/)
		assert.ok(!fs.existsSync(env.CASPAR_HANG_FLAG), 'flag consumed')
	})

	it('lib: AMCP that drops after it was up is a hang after CASPAR_HANG_SEC (amcp_seen=1)', async () => {
		const port = await freePort()
		// AMCP served for 1.5 s, then the listener closes while the process keeps running (a hung Caspar). The drop is
		// seen at the next healthy poll (≤ 10 s, the WO-398 budget), then CASPAR_HANG_SEC, then the TERM/KILL sweep.
		const r = await runSh(path.join(dir, 'drive.sh'), {
			CASPAR_AMCP_PORT: String(port),
			STUB_UP_MS: '0',
			STUB_DROP_MS: '1500',
			STUB_EXIT_MS: '0',
			CASPAR_HANG_SEC: '2',
		})
		assert.match(r.stdout, /ec=5\n/, r.stdout + r.stderr)
		assert.equal(alive(Number(/child=(\d+)/.exec(r.stdout)[1])), false, 'the hung stub must be dead')
		assert.match(fs.readFileSync(env.CASPAR_SUPERVISOR_LOG, 'utf8'), /hang \(2s, amcp_seen=1\) — stopping/)
	})

	it('run.sh end to end: Caspar exit with AMCP up returns from the supervisor at once', async () => {
		const port = await freePort()
		const r = await runSh(RUN_SH, {
			CASPAR_AMCP_PORT: String(port),
			CASPAR_RESTART_EXIT_CODES: '5', // 7 is not a restart code → run.sh exits with it
			STUB_UP_MS: '100',
			STUB_EXIT_MS: '2500',
			STUB_EXIT: '7',
		})
		assert.equal(r.code, 7, r.stdout + r.stderr)
		assert.ok(r.ms < 4500, `run.sh must return ~at the 2.5 s exit (old loop: ~11 s), took ${r.ms} ms`)
	})

	it('sources: run.sh delegates to the lib, the marker path has no fixed sleep', () => {
		const run = fs.readFileSync(RUN_SH, 'utf8')
		const fn = run.slice(run.indexOf('run_caspar()'), run.indexOf('while :; do'))
		assert.match(fn, /"\$CASPAR_BIN" "\$CONFIG_PATH" "\$@" <\/dev\/null &\n\t_child=\$!\n[\s\S]*caspar_wait_child_or_hang "\$_child"\n\}/)
		assert.doesNotMatch(fn, /while kill -0/, 'the foreground poll loop must stay gone')
		const marker = run.slice(run.indexOf('_marker="/tmp/caspar-operator-restart"'), run.indexOf('caspar_crash_loop_backoff "$ec"'))
		assert.match(marker, /CASPAR_SKIP_GRACE_ONCE=1/)
		assert.doesNotMatch(marker, /\n\t\tsleep /, 'no fixed sleep before the operator fast relaunch')
		for (const f of [RUN_SH, LIB]) assert.equal(spawnSync('/bin/sh', ['-n', f]).status, 0, `${f} parses under /bin/sh`)
	})
})
