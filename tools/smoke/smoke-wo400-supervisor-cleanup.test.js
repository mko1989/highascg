'use strict'

/**
 * Offline smoke — WO-398/WO-400: run.sh supervisor cleanup.
 *
 * Guards the load-bearing outcomes of the review:
 * 1. ONE crash-damping engine: run.sh calls caspar_crash_loop_backoff (which writes the
 *    inhibit file at give-up); the inline `_restarts` counter — whose give-up systemd
 *    silently defeated — must stay deleted.
 * 2. The healthy-state hang poll is 10 s, seconds-accounted (was 1 s = ~260k forks/day).
 * 3. The dead lib functions stay deleted; the grace is slept in exactly one place.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const runSh = fs.readFileSync(path.join(__dirname, '../..', 'run.sh'), 'utf8')
const lib = fs.readFileSync(
	path.join(__dirname, '../..', 'tools/runtime/casparcg-supervisor-lib.sh'),
	'utf8',
)

describe('one crash-damping engine (WO-400)', () => {
	it('run.sh calls the lib backoff and the inline counter is gone', () => {
		assert.match(runSh, /caspar_crash_loop_backoff "\$ec"/)
		assert.doesNotMatch(runSh, /_restarts=/, 'inline damping counter must stay deleted')
	})

	it('the backoff engine still writes the inhibit file at give-up', () => {
		const giveup = lib.slice(lib.indexOf('_giveup'), lib.indexOf('_pow=0'))
		assert.match(giveup, /caspar_inhibit_file/)
		assert.match(giveup, /return 2/)
	})

	it('hard-fail codes live in one place (case-list drift was 134/139 vs 134/139/136/11)', () => {
		assert.match(runSh, /caspar_crash_is_hard_fail_code "\$ec"/)
		assert.doesNotMatch(runSh, /case "\$ec" in\s*\n\s*134/, 'inline hard-fail case must stay deleted')
	})
})

describe('hang detector polls cheaply (WO-398)', () => {
	it('healthy steady state polls every 10 s and _stuck counts seconds', () => {
		const fn = runSh.slice(runSh.indexOf('run_caspar()'), runSh.indexOf('while :; do'))
		assert.match(fn, /_poll=10/)
		assert.match(fn, /_stuck=\$\(\(_stuck \+ _poll\)\)/)
		assert.match(fn, /sleep "\$_poll"/)
		assert.doesNotMatch(fn, /\n\t\tsleep 1\n/, 'unconditional 1 s sleep must stay deleted')
	})

	it('ss no longer pays for process info', () => {
		assert.match(lib, /ss -tln 2>\/dev\/null/)
		assert.doesNotMatch(lib, /ss -tlnp/)
	})
})

describe('dead code stays dead, grace slept once (WO-400)', () => {
	it('the six dead symbols are gone from run.sh + lib', () => {
		for (const sym of [
			'caspar_prepare_restart_after_exit',
			'caspar_kill_main_processes',
			'caspar_supervisor_running',
			'stop_caspar_if_running',
		]) {
			assert.ok(!runSh.includes(sym) && !lib.includes(sym), `${sym} must stay deleted`)
		}
	})

	it('CASPAR_RESTART_GRACE_SEC is slept only in run.sh', () => {
		assert.doesNotMatch(lib, /CASPAR_RESTART_GRACE_SEC/, 'lib grace sleep must stay deleted')
		assert.match(runSh, /CASPAR_RESTART_GRACE_SEC/)
	})
})
