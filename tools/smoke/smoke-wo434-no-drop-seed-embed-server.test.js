'use strict'

/**
 * WO-434 — embed-server sticks must not seed drop-update/ (same-version dead weight
 * that becomes a downgrade grenade as the stick ages — WO-433 addendum poisoned a
 * produce this way). Seeding stays for WO-47 exFAT-only ISOs and explicit
 * HIGHASCG_SEED_DROP_UPDATE=1 sneakernet sticks. Stick QA must tolerate the missing
 * drop when the squashfs embeds the server. Also pins the exFAT rsync contract in the
 * seed script (no -a on exFAT; machine-local config never rides a stick).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('WO-434: flash gates the drop seed on embed mode / explicit opt-in', () => {
	const s = read('tools/eggs/live-usb/create-operator-stick-from-dd.sh')
	assert.match(
		s,
		/HIGHASCG_ISO_EMBED_SERVER:-1[^\n]*==[^\n]*"0"[^\n]*\|\|[^\n]*HIGHASCG_SEED_DROP_UPDATE:-0[^\n]*==[^\n]*"1"/,
		'seed runs only for exFAT-only ISOs or explicit HIGHASCG_SEED_DROP_UPDATE=1'
	)
	assert.ok(s.includes('skip: embed-server ISO already contains the server'), 'skip note printed')
})

test('WO-434: stick QA test-04 tolerates a missing drop on embed-server sticks', () => {
	const t = read('tools/startup/stick-boot-test/tests/test-04-drop-update.sh')
	assert.ok(t.includes('${PLAYOUT}/index.js'), 'checks the embedded server before failing')
	assert.ok(t.includes('no drop-update/ (embed-server stick, WO-434)'), 'passes without a drop')
	assert.ok(t.includes('missing ${DROP}/ and no embedded server'), 'still fails when neither exists')
})

test('WO-434: seed script keeps the exFAT rsync contract (no -a, machine-local excluded)', () => {
	const s = read('tools/eggs/live-usb/seed-stick-drop-update-from-host.sh')
	assert.ok(s.includes('rsync -rLt --modify-window=2'), 'exFAT uses -rLt --modify-window=2')
	for (const ex of [
		'--exclude=exfat-sync.json',
		'--exclude=hardware-identity.json',
		'--exclude=replication-local-identity.json',
		'--exclude=tailscale.json',
		'--delete-excluded',
	]) {
		assert.ok(s.includes(ex), `seed excludes ${ex}`)
	}
})
