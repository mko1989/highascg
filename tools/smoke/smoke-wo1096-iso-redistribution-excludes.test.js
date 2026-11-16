'use strict'

/**
 * WO-1096 E — the ISO exclude sweep from the WO-1095 audit: what we have no right to distribute (vendor leftovers,
 * Shutter Encoder, the system-path NDI copy, dead CEF / noble payload) and what is private to the build host (root's
 * home, client show data, NM history, the pulse cookie, exfat-sync backups) never reaches the squashfs.
 *
 *   - penguins-eggs-exclude-redistribution.list is merged into custom.exclude.list in both embed modes;
 *   - exclude-match.js (the offline model of `mksquashfs -wildcards -ef`, FNM_PERIOD included) drops every audit leak
 *     and keeps what must ship (Caspar's own NDI/CEF libs, the shared GDTF Share login — owner decision 16.11.26);
 *   - with mksquashfs installed: a synthetic tree squashed with the generated list passes verify-iso-redistribution.sh,
 *     the same tree squashed without it fails, and the model agrees with mksquashfs path for path.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const LIVE_USB = path.resolve(__dirname, '../eggs/live-usb')
const gen = require(path.join(LIVE_USB, 'generate-eggs-config.js'))
const { compileExcludes, excludedBy, listingPath } = require(path.join(LIVE_USB, 'exclude-match.js'))
const VERIFY = path.join(LIVE_USB, 'verify-iso-redistribution.sh')
const read = (f) => fs.readFileSync(path.join(LIVE_USB, f), 'utf8')

/** Paths the 11.11 ISO (or the box on 16.11) carried and must not. */
const LEAKS = [
	'home/casparcg/Documents/tamoos-narvil_PATCH.csv',
	'home/casparcg/highascg-backups/narvil-before-origin-shift-2026-11-14.json',
	'root/.ssh/known_hosts',
	'root/.local/share/mc/history',
	'root/.npm/_logs/x.log',
	'root/.lesshst',
	'opt/shutter-encoder/lib/app/Shutter Encoder.jar',
	'usr/share/applications/shutter-encoder-Shutter_Encoder.desktop',
	'var/lib/dpkg/info/shutter-encoder.list',
	'usr/share/icons/hicolor/48x48/apps/BlackmagicDesktopVideoSetup.png',
	'usr/share/icons/hicolor/16x16/apps/DesktopVideoUpdater.png',
	'etc/blackmagic/BlackmagicPreferences.xml',
	'etc/dracut.conf.d/dracut-blackmagic.conf',
	'usr/share/lintian/overrides/desktopvideo-gui',
	'etc/rc2.d/S01DesktopVideoHelper',
	'etc/rc6.d/K01DesktopVideoHelper',
	'etc/systemd/system/multi-user.target.wants/DesktopVideoHelper.service',
	'home/casparcg/.config/Blackmagic Design/Desktop Video Setup.conf',
	'usr/share/applications/magicq.desktop',
	'usr/share/pixmaps/magicvis.png',
	'etc/udev/rules.d/99-chamsys-usb.rules',
	'usr/share/mime/packages/magicq.xml',
	'usr/share/mime/application/x-magicq-backup.xml',
	'var/lib/dpkg/info/magicq.postinst',
	'usr/share/NX/packages/server/x.tar.gz',
	'var/NX/nx/.ssh',
	'etc/pam.d/nxlimits',
	'usr/share/icons/hicolor/22x22/apps/NoMachine-icon.png',
	'usr/share/polkit-1/rules.d/55-org.nomachine.rules',
	'var/lib/dpkg/info/nomachine.prerm',
	'etc/apparmor.d/zoom',
	'usr/share/mime/application/x-zoom.xml',
	'var/lib/NetworkManager/seen-bssids',
	'var/lib/NetworkManager/internal-dba29960-eno1.lease',
	'var/lib/NetworkManager/timestamps',
	'home/casparcg/.config/pulse/cookie',
	'etc/highascg/exfat-sync.json.bak.20260607T133520Z',
	'usr/lib/x86_64-linux-gnu/libndi.so.6.3.2',
	'usr/lib/x86_64-linux-gnu/libndi.so.6',
	'usr/lib/cef/142.0.17/x86_64-linux-gnu/libcef.so',
	'home/casparcg/highascg/lib/NOBLE-COMPAT-MANIFEST.txt',
	'home/casparcg/highascg/lib/libavcodec.so.60.31.102',
	'home/casparcg/highascg/lib/libicuuc.so.74',
	'home/casparcg/highascg/lib/libsfml-graphics.so.2.6.1',
	'home/casparcg/highascg/lib/libxml2.so.2.9.14',
	'home/casparcg/highascg/lib/libx264.so.164',
]

/** Paths that must keep shipping. */
const KEEPS = [
	'root',
	'home/casparcg/.highascg/gdtf-share.json', // owner decision 22.10 / 16.11.26: the shared login ships
	'home/casparcg/highascg/lib/libndi.so.6', // Caspar's NDI (bin/casparcg RUNPATH $ORIGIN/../lib)
	'home/casparcg/highascg/lib/libndi.so.6.3.2',
	'home/casparcg/highascg/lib/libcef.so',
	'home/casparcg/highascg/lib/libportaudio.so.2.0.0',
	'home/casparcg/highascg/lib/libvulkan.so.1',
	'home/casparcg/highascg/bin/casparcg',
	'usr/lib/x86_64-linux-gnu/libavcodec.so.62',
	'usr/lib/x86_64-linux-gnu/libnvidia-gl.so.615',
	'usr/share/doc/libnvidia-gl-615/copyright',
	'etc/udev/rules.d/99-highascg-exfat-arrive.rules',
	'usr/share/applications/firefox-esr.desktop',
	'var/lib/NetworkManager/NetworkManager.state',
	'usr/lib/7zip/Codecs/Rar.so', // unRAR licence: free distribution allowed (no fee) — ships
]

describe('WO-1096 E: redistribution fragment in custom.exclude.list', () => {
	it('is merged in both embed modes, under its own section header', () => {
		const lines = read('penguins-eggs-exclude-redistribution.list').split('\n').map(gen.cleanLine).filter(Boolean)
		assert.ok(lines.length > 60)
		for (const embedServer of [true, false]) {
			const out = gen.buildExcludeList({ embedServer })
			assert.match(out, /\[penguins-eggs-exclude-redistribution\.list\]/)
			const pats = out.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
			for (const l of lines) assert.ok(pats.includes(l), `embed=${embedServer}: ${l}`)
		}
	})

	it('does not exclude the shared GDTF Share login (owner decision 16.11.26)', () => {
		assert.doesNotMatch(read('penguins-eggs-exclude-redistribution.list').replace(/^#.*$/gm, ''), /gdtf-share/)
		assert.doesNotMatch(read('verify-iso-redistribution.sh').replace(/^#.*$/gm, ''), /gdtf-share/)
	})

	it('drops every audit leak and keeps what must ship (mksquashfs -wildcards semantics)', () => {
		for (const embedServer of [true, false]) {
			const c = compileExcludes(gen.buildExcludeList({ embedServer }).split('\n'))
			for (const p of LEAKS) assert.ok(excludedBy(c, p), `embed=${embedServer}: leaks ${p}`)
			for (const p of KEEPS) assert.equal(excludedBy(c, p), null, `embed=${embedServer}: drops ${p}`)
		}
	})

	it('models FNM_PERIOD: root/* alone does not reach root/.ssh — the fragment carries root/.*', () => {
		const star = compileExcludes(['root/*'])
		assert.equal(excludedBy(star, 'root/.ssh/known_hosts'), null)
		assert.equal(excludedBy(star, 'root/snap/x'), 'root/*')
		assert.equal(excludedBy(compileExcludes(['root/.*']), 'root/.ssh/known_hosts'), 'root/.*')
		assert.equal(excludedBy(compileExcludes(['home/*/.config/Blackmagic?Design']), 'home/u/.config/Blackmagic Design/a'), 'home/*/.config/Blackmagic?Design')
		assert.equal(listingPath('-rw-r--r-- root/root  12 2026-11-11 12:49 squashfs-root/etc/a b'), 'etc/a b')
		assert.equal(listingPath('lrwxrwxrwx root/root 7 2026-11-11 12:49 squashfs-root/bin -> usr/bin'), 'bin')
	})

	it('the build verifier sources and calls the WO-1096 check', () => {
		const v = read('verify-iso-squashfs-excludes.sh')
		assert.match(v, /source "\$\{HERE_VERIFY\}\/verify-iso-redistribution\.sh"/)
		assert.match(v, /^redistribution_check /m)
	})

	const haveMksquashfs = spawnSync('mksquashfs', ['-version']).status === 0
	it('a squashed synthetic tree passes the verifier with the list and fails without it', { skip: !haveMksquashfs && 'no mksquashfs' }, () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1096-'))
		try {
			const tree = path.join(dir, 'tree')
			for (const p of [...LEAKS, ...KEEPS.filter((k) => k !== 'root')]) {
				fs.mkdirSync(path.dirname(path.join(tree, p)), { recursive: true })
				fs.writeFileSync(path.join(tree, p), '')
			}
			const list = path.join(dir, 'custom.exclude.list')
			fs.writeFileSync(list, gen.buildExcludeList({ embedServer: true }))
			const good = path.join(dir, 'good.sq')
			const bad = path.join(dir, 'bad.sq')
			const sq = (out, extra) => execFileSync('mksquashfs', [tree, out, '-quiet', '-noappend', '-no-progress', ...extra])
			sq(good, ['-wildcards', '-ef', list])
			sq(bad, [])
			const okRun = spawnSync('bash', [VERIFY, good], { encoding: 'utf8' })
			assert.equal(okRun.status, 0, okRun.stderr)
			const badRun = spawnSync('bash', [VERIFY, bad], { encoding: 'utf8' })
			assert.equal(badRun.status, 1)
			assert.match(badRun.stderr, /Blackmagic Desktop Video leftovers/)
			assert.match(badRun.stderr, /root home contents/)
			// the model and mksquashfs agree on every path
			const real = execFileSync('unsquashfs', ['-l', good], { encoding: 'utf8' }).split('\n').map(listingPath).filter(Boolean)
			const all = execFileSync('unsquashfs', ['-l', bad], { encoding: 'utf8' }).split('\n').map(listingPath).filter(Boolean)
			const c = compileExcludes(fs.readFileSync(list, 'utf8').split('\n'))
			assert.deepEqual(all.filter((p) => !excludedBy(c, p)).sort(), real.sort())
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
