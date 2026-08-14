'use strict'

/**
 * WO-499 — a failed Web-UI update must never leave the playout box down.
 *
 * Owner 12.08: *"it seems the update process via gui fails. because it stopped the highascg process
 * and never started it back again."*
 *
 * `highascg-webui-server-update.sh` runs `set -euo pipefail` and calls `stop_service` BEFORE
 * applying. Every step after that — the apply itself, staging the drop to the exFAT stick, the
 * config push — could exit non-zero and abort the script, skipping `start_service` entirely. The
 * box then sits with no operator UI, which is the one tool you would use to recover it.
 *
 * These tests execute the REAL script with `systemctl` stubbed on PATH, so they exercise the
 * shipped control flow rather than a restatement of it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '../..')
const HELPER = path.join(REPO, 'scripts/exfat/highascg-webui-server-update.sh')

/**
 * Run the helper with fake root, a fake systemctl that records calls, and a fake apply script.
 * @param {{ applyExit: number }} opts
 * @returns {{ code: number, calls: string[], log: string }}
 */
function runHelper(opts) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo499-'))
	const bin = path.join(tmp, 'bin')
	// `validate_source_path` only accepts the real cache root or /tmp/highascg-updates/* — an
	// arbitrary temp dir is refused before the service is ever stopped, so the source must live
	// under one of them for this to exercise the real control flow.
	const src = fs.mkdtempSync(
		path.join(fs.mkdirSync('/tmp/highascg-updates', { recursive: true }) || '/tmp/highascg-updates', 'extract-'),
	)
	const dst = path.join(tmp, 'highascg')
	fs.mkdirSync(bin, { recursive: true })
	fs.mkdirSync(src, { recursive: true })
	fs.mkdirSync(dst, { recursive: true })
	// start_service only runs when the destination looks like a real install.
	fs.writeFileSync(path.join(dst, 'package.json'), '{}')

	const calls = path.join(tmp, 'systemctl-calls.txt')
	fs.writeFileSync(
		path.join(bin, 'systemctl'),
		`#!/usr/bin/env bash\necho "$@" >> ${JSON.stringify(calls)}\n` +
			// "is-active" must report ACTIVE first (so the script stops it), then inactive.
			`if [[ "$1" == "is-active" || "$2" == "is-active" ]]; then\n` +
			`  if [[ -f ${JSON.stringify(path.join(tmp, 'stopped'))} ]]; then exit 3; fi\n  exit 0\nfi\n` +
			`if [[ "$1" == "stop" ]]; then touch ${JSON.stringify(path.join(tmp, 'stopped'))}; fi\n` +
			`if [[ "$1" == "start" ]]; then rm -f ${JSON.stringify(path.join(tmp, 'stopped'))}; fi\nexit 0\n`,
		{ mode: 0o755 },
	)
	for (const stub of ['mountpoint', 'chown', 'rsync', 'install', 'id', 'getent', 'node']) {
		fs.writeFileSync(path.join(bin, stub), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
	}
	// `id -u` must say root; `id -gn` must name a group.
	fs.writeFileSync(
		path.join(bin, 'id'),
		'#!/usr/bin/env bash\nif [[ "$1" == "-u" ]]; then echo 0; else echo casparcg; fi\nexit 0\n',
		{ mode: 0o755 },
	)
	const apply = path.join(tmp, 'apply.sh')
	fs.writeFileSync(apply, `#!/usr/bin/env bash\nexit ${opts.applyExit}\n`, { mode: 0o755 })

	// The helper logs to STDERR, so both streams must be captured on success and failure alike.
	const r = spawnSync('bash', [HELPER, '--source', src], {
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			HIGHASCG_APPLY_SERVER_DROP_SH: apply,
			HIGHASCG_SERVICE_USER: 'casparcg',
			// WO-538: without this the helper's DST fell back to the REAL install, so these
			// assertions passed on the box and failed on any clean machine.
			HIGHASCG_UPDATE_DEST: dst,
		},
	})
	const code = r.status ?? 1
	const log = `${r.stdout || ''}${r.stderr || ''}`
	const recorded = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) : []
	fs.rmSync(tmp, { recursive: true, force: true })
	fs.rmSync(src, { recursive: true, force: true })
	return { code, calls: recorded, log }
}

test('WO-499: when the apply FAILS, the service is still started again', () => {
	const r = runHelper({ applyExit: 1 })
	assert.notEqual(r.code, 0, 'the failure must still surface to the Web UI job log')
	assert.ok(r.calls.some((c) => c.startsWith('stop ')), `expected a stop, got ${JSON.stringify(r.calls)}`)
	assert.ok(
		r.calls.some((c) => c.startsWith('start ')),
		`THE BUG: apply failed and the box was left down. calls=${JSON.stringify(r.calls)}`,
	)
	assert.match(r.log, /restarting .* so the box does not stay down/)
})

test('WO-499: a successful apply starts the service exactly as before', () => {
	const r = runHelper({ applyExit: 0 })
	assert.equal(r.code, 0)
	assert.ok(r.calls.some((c) => c.startsWith('stop ')))
	assert.ok(r.calls.some((c) => c.startsWith('start ')))
	assert.match(r.log, /web UI update complete/)
})

test('WO-499: the failing exit code is preserved, not swallowed by the trap', () => {
	assert.equal(runHelper({ applyExit: 3 }).code, 3, 'the GUI must still see the update as failed')
})

test('WO-499: exFAT staging drops owner/group flags that exFAT cannot honour', () => {
	const src = fs.readFileSync(HELPER, 'utf8')
	const stage = src.slice(src.indexOf('stage_drop_to_volume() {'), src.indexOf('push_drop_config()'))
	assert.match(stage, /--modify-window=2/, 'exFAT timestamps are 2 s granular')
	assert.equal(
		/rsync[^\n]*-rlptgoD/.test(stage),
		false,
		'-go makes rsync attempt a chown exFAT refuses, exiting 23 and aborting the update',
	)
	assert.match(stage, /continuing — the server itself is already updated/, 'staging must be best-effort')
})
