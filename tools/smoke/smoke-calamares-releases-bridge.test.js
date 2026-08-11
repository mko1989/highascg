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

test('WO-475: the launcher releases the bridge before Calamares and restores it after', () => {
	const iRelease = SRC.indexOf('release_bridge\n')
	const iCalamares = SRC.indexOf('"${CALAMARES_BIN}" -d')
	const iStopServices = SRC.indexOf('for unit in casparcg-server.service casparcg-scanner.service highascg.service')

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
