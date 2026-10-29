'use strict'

/**
 * WO-805 live e2e 29.10: the first Apply after a node restart sent RESTART, the old casparcg was still in its exit
 * (SEGV stack dump) after the 1 s settle, so the node ran `caspar-kill-main.sh` (CASPAR_KILL_FAST=1). That script
 * listed the casparcg PIDs again for the KILL a second after the TERM; by then run.sh (WO-805: relaunch ~0.25 s after
 * the exit) had started the NEW instance, which got SIGKILL → run.sh exit 137 → unit failed → systemd start (+~4 s).
 * Runs the real script against fake casparcg processes (own binary path, config path and AMCP port).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')

const ROOT = path.join(__dirname, '../..')
const SCRIPT = path.join(ROOT, 'tools/runtime/caspar-kill-main.sh')

function alive(pid) {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

function fakeCaspar(bin, cfg) {
	const p = spawn('/bin/sh', [bin, cfg], { detached: true, stdio: 'ignore' })
	p.unref()
	return p
}

function runKill(env) {
	return new Promise((resolve) => {
		execFile('bash', [SCRIPT], { env: { ...process.env, ...env }, timeout: 20_000 }, (err) => resolve(err))
	})
}

describe('WO-805 fast kill leaves the relaunched casparcg alone', () => {
	it('the instance run.sh starts during the TERM→KILL second survives; the old one is gone', async () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo805-kill-'))
		const bin = path.join(tmp, 'bin', 'casparcg')
		const cfg = path.join(tmp, 'casparcg.config')
		fs.mkdirSync(path.dirname(bin))
		fs.writeFileSync(bin, '#!/bin/sh\nwhile :; do sleep 0.1; done\n', { mode: 0o755 })
		fs.writeFileSync(cfg, '')
		const env = {
			CASPAR_ROOT: ROOT,
			CASPAR_BIN: bin,
			CONFIG_PATH: cfg,
			CASPAR_KILL_FAST: '1',
			CASPAR_AMCP_PORT: '59991', // nothing listens: the port-free wait returns at once
			CASPAR_CEF_CACHE: path.join(tmp, 'no-cef-cache'),
			CASPAR_SUPERVISOR_LOG: path.join(tmp, 'supervisor.log'),
		}
		const old = fakeCaspar(bin, cfg)
		let relaunch = null
		try {
			await new Promise((r) => setTimeout(r, 200))
			const done = runKill(env)
			await new Promise((r) => setTimeout(r, 500)) // after the TERM, before the KILL
			relaunch = fakeCaspar(bin, cfg)
			await done
			await new Promise((r) => setTimeout(r, 100))
			assert.equal(alive(old.pid), false, 'the old instance is killed')
			assert.equal(alive(relaunch.pid), true, 'the relaunched instance is NOT killed')
			const log = fs.readFileSync(env.CASPAR_SUPERVISOR_LOG, 'utf8')
			assert.match(log, new RegExp(`fast kill of:.*\\b${old.pid}\\b`))
			assert.doesNotMatch(log.split('\n').find((l) => l.includes('fast kill of:')) || '', new RegExp(`\\b${relaunch.pid}\\b`))
			assert.match(log, /relaunched casparcg already up/)
		} finally {
			for (const p of [old, relaunch]) {
				if (p && alive(p.pid)) {
					try {
						process.kill(-p.pid, 'SIGKILL')
					} catch {
						/* gone */
					}
				}
			}
			fs.rmSync(tmp, { recursive: true, force: true })
		}
	})

	it('the PIDs are listed once, before the TERM (source)', () => {
		const src = fs.readFileSync(SCRIPT, 'utf8')
		const fast = src.slice(src.indexOf('CASPAR_KILL_FAST'), src.indexOf('else\n\tcaspar_ensure_fully_stopped'))
		assert.doesNotMatch(fast, /caspar_kill_all_processes/, 'no re-listing kill helper in the fast path')
		assert.ok(fast.indexOf('_snap=') < fast.indexOf('kill -TERM'), 'snapshot before TERM')
	})
})
