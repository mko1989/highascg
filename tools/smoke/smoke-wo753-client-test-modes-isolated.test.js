'use strict'

/**
 * WO-753 — `run-client.sh --test` / `--check` run Godot with a throwaway user:// (XDG_DATA_HOME), removed afterwards.
 * Found on the kiosk boxes: both modes shared the kiosk's user dir, so a test run truncated the running kiosk's
 * godot.log (the sweep then read the tests' errors as the kiosk's) and a boot check saved its ui.cfg over the kiosk's.
 * A stand-in Godot writes down the XDG_DATA_HOME it was given (--check keeps Godot's output to itself).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, '..', '..', 'godot', 'client', 'run-client.sh')

function run(mode, exitCode) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo753-client-'))
	try {
		const fake = path.join(dir, 'godot')
		const report = path.join(dir, 'report')
		fs.writeFileSync(fake, `#!/usr/bin/env bash\n{ echo "XDG=$XDG_DATA_HOME"; [[ -d "$XDG_DATA_HOME" ]] && echo exists; } > "${report}"\nexit ${exitCode}\n`, { mode: 0o755 })
		const env = { ...process.env, GODOT: fake, XDG_DATA_HOME: path.join(dir, 'kiosk-data'), TMPDIR: dir }
		const r = spawnSync('bash', [SCRIPT, mode], { env, encoding: 'utf8', timeout: 60000 })
		const out = fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : ''
		const xdg = (out.match(/^XDG=(.*)$/m) || [])[1] || ''
		return { r, xdg, existed: /^exists$/m.test(out), left: xdg && fs.existsSync(xdg), dir }
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
}

for (const mode of ['--test', '--check']) {
	test(`${mode} gets its own user:// and removes it`, () => {
		const { xdg, existed, left, dir } = run(mode, 0)
		assert.ok(xdg.startsWith(path.join(dir, 'highascg-client-')), `XDG_DATA_HOME was ${xdg}`)
		assert.ok(existed, 'the throwaway dir exists while Godot runs')
		assert.equal(left, false, 'removed afterwards')
	})
}

test('--test still exits with the failure count', () => {
	assert.equal(run('--test', 3).r.status, 3)
})
