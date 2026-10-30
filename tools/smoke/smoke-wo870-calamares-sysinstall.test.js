'use strict'

/**
 * WO-870 Phase 4: install to disk on penguins-eggs 26.10 (coa). Calamares is no longer configured at build time
 * (/etc/calamares); `eggs sysinstall calamares` builds /etc/penguins-eggs.d/installer.d on the live stick, copies our
 * overlay (branding/calamares/branding) over its default branding, renders branding.desc.tmpl, and refuses to run
 * off a live session. The launcher keeps the WO-423/475 envelope (stop playout → release bridge → installer →
 * restore) and only swaps the command; the API and the Godot pane say "live stick only" instead of failing late.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const LIVE_USB = path.join(ROOT, 'tools/eggs/live-usb')
const THEME_CAL = path.join(LIVE_USB, 'highascg-eggs-theme/theme/calamares/branding')
const LAUNCHER = path.join(ROOT, 'tools/runtime/launch-calamares.sh')
const SRC = fs.readFileSync(LAUNCHER, 'utf8')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** coa 26.10.30 pkg/sysinstall/setup/branding-desc.go BrandingConfig (the only fields a template may name). */
const BRANDING_FIELDS = [
	'ProductName', 'ShortProductName', 'Version', 'VersionedName', 'ShortVersionedName', 'BootloaderEntryName',
	'ProductUrl', 'SupportUrl', 'KnownIssuesUrl', 'ReleaseNotesUrl',
]
const OVERLAY = ['branding.desc.tmpl', 'show.qml', 'highascg-eggs-theme-logo.png', 'highascg-mascot.png', 'welcome.png']

describe('WO-870 Phase 4: Calamares branding overlay', () => {
	const tmpl = fs.readFileSync(path.join(THEME_CAL, 'branding.desc.tmpl'), 'utf8')

	it('componentName is "eggs" (coa always renders into installer.d/branding/eggs)', () => {
		assert.match(tmpl, /^componentName: eggs$/m)
	})

	it('names only BrandingConfig fields, and every image it names travels in the overlay', () => {
		for (const m of tmpl.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)) assert.ok(BRANDING_FIELDS.includes(m[1]), m[1])
		assert.ok(!/\{\{(?!\s*\.\w+\s*\}\})/.test(tmpl), 'no other template actions')
		for (const m of tmpl.matchAll(/^\s+product(?:Icon|Logo|Welcome):\s+"([^"]+)"$/gm)) {
			assert.ok(OVERLAY.includes(m[1]), `${m[1]} not installed`)
			assert.ok(fs.statSync(path.join(THEME_CAL, m[1])).size > 0, m[1])
		}
		assert.match(tmpl, /^slideshow:\s+"show\.qml"$/m)
	})

	it('the HighAsCG slideshow only references overlay images (WO-148)', () => {
		const qml = fs.readFileSync(path.join(THEME_CAL, 'show.qml'), 'utf8')
		assert.match(qml, /HighAsCG/)
		for (const m of qml.matchAll(/source:\s*"([^"]+)"/g)) assert.ok(OVERLAY.includes(m[1]), m[1])
	})

	it('install-eggs-config.sh --out installs the overlay with the branch filled and no module overrides', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo870-cal-'))
		try {
			const r = cp.spawnSync('bash', [path.join(LIVE_USB, 'install-eggs-config.sh'), '--out', dir], {
				encoding: 'utf8',
				env: { ...process.env, HIGHASCG_NVIDIA_DRIVER: '615', HIGHASCG_ISO_EMBED_SERVER: '1' },
			})
			assert.equal(r.status, 0, r.stderr)
			const out = path.join(dir, 'branding/calamares/branding')
			assert.deepEqual(fs.readdirSync(out).sort(), [...OVERLAY].sort())
			const desc = fs.readFileSync(path.join(out, 'branding.desc.tmpl'), 'utf8')
			assert.equal(desc, tmpl.replaceAll('@BRANCH@', '615'))
			assert.match(desc, /^ {2}productName:\s+"HIGHASCG NVIDIA 615"$/m)
			assert.ok(!desc.includes('@BRANCH@'))
			for (const f of OVERLAY.slice(1))
				assert.ok(fs.readFileSync(path.join(out, f)).equals(fs.readFileSync(path.join(THEME_CAL, f))), f)
			/* a whole-file modules/ override would replace coa's generated partition/users confs (efi, layout, password keys) */
			assert.ok(!fs.existsSync(path.join(dir, 'branding/calamares/modules')))
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('the legacy /etc/calamares sync never copies the template', () => {
		assert.match(read('tools/eggs/live-usb/install-eggs-calamares.sh'), /! -name branding\.desc ! -name branding\.desc\.tmpl -exec install/)
	})
})

describe('WO-870 Phase 4: launch-calamares.sh on eggs 26.10', () => {
	const iStop = SRC.indexOf('for unit in casparcg-server.service casparcg-scanner.service highascg.service')
	const iTrap = SRC.indexOf('trap restore_bridge EXIT')
	const iRelease = SRC.indexOf('release_bridge\n', iTrap)
	const iSysinstall = SRC.indexOf('"${EGGS_BIN}" sysinstall calamares --anonymous')
	const iRestore = SRC.indexOf('restore_bridge\n', iSysinstall)

	it('runs `eggs sysinstall calamares --anonymous` inside the stop → release → restore envelope', () => {
		assert.ok(iSysinstall > 0)
		assert.ok(iStop < iRelease && iRelease < iSysinstall && iSysinstall < iRestore)
		assert.ok(SRC.indexOf('"${CALAMARES_BIN}" -d') > iRelease, 'the legacy launch keeps its place')
	})

	it('refuses off a live session before anything is stopped', () => {
		const guard = SRC.indexOf('if eggs_sysinstall && ! is_live; then')
		assert.ok(guard > 0 && guard < iStop && guard < iRelease)
	})

	it('live dirs match coa utils.IsLive()', () => {
		assert.match(
			SRC,
			/LIVE_DIRS="\$\{HIGHASCG_LIVE_DIRS:-\/run\/live\/medium \/lib\/live\/mount\/medium \/run\/archiso\/bootmnt \/run\/miso\/bootmnt \/run\/initramfs\/live\}"/,
		)
	})

	it('--check: live + overlay → 0; not live → 1; overlay image missing → 1', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo870-launch-'))
		try {
			const brand = path.join(tmp, 'brand')
			fs.mkdirSync(brand)
			for (const f of OVERLAY) fs.copyFileSync(path.join(THEME_CAL, f), path.join(brand, f))
			const check = (live) =>
				cp.spawnSync('bash', [LAUNCHER, '--check'], {
					encoding: 'utf8',
					env: {
						...process.env,
						HIGHASCG_EGGS_FLAVOR: 'new',
						HIGHASCG_LIVE_DIRS: live,
						CALAMARES_BIN: process.execPath,
						CALAMARES_BRAND_DIR: brand,
					},
				})
			assert.equal(check(tmp).status, 0)
			const off = check(path.join(tmp, 'absent'))
			assert.equal(off.status, 1)
			assert.match(off.stderr, /not a live session/)
			fs.rmSync(path.join(brand, 'highascg-eggs-theme-logo.png'))
			assert.match(check(tmp).stderr, /branding images missing/)
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true })
		}
	})
})

describe('WO-870 Phase 4: API + Godot pane say "live stick only"', () => {
	it('GET status reports liveOnly when eggs is coa and no live dir exists; POST launch answers 409', () => {
		const realAccess = fs.accessSync
		const realRealpath = fs.realpathSync
		const realExists = fs.existsSync
		const realExecFileSync = cp.execFileSync
		fs.accessSync = () => {}
		fs.realpathSync = (p) => (p === '/usr/bin/eggs' ? '/usr/lib/penguins-eggs/coa' : realRealpath(p))
		fs.existsSync = (p) => (String(p).startsWith('/run/') || String(p).startsWith('/lib/live') ? false : realExists(p))
		cp.execFileSync = () => ''
		try {
			delete require.cache[require.resolve('../../src/api/routes-system-setup')]
			const { detectCalamaresStatus } = require('../../src/api/routes-system-setup')
			const st = detectCalamaresStatus()
			assert.equal(st.liveOnly, true)
			assert.equal(st.binary, '/usr/bin/eggs sysinstall calamares')
		} finally {
			fs.accessSync = realAccess
			fs.realpathSync = realRealpath
			fs.existsSync = realExists
			cp.execFileSync = realExecFileSync
			delete require.cache[require.resolve('../../src/api/routes-system-setup')]
		}
		const src = read('src/api/routes-system-setup.js')
		const launch = src.slice(src.indexOf('function launchCalamaresAsync'))
		const i409 = launch.indexOf('if (calamares.liveOnly) {')
		assert.ok(i409 > 0 && i409 < launch.indexOf("spawn('sudo'"), 'refused before the spawn')
		assert.match(launch, /status: 409, error: 'Install to disk runs from the live stick/)
		assert.ok(!src.includes('eggs calamares --install'), 'no advice for the removed CLI')
	})

	it('the pane disables the button and shows the reason', () => {
		const gd = read('godot/client/features/settings/nuclear_pane.gd')
		assert.match(gd, /and cal\.get\("liveOnly"\) != true\)/)
		assert.match(gd, /"Install to disk runs from the live stick — boot the HighAsCG USB stick to install"/)
	})
})
