'use strict'

/**
 * WO-444: caspar-env (CASPAR_GL_SYNC_DISPLAY → __GL_SYNC_DISPLAY_DEVICE, WO-407/439) is
 * rewritten on every config Apply — but run.sh sourced it ONCE at supervisor start, and an
 * Apply only respawns the caspar binary inside the supervisor's stale environment. Proven
 * live 06.08: the owner's Apply wrote DP-0 to the file at 14:03:23, caspar relaunched at
 * 14:03:29, and the new process had NO GL_SYNC var. The env must be sourced per LAUNCH.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const RUN_SH = fs.readFileSync(path.join(__dirname, '..', '..', 'run.sh'), 'utf8')

test('WO-444: run_caspar sources caspar-env before every launch', () => {
	const m = /run_caspar\(\) \{\n([\s\S]*?)"\$CASPAR_BIN"/.exec(RUN_SH)
	assert.ok(m, 'run_caspar still launches $CASPAR_BIN')
	assert.match(
		m[1],
		/source_caspar_env/,
		'an Apply-time caspar-env change must reach the NEXT caspar launch, not wait for a service restart',
	)
})

test('WO-444: sourcing clears stale values so a removed line also clears the export', () => {
	const fn = /source_caspar_env\(\) \{\n([\s\S]*?)\n\}/.exec(RUN_SH)
	assert.ok(fn, 'source_caspar_env helper exists')
	assert.match(fn[1], /unset CASPAR_GL_SYNC_DISPLAY/, 'clear before source — shell vars persist across sourcing')
	assert.match(fn[1], /unset __GL_SYNC_DISPLAY_DEVICE/, 'no line in the file → the export must go away (auto=off)')
	assert.match(fn[1], /export __GL_SYNC_DISPLAY_DEVICE="\$CASPAR_GL_SYNC_DISPLAY"/)
})

test('WO-906: CASPAR_DISPLAY in caspar-env moves the launch to the playout X screen; removed → the unit DISPLAY again', () => {
	const { execFileSync } = require('child_process')
	const os = require('os')
	const fn = /source_caspar_env\(\) \{\n[\s\S]*?\n\}/.exec(RUN_SH)[0]
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wo906-env-'))
	fs.mkdirSync(path.join(home, '.config', 'highascg'), { recursive: true })
	const envFile = path.join(home, '.config', 'highascg', 'caspar-env')
	const run = () =>
		execFileSync('/bin/sh', ['-c', `CASPAR_BASE_DISPLAY="$DISPLAY"\n${fn}\nsource_caspar_env; printf %s "$DISPLAY"`], {
			env: { HOME: home, DISPLAY: ':0', PATH: process.env.PATH },
		}).toString()
	try {
		fs.writeFileSync(envFile, 'CASPAR_GL_SYNC_DISPLAY=DP-0\nCASPAR_DISPLAY=:0.1\n')
		assert.equal(run(), ':0.1')
		fs.writeFileSync(envFile, 'CASPAR_GL_SYNC_DISPLAY=DP-0\n')
		assert.equal(run(), ':0', 'no line → the unit DISPLAY')
	} finally {
		fs.rmSync(home, { recursive: true, force: true })
	}
	assert.match(RUN_SH, /export DISPLAY="\$\{DISPLAY:-:0\}"\nCASPAR_BASE_DISPLAY="\$DISPLAY"/)
})
