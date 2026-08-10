'use strict'

/**
 * WO-460 — "Shut down host" button in Settings → Danger zone.
 *
 * The load-bearing detail: reboot is the FALLTHROUGH at the bottom of handlePost() — anything
 * that reaches the end of the function reboots. A shutdown path added to nuclearPaths without
 * its own branch would therefore reboot the box instead of powering it off, and the API would
 * cheerfully answer `{ok:true, action:'reboot'}`. These tests pin the branch and its position.
 *
 * Deliberately source-text only: calling handlePost('/api/system/setup/shutdown') would run
 * `sudo -n poweroff` for real, which on a correctly provisioned box powers the machine off
 * mid-suite. Never exercise this route live.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('WO-460 shut down host', () => {
	it('shutdown is a nuclear path (inherits the password gate)', () => {
		const src = read('src/api/routes-system-setup.js')
		const paths = src.slice(src.indexOf('const nuclearPaths'), src.indexOf('if (!nuclearPaths.has(path)) return null'))
		assert.match(paths, /'\/api\/system\/setup\/shutdown'/)
	})

	it('shutdown has its own branch BEFORE the reboot fallthrough', () => {
		const src = read('src/api/routes-system-setup.js')
		const branch = src.indexOf("if (path === '/api/system/setup/shutdown')")
		const fallthrough = src.indexOf("{ bin: '/sbin/reboot', args: [] }")
		assert.ok(branch > 0, 'shutdown must have an explicit branch')
		assert.ok(fallthrough > 0, 'reboot fallthrough must still exist')
		assert.ok(branch < fallthrough, 'shutdown branch must precede the reboot fallthrough or it reboots instead')
	})

	it('shutdown runs poweroff, never reboot, and returns action:shutdown', () => {
		const src = read('src/api/routes-system-setup.js')
		const branch = src.slice(
			src.indexOf("if (path === '/api/system/setup/shutdown')"),
			src.indexOf("{ bin: '/sbin/reboot', args: [] }")
		)
		assert.match(branch, /\{ bin: '\/sbin\/poweroff', args: \[\] \}/)
		assert.match(branch, /\{ bin: '\/usr\/sbin\/poweroff', args: \[\] \}/)
		assert.match(branch, /\{ bin: '\/bin\/systemctl', args: \['poweroff'\] \}/)
		assert.match(branch, /\{ bin: '\/usr\/bin\/systemctl', args: \['poweroff'\] \}/)
		assert.ok(!/reboot/.test(branch), 'the shutdown branch must not mention reboot')
		assert.match(branch, /action: 'shutdown'/)
	})

	it('route is registered and the sudoers allowlist grants poweroff', () => {
		assert.match(read('src/api/router.js'), /routes\.post\('\/api\/system\/setup\/shutdown'/)
		const sudoers = read('scripts/setup/12-passwordless-sudo.sh')
		assert.match(sudoers, /NOPASSWD: \/sbin\/poweroff, \/usr\/sbin\/poweroff/)
		assert.match(sudoers, /NOPASSWD: \/bin\/systemctl poweroff, \/usr\/bin\/systemctl poweroff/)
	})

	it('button sits next to Reboot host and confirms before firing', () => {
		const tpl = read('client/components/settings-modal-templates.js')
		const reboot = tpl.indexOf('id="set-nuclear-reboot"')
		const shutdown = tpl.indexOf('id="set-nuclear-shutdown"')
		assert.ok(reboot > 0 && shutdown > reboot, 'shutdown button must render after the reboot button')
		assert.match(tpl.slice(reboot, shutdown + 200), /Shut down host<\/button>/)

		const js = read('client/components/settings-modal.js')
		const handler = js.slice(js.indexOf("#set-nuclear-shutdown"), js.indexOf("#set-nuclear-shutdown") + 400)
		assert.match(handler, /window\.confirm\(/, 'must confirm — this one cannot be undone from the UI')
		assert.match(handler, /postNuclear\('\/api\/system\/setup\/shutdown'\)/)
	})
})
