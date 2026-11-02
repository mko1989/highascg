'use strict'
/**
 * WO-928 — the enabled home-casparcg-bridge.mount must give up on a missing HIGHASCGDAT within seconds. Its
 * `x-systemd.device-timeout=5` is ignored in a unit file (fstab only), so a clone without the bridge disk (box .31,
 * 02.11) waited systemd's default 90 s, and decklink-install → exfat-sync → highascg.service all waited behind it.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const units = fs.readFileSync(path.join(REPO, 'scripts/exfat/install-exfat-systemd-units-units.sh'), 'utf8')

describe('WO-928 bridge device timeout', () => {
	it('installs a JobRunningTimeoutSec drop-in on the HIGHASCGDAT device unit', () => {
		assert.ok(
			units.includes("bridge_dev_dropin='/etc/systemd/system/dev-disk-by\\x2dlabel-HIGHASCGDAT.device.d'"),
			'drop-in dir must be the systemd-escaped device unit name'
		)
		assert.match(units, /cat > "\$\{bridge_dev_dropin\}\/highascg-timeout\.conf" <<'BRIDGEDEVEOF'\n\[Unit\]\nJobRunningTimeoutSec=5\n/)
	})

	it('the bridge mount stays enabled and the boot chain is still ordered after it', () => {
		const mount = units.slice(units.indexOf('home-casparcg-bridge.mount <<BRIDGEEOF'), units.indexOf('\nBRIDGEEOF\n'))
		assert.match(mount, /WantedBy=multi-user\.target/)
		assert.match(units, /After=home-casparcg-bridge\.mount .*\$\{decklink_install_svc\}/)
	})
})
