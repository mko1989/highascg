'use strict'

/**
 * WO-464 — the liveroot guard has to fire before the build touches the host.
 *
 * `eggs produce` leaves its live-system bind mounts under /home/eggs/liveroot, so a second
 * produce in the same boot is refused — correctly, since rm/umount through those binds has
 * erased /usr on this project before (RECOVER_DESTROYED_USR.md). The check lived only in
 * audit-eggs-clone-host.sh, which build-highascg-egg.sh calls AFTER prepare has run apt,
 * `npm ci`, a vite build and the Companion packaging. So the operator waited ~5 minutes and
 * mutated the host tree to be told about a condition that was true before the script started.
 *
 * These tests pin the early guard and its position.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD = 'tools/eggs/live-usb/build-highascg-egg.sh'
const src = fs.readFileSync(path.join(ROOT, BUILD), 'utf8')
const at = (needle) => src.indexOf(needle)

describe('WO-464 liveroot guard runs first', () => {
	it('build-highascg-egg.sh checks liveroot bind mounts itself', () => {
		assert.match(src, /source "\$\{HERE\}\/eggs-liveroot-safety\.sh"/)
		assert.match(src, /if eggs_liveroot_has_host_bind_mounts "\$_LIVEROOT"; then/)
		assert.match(src, /exit 1/)
	})

	it('the guard precedes every host mutation and the late audit', () => {
		const guard = at('eggs_liveroot_has_host_bind_mounts "$_LIVEROOT"')
		assert.ok(guard > 0, 'guard must exist')
		for (const [what, needle] of [
			['the nvidia-iso-driver stamp', '/etc/highascg/nvidia-iso-driver'],
			['prepare (apt, npm ci, vite, Companion)', 'prepare-eggs-clone-with-exfat.sh'],
			['the late audit that used to be the only check', 'audit-eggs-clone-host.sh'],
			// The invocation, not the word — the guard's own comment mentions `eggs produce`.
			['eggs produce itself', 'eggs produce --nointeractive'],
		]) {
			assert.ok(at(needle) > guard, `guard must run before ${what}`)
		}
	})

	it('it refuses rather than trying to clean up, and says why', () => {
		const msg = src.slice(at('eggs_liveroot_has_host_bind_mounts "$_LIVEROOT"'), at('/etc/highascg/nvidia-iso-driver'))
		assert.match(msg, /Reboot, then re-run/i, 'reboot is the sanctioned fix')
		assert.match(msg, /Do NOT run 'umount -R|Do NOT run "umount -R/, 'must warn against the destructive shortcut')
		assert.ok(!/umount -R "\$_LIVEROOT"|rm -rf "\$_LIVEROOT"/.test(msg), 'the guard must never attempt cleanup itself')
	})

	it('the audit still carries the check too (defence in depth)', () => {
		const audit = fs.readFileSync(path.join(ROOT, 'tools/eggs/live-usb/audit-eggs-clone-host.sh'), 'utf8')
		assert.match(audit, /eggs_liveroot_has_host_bind_mounts/, 'the late check must not be removed')
	})
})
