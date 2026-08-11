'use strict'

/**
 * WO-423 — launching Calamares from Settings stops CasparCG + HighAsCG (owner: "only the
 * installer is on the screen") and restarts them when the installer exits; the launcher
 * re-execs into a transient systemd unit first so stopping highascg.service can't kill it.
 *
 * WO-424 — the shipped GUI update flow was dead end-to-end: server builds are PRERELEASES
 * which GitHub's /releases/latest never returns, and the stamp comparator sorted the fleet's
 * mixed formats backwards (`-` < `.` in ASCII). Both fixed; download path hardened
 * (review 03.08 config §5: unhandled stream errors / stalled-body wedge).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { compareBuildStamps } = require('../../src/system/build-stamp')

test('WO-423: launcher stops the stack, restarts it after, and survives its own stop', () => {
	const rel = 'tools/runtime/launch-calamares.sh'
	execFileSync('bash', ['-n', path.join(ROOT, rel)]) // syntax
	const src = read(rel)
	// Re-exec guard must come BEFORE any systemctl stop — else the stop kills the script.
	const reexecAt = src.indexOf('exec systemd-run')
	const stopAt = src.indexOf('systemctl stop "')
	assert.ok(reexecAt > 0 && stopAt > 0 && reexecAt < stopAt, 'transient-unit re-exec precedes the stop')
	assert.match(src, /HIGHASCG_CAL_SCOPED/, 're-exec is guarded against recursion')
	for (const unit of ['casparcg-server.service', 'highascg.service']) {
		assert.ok(src.includes(unit), `${unit} in the stop/start lists`)
	}
	const stopBlock = src.slice(stopAt)
	assert.ok(stopBlock.indexOf('CALAMARES_BIN') > 0, 'stop happens before the installer launches')
	assert.match(src, /systemctl start/, 'stack restarts when the installer exits')
	const launchAt = src.indexOf('"${CALAMARES_BIN}" -d')
	/* The PLAYOUT restart loop specifically. A bare `systemctl start` search would now hit
	 * WO-475's restore_bridge() body, which is defined above the launch — the mounts it brings
	 * back are a different concern from the stack coming up. */
	const startAt = src.indexOf('for unit in highascg.service casparcg-server.service casparcg-scanner.service')
	assert.ok(startAt > 0, 'the playout restart loop is still there')
	assert.ok(launchAt > 0 && startAt > launchAt, 'restart comes after the installer run')

	const modal = read('client/components/settings-modal.js')
	assert.match(modal, /will CLOSE so only the installer is on screen/, 'operator is warned before launch')
})

test('WO-424: mixed-format build stamps compare by date, not ASCII accident', () => {
	// The real fleet case: dotted package.json fallback vs dashed release stamp.
	assert.ok(compareBuildStamps('2026-06-28T172842Z', '2026.05.20') > 0, 'newer dashed beats older dotted')
	assert.ok(compareBuildStamps('2026.05.20', '2026-06-28T172842Z') < 0)
	assert.ok(compareBuildStamps('2026-07-01_090000', '2026.06.30') > 0)
	// Existing contract untouched.
	assert.ok(compareBuildStamps('2026-06-28T120000Z', '2026-06-27T120000Z') > 0)
	assert.equal(compareBuildStamps('2026-06-28T120000Z', '2026-06-28T120000Z'), 0)
})

test('WO-424: update check scans the release list; download settles every failure path', () => {
	const src = read('src/system/server-update.js')
	assert.match(src, /releases\?per_page=/, 'checker lists releases instead of /releases/latest')
	assert.match(src, /cand\?\.draft/, 'drafts skipped')
	assert.ok(!/releases\/latest`\)/.test(src), 'the prerelease-blind endpoint is gone from the fetch')

	const dl = src.slice(src.indexOf('async function downloadFile'), src.indexOf('function appendJobLog'))
	assert.match(dl, /file\.on\('error'/, 'write-stream error handled (disk-full ≠ process.exit)')
	assert.match(dl, /res\.on\('error'/, 'response-stream error handled')
	assert.match(dl, /req\.destroy\(new Error\('Download stalled/, 'stalled body fails the job instead of wedging it')
	assert.match(dl, /fs\.unlinkSync\(destPath\)/, 'partial file cleaned on failure')
	assert.match(dl, /too many redirects/, 'redirect loop bounded')
})
