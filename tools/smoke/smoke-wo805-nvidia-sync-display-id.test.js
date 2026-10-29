'use strict'

/**
 * WO-805 live e2e 29.10: after an Apply, `nvidia-settings -q XVideoSyncToDisplayID` still read -1 with port 3 (DP-4)
 * ticked "NVIDIA sync to display", although the deferred run got HIGHASCG_NVIDIA_SYNC_OUTPUT=DP-4. The script parsed
 * `nvidia-settings -q dpys` with `python3 - <<'PY'`: the heredoc is python's stdin, so the pipe was never read, the id
 * stayed empty and the function returned silently. This runs the script's function against a fake nvidia-settings.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, '../../tools/runtime/highascg-nvidia-x-apply.sh')

const DPYS = `
8 Display Devices on box:0

    [0] box:0[dpy:0] (DP-0) (connected, enabled)
    [3] box:0[dpy:3] (HDMI-0) (disconnected)
    [4] box:0[dpy:6] (DP-4) (connected, enabled)
`

function runSyncFunction(syncOutput) {
	const src = fs.readFileSync(SCRIPT, 'utf8')
	const from = src.indexOf('_apply_sync_to_display() {')
	const to = src.indexOf('\n}\n', from)
	assert.ok(from >= 0 && to > from, 'function present')
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo805-sync-'))
	try {
		const log = path.join(tmp, 'calls.log')
		const fake = path.join(tmp, 'nvidia-settings')
		fs.writeFileSync(path.join(tmp, 'dpys.txt'), DPYS)
		fs.writeFileSync(
			fake,
			`#!/bin/bash\necho "$*" >> '${log}'\n[ "$1" = "-q" ] && [ "$2" = "dpys" ] && cat '${path.join(tmp, 'dpys.txt')}'\nexit 0\n`,
			{ mode: 0o755 },
		)
		const body = `${src.slice(from, to + 3)}\n_apply_sync_to_display\n`
		execFileSync('bash', ['-c', body], {
			env: { PATH: `${tmp}:${process.env.PATH}`, HIGHASCG_NVIDIA_SYNC_OUTPUT: syncOutput },
		})
		return fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
}

describe('WO-805 the NVIDIA script sets XVideoSyncToDisplayID for the ticked port', () => {
	it('DP-4 ticked → assigns the [dpy:N] target id (6), not the list index (4)', () => {
		const calls = runSyncFunction('DP-4')
		assert.match(calls, /-a \[screen:0\]\/XVideoSyncToDisplayID=6\n/)
		assert.match(calls, /--save/)
	})

	it('a port that is not listed assigns nothing', () => {
		assert.doesNotMatch(runSyncFunction('DP-9'), /XVideoSyncToDisplayID/)
	})

	it('the dpys parser gets no heredoc (it would become its stdin; the MetaMode heredocs read argv only)', () => {
		const src = fs.readFileSync(SCRIPT, 'utf8')
		const fn = src.slice(src.indexOf('_apply_sync_to_display() {'), src.indexOf('\n}\n', src.indexOf('_apply_sync_to_display() {')))
		assert.match(fn, /nvidia-settings -q dpys[^\n]*\| python3 -c/)
		assert.doesNotMatch(fn.replace(/^\s*#.*$/gm, ''), /<</)
	})
})
