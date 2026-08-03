'use strict'

/**
 * WO-417 smoke — Calamares session-log rescue: a bootloader (exec-phase) failure
 * aborts the sequence BEFORE shellprocess@logs, so session.log dies with the live
 * tmpfs. A live-only systemd unit mirrors it to the stick's HIGHASCGEXF exFAT
 * every ~20 s so failed installs stay diagnosable. Pins both sides of the wiring;
 * the copy loop itself was proven with a stubbed blkid/findmnt harness (see WO).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('WO-417: rescue script copies session.log to HIGHASCGEXF, never unmounts system mounts', () => {
	const rescue = read('tools/eggs/live-usb/calamares-session-log-rescue.sh')
	assert.match(rescue, /LABEL=HIGHASCGEXF/, 'targets the operator exFAT label')
	assert.match(rescue, /\.cache\/calamares\/session\.log/, 'watches the calamares session log')
	assert.match(rescue, /calamares-session-\$\(hostname\)\.log/, 'per-host log name on the stick')
	// If the system (WO-413 poller / WO-47 units) already mounted the exFAT, the
	// loop must reuse that mount and must ONLY unmount what it mounted itself.
	assert.match(rescue, /mounted_here=1/, 'tracks own mounts')
	assert.match(rescue, /\[ "\$mounted_here" = 1 \] && umount "\$OWN_MP"/, 'unmounts own mountpoint only')
})

test('WO-417: unit is live-session-only and enabled into the squashfs by the fix script', () => {
	const unit = read('tools/eggs/live-usb/systemd/calamares-session-log-rescue.service')
	assert.match(unit, /ConditionPathExists=\/run\/live\/medium/, 'inert on installed systems and the build host')
	assert.match(unit, /ExecStart=\/usr\/libexec\/calamares\/calamares-session-log-rescue\.sh/, 'runs the installed helper')
	assert.match(unit, /WantedBy=multi-user\.target/, 'enabled via multi-user wants')

	const fix = read('tools/eggs/live-usb/fix-calamares-shellprocess.sh')
	assert.match(fix, /install -m 0755 "\$RESCUE_SRC" "\$\{LIB\}\/calamares-session-log-rescue\.sh"/, 'helper installed')
	assert.match(fix, /ln -sf \.\.\/calamares-session-log-rescue\.service/, 'unit enabled (wants symlink)')

	const verify = read('tools/eggs/live-usb/verify-iso-squashfs-excludes.sh')
	assert.match(verify, /multi-user\.target\.wants\/calamares-session-log-rescue\.service/, 'ISO verify gates on the enabled unit')
})
