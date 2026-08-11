'use strict'

/* WO-475. A Calamares install failed with the bridge partition (LABEL=HIGHASCGDAT) still mounted,
 * even though the operator left that partition untouched: Calamares/KPMcore re-reads the TARGET
 * DISK's partition table, and the kernel refuses while ANY partition on that disk is mounted. The
 * bridge lives on the internal disk being installed to, so the launcher has to release it.
 *
 * Ordering is the whole fix, so it is asserted positionally:
 *   stop playout services  →  release bridge  →  calamares  →  restore bridge
 * Releasing before the services stop would fail — highascg.service holds the media root open. */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'tools/runtime/launch-calamares.sh'), 'utf8')
const PREFLIGHT = fs.readFileSync(path.join(ROOT, 'tools/eggs/live-usb/pre-produce-preflight.sh'), 'utf8')
const SHELLPROC = fs.readFileSync(path.join(ROOT, 'tools/eggs/live-usb/fix-calamares-shellprocess.sh'), 'utf8')
const VERIFY = fs.readFileSync(path.join(ROOT, 'tools/eggs/live-usb/verify-calamares-installed.sh'), 'utf8')

test('WO-475: the launcher releases the bridge before Calamares and restores it after', () => {
	/* WO-481 added a `--release-bridge` early-exit mode (Calamares' own shellprocess step calls it),
	 * whose body is also a bare `release_bridge` call — and it sits ABOVE the launch path by
	 * design. Anchor on the launch-path call, the one guarded by the restore trap. */
	const iTrap = SRC.indexOf('trap restore_bridge EXIT')
	const iRelease = SRC.indexOf('release_bridge\n', iTrap)
	const iCalamares = SRC.indexOf('"${CALAMARES_BIN}" -d')
	const iStopServices = SRC.indexOf('for unit in casparcg-server.service casparcg-scanner.service highascg.service')

	assert.ok(iTrap > 0, 'the restore trap is armed before the release')
	assert.ok(iStopServices > 0, 'launcher still stops playout before the install (WO-423)')
	assert.ok(iRelease > 0, 'launcher calls release_bridge')
	assert.ok(iCalamares > 0, 'launcher invokes Calamares')
	assert.ok(
		iStopServices < iRelease,
		'the bridge must be released AFTER the services stop — highascg.service holds the media root',
	)
	assert.ok(iRelease < iCalamares, 'the bridge must be released BEFORE Calamares starts')
	assert.ok(
		SRC.indexOf('restore_bridge', iCalamares) > iCalamares,
		'the bridge must be remounted after the installer exits',
	)
	assert.match(
		SRC,
		/trap restore_bridge EXIT/,
		'a cancelled or crashed installer must not leave the box without its media disk',
	)
})

test('WO-481: the release is callable on its own for Calamares\' own shellprocess step', () => {
	assert.match(
		SRC,
		/if \[\[ "\$\{1:-\}" == "--release-bridge" \]\]; then\n\trelease_bridge\n\texit 0/,
		'a --release-bridge mode must exist so the logic is never duplicated elsewhere (WO-471)',
	)
	/* It must come before the transient-unit re-exec: a one-shot unmount needs no scope, and
	 * systemd-run would detach it from the caller that is waiting on the exit status. */
	assert.ok(
		SRC.indexOf('"--release-bridge"') < SRC.indexOf('exec systemd-run'),
		'the standalone release must not be re-exec\'d into a transient unit',
	)
})

test('WO-475: both bridge mount points and the units that remount them are covered', () => {
	/* Deepest first — the media bind sits inside ~/bridge and pins it. */
	const paths = SRC.slice(SRC.indexOf('BRIDGE_PATHS=('))
	const iMediaBind = paths.indexOf('/home/casparcg/highascg/media/bridge')
	const iRoot = paths.indexOf('/home/casparcg/bridge\n')
	assert.ok(iMediaBind > -1 && iRoot > -1, 'both bridge mount points are listed')
	assert.ok(iMediaBind < iRoot, 'the media bind must be unmounted before its parent')

	for (const unit of [
		'home-casparcg-bridge.mount',
		'home-casparcg-highascg-media-bridge.mount',
		'highascg-bridge-arrive.service',
	]) {
		assert.ok(SRC.includes(unit), `${unit} must be stopped — udev would otherwise remount mid-install`)
	}
	/* Runtime masks only: they evaporate on the reboot into the freshly installed system. */
	assert.match(SRC, /systemctl mask --runtime/, 'arrive/mount units are masked at runtime, not permanently')
	assert.match(SRC, /systemctl unmask --runtime/, 'and unmasked again when the installer exits')
})

test('WO-475: the exFAT operator stick is left mounted — it is the live boot medium', () => {
	const release = SRC.slice(SRC.indexOf('BRIDGE_UNITS=('), SRC.indexOf('"${CALAMARES_BIN}" -d'))
	assert.ok(
		!/home-casparcg-exfat\.mount|\/home\/casparcg\/exfat/.test(release),
		'unmounting the live stick would pull the installer\'s own medium out from under it',
	)
})

test('WO-481: a produce cannot bake a stale launcher into the squashfs', () => {
	/* The image clones the LIVE filesystem, so /usr/local/bin is what ships — editing the repo
	 * alone is how WO-475 reached nobody. The preflight refreshes the installed copy at the last
	 * point before the clone. */
	assert.match(
		PREFLIGHT,
		/install -m 0755 "\$REPO_LAUNCHER" \/usr\/local\/bin\/launch-calamares\.sh/,
		'preflight must refresh /usr/local/bin/launch-calamares.sh from the repo',
	)
	assert.ok(
		PREFLIGHT.indexOf('REPO_LAUNCHER') < PREFLIGHT.indexOf('verify-calamares-installed.sh'),
		'the refresh must happen before the verifier that checks it',
	)
	assert.match(
		VERIFY,
		/grep -q -- '--release-bridge'/,
		'the verifier must check the FLAG — a WO-475-era launcher has the function but not the mode',
	)
})

test('WO-481: the Calamares step never triggers a full launch from inside Calamares', () => {
	const step = SHELLPROC.slice(SHELLPROC.indexOf('shellprocess@release_bridge.conf'))
	assert.match(
		step,
		/grep -q -- "--release-bridge" \/usr\/local\/bin\/launch-calamares\.sh/,
		'the step must confirm the launcher understands the flag before calling it',
	)
	assert.match(
		SHELLPROC,
		/shellprocess@release_bridge/,
		'the module is scheduled into the exec sequence',
	)
	assert.match(SHELLPROC, /dontChroot: true/, 'the release runs on the live system, not in the chroot')
})
