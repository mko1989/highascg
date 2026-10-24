'use strict'

/**
 * WO-724 — the ISO build must leave Caspar on the real config.
 *
 * reset-iso-operator-config.sh copies config/casparcg.config.iso over the live casparcg.config, and the
 * npm step's pause/restore (install-iso-defaults.sh) restarts casparcg-server on that factory file. The
 * exFAT sync at the end puts the real config back, but nothing restarted Caspar after it: on 23.10 the
 * build host ran a 1-channel windowed config until the next Caspar restart (PLAY 4-1 / 5-2 DECKLINK
 * errors every 20 s, no operator-GUI picture).
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const src = fs.readFileSync(path.join(ROOT, 'tools/eggs/live-usb/build-highascg-egg.sh'), 'utf8')
const at = (needle) => src.indexOf(needle)
const RESTART = 'systemctl try-restart casparcg-server.service'

describe('WO-724 build restarts Caspar on the restored config', () => {
	it('restarts casparcg-server (only if it is running)', () => {
		assert.ok(at(RESTART) > 0)
	})

	it('after the factory config went in and after the sync brought the real one back', () => {
		assert.ok(at('reset-iso-operator-config.sh') < at(RESTART))
		assert.ok(at('highascg-exfat-remount-sync.sh" casparcg') < at(RESTART))
	})

	it('a failed restart warns instead of failing the build', () => {
		const line = src.split('\n').find((l) => l.includes(RESTART))
		assert.match(line, /\|\|\s*echo "WARN/)
	})

	it('the safe-to-copy sidecar is still the last thing written', () => {
		assert.ok(at(RESTART) < at('Completion sidecar'), 'WO-462: sidecar stays last')
	})
})
