'use strict'

/**
 * WO-501 — the Web-UI update must not be killed by the service stop it performs itself.
 *
 * Owner 13.08: *"the update from gui failed. it stopped highascg before doing the update. this needs
 * a seperate process/script to be run that will do the update so its not killed by stopping
 * highascg."*
 *
 * Node launches the helper via `sudo`, and a sudo child inherits the caller's cgroup — so the
 * helper runs inside `highascg.service`. The instant it calls `systemctl stop highascg.service`,
 * systemd kills every process in that cgroup, including the helper. The apply never happens and
 * WO-499's EXIT trap never runs, so the box is left stopped AND un-updated.
 *
 * `--detach` hands the work to a transient systemd unit (system.slice, outside our cgroup) and
 * returns immediately. These tests execute the REAL script with `systemd-run` and `systemctl`
 * stubbed on PATH, so they exercise the shipped control flow.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '../..')
const HELPER = path.join(REPO, 'scripts/exfat/highascg-webui-server-update.sh')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * @param {{ args: string[], badSource?: boolean }} opts
 * @returns {{ code: number, log: string, systemctl: string[], systemdRun: string }}
 */
function runHelper(opts) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo501-'))
	const bin = path.join(tmp, 'bin')
	const logDir = path.join(tmp, 'log')
	fs.mkdirSync(bin, { recursive: true })
	fs.mkdirSync(logDir, { recursive: true })
	fs.mkdirSync('/tmp/highascg-updates', { recursive: true })
	// validate_source_path only accepts the real cache root or /tmp/highascg-updates/*.
	const src = opts.badSource
		? path.join(tmp, 'not-in-cache')
		: fs.mkdtempSync(path.join('/tmp/highascg-updates', 'extract-'))
	fs.mkdirSync(src, { recursive: true })
	const dst = path.join(tmp, 'highascg')
	fs.mkdirSync(dst, { recursive: true })
	fs.writeFileSync(path.join(dst, 'package.json'), '{}')

	const sysctlCalls = path.join(tmp, 'systemctl-calls.txt')
	fs.writeFileSync(
		path.join(bin, 'systemctl'),
		`#!/usr/bin/env bash\necho "$@" >> ${JSON.stringify(sysctlCalls)}\n` +
			`if [[ "$1" == "is-active" || "$2" == "is-active" ]]; then exit 0; fi\nexit 0\n`,
		{ mode: 0o755 },
	)
	const runCalls = path.join(tmp, 'systemd-run-calls.txt')
	fs.writeFileSync(
		path.join(bin, 'systemd-run'),
		`#!/usr/bin/env bash\necho "$@" >> ${JSON.stringify(runCalls)}\nexit 0\n`,
		{ mode: 0o755 },
	)
	for (const stub of ['mountpoint', 'chown', 'rsync', 'getent', 'node']) {
		fs.writeFileSync(path.join(bin, stub), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
	}
	fs.writeFileSync(path.join(bin, 'install'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
	fs.writeFileSync(
		path.join(bin, 'id'),
		'#!/usr/bin/env bash\nif [[ "$1" == "-u" ]]; then echo 0; else echo casparcg; fi\nexit 0\n',
		{ mode: 0o755 },
	)
	const apply = path.join(tmp, 'apply.sh')
	fs.writeFileSync(apply, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })

	const r = spawnSync('bash', [HELPER, ...opts.args.map((a) => (a === '@SRC' ? src : a))], {
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			HIGHASCG_APPLY_SERVER_DROP_SH: apply,
			HIGHASCG_SERVICE_USER: 'casparcg',
			HIGHASCG_UPDATE_LOG_DIR: logDir,
		},
	})
	const out = {
		code: r.status ?? 1,
		log: `${r.stdout || ''}${r.stderr || ''}`,
		systemctl: fs.existsSync(sysctlCalls)
			? fs.readFileSync(sysctlCalls, 'utf8').trim().split('\n').filter(Boolean)
			: [],
		systemdRun: fs.existsSync(runCalls) ? fs.readFileSync(runCalls, 'utf8').trim() : '',
	}
	fs.rmSync(tmp, { recursive: true, force: true })
	fs.rmSync(src, { recursive: true, force: true })
	return out
}

test('WO-501: --detach hands off to systemd-run and stops NOTHING itself', () => {
	const r = runHelper({ args: ['--detach', '--source', '@SRC'] })
	assert.equal(r.code, 0, `detach must return success immediately: ${r.log}`)
	assert.ok(r.systemdRun, 'systemd-run must be invoked')
	assert.equal(
		r.systemctl.filter((c) => c.startsWith('stop ')).length,
		0,
		`THE BUG: the caller stopped the service in its own cgroup. calls=${JSON.stringify(r.systemctl)}`,
	)
})

test('WO-501: the transient unit is collected and NOT waited on', () => {
	const r = runHelper({ args: ['--detach', '--source', '@SRC'] })
	assert.match(r.systemdRun, /--unit=highascg-update-/, 'a named transient unit')
	assert.match(r.systemdRun, /--collect/, 'the unit must be reaped after it exits')
	assert.doesNotMatch(
		r.systemdRun,
		/--wait/,
		'--wait would block the caller until the update finished, re-creating the kill window',
	)
	assert.match(r.systemdRun, /--source/, 'the detached run must receive the source dir')
})

test('WO-501: the detached run logs to a file, not the caller pipe', () => {
	const r = runHelper({ args: ['--detach', '--source', '@SRC'] })
	// The caller is about to be killed, so its pipe cannot be where progress goes.
	assert.match(r.systemdRun, /StandardOutput=append:/)
	assert.match(r.systemdRun, /StandardError=append:/)
})

test('WO-501: a machine-readable handoff line names the unit and the log', () => {
	const r = runHelper({ args: ['--detach', '--source', '@SRC'] })
	const m = /HIGHASCG_UPDATE_DETACHED unit=(\S+) log=(\S+)/.exec(r.log)
	assert.ok(m, `the Node side parses this line; got: ${r.log}`)
	assert.match(m[1], /^highascg-update-/)
	assert.match(m[2], /update-.*\.log$/)
})

test('WO-501: a bad source is rejected BEFORE detaching', () => {
	const r = runHelper({ args: ['--detach', '--source', '@SRC'], badSource: true })
	assert.notEqual(r.code, 0, 'must fail synchronously so the UI sees the error')
	assert.equal(r.systemdRun, '', 'nothing may be detached for a source we already know is invalid')
})

test('WO-501: without --detach the WO-499 flow is unchanged', () => {
	const r = runHelper({ args: ['--source', '@SRC'] })
	assert.equal(r.code, 0)
	assert.ok(r.systemctl.some((c) => c.startsWith('stop ')), 'attached mode still stops')
	assert.ok(r.systemctl.some((c) => c.startsWith('start ')), 'attached mode still starts (WO-499)')
	assert.equal(r.systemdRun, '', 'no detach unless asked')
})

test('WO-501: the Node side asks for --detach and parses the handoff', () => {
	const src = code(read('src/system/server-update.js'))
	assert.match(src, /'--detach'/, 'runApplyHelper must pass --detach')
	assert.match(src, /HIGHASCG_UPDATE_DETACHED/, 'and parse the handoff line')
	assert.match(src, /phase = 'detached'/, 'and report a distinct phase, not a false "done"')
})
