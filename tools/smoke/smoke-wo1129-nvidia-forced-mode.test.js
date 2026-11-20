'use strict'

/**
 * WO-1129 — forcing a display mode the EDID lacks on NVIDIA (CustomEDID + one X restart). Pure parts are exercised
 * directly; the root helper runs as the test user under HIGHASCG_EDID_TEST_ROOT (it refuses that override as root);
 * nothing here touches X, sudo or /etc.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const E = require('../../src/utils/edid-forced-mode')
const P = require('../../src/utils/nvidia-forced-mode-plan')
const { syncForcedModeEdids, readInstalledEdids, EDID_HELPER } = require('../../src/utils/nvidia-forced-mode-sync')

/** Laptop panel (N156HRA-EA1): DTD1 1920x1080@144 342.06 MHz, DTD2 @60 142.53 MHz, totals 2080x1142,
 * 0xFD range V 48-144 Hz H 165-165 kHz max 340 MHz, 0xFE text in slot 3. */
const PANEL_HEX =
	'00ffffffffffff000dae211500000000011e0104a52213780328659759548e271e5054000000010101010101010101010101010101019e8580a070383e403020a50058c110000018ad3780a070383e403020a50058c110000018000000fd003090a5a522010a202020202020000000fe004e3135364852412d4541310a200080'
const panel = () => Buffer.from(PANEL_HEX, 'hex')
/** The by-hand result proven on the laptop: slot 3 = DTD2 with clock 11877 (0x2e65), min H 165 → 57 kHz, new checksum. */
const PANEL_50_HEX =
	'00ffffffffffff000dae211500000000011e0104a52213780328659759548e271e5054000000010101010101010101010101010101019e8580a070383e403020a50058c110000018ad3780a070383e403020a50058c110000018000000fd00309039a522010a202020202020652e80a070383e403020a50058c11000001800ae'

const tmpDirs = []
/** Every temp dir of this file goes in after() — the suite leaves nothing behind. */
function tmpDir(prefix) {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
	tmpDirs.push(d)
	return d
}
after(() => {
	for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
})

function withChecksum(buf) {
	buf[127] = E.edidChecksumByte(buf)
	return buf
}

describe('WO-1129 EDID builder', () => {
	it('the real panel EDID validates and decodes its two DTDs', () => {
		assert.deepEqual(E.validateEdid(panel()), { ok: true, blocks: 1 })
		const d = E.listBaseDescriptors(panel())
		assert.equal(d[0].dtd.pixelClock10k, 34206)
		assert.equal(d[1].dtd.pixelClock10k, 14253)
		assert.equal(d[1].dtd.hActive + d[1].dtd.hBlank, 2080)
		assert.equal(d[1].dtd.vActive + d[1].dtd.vBlank, 1142)
		assert.deepEqual([d[2].tag, d[3].tag], [0xfd, 0xfe])
	})

	it('1920x1080@50: panel blanking, clock 0x2e65 in the 0xFE slot, range widened, checksum 0', () => {
		const r = E.buildForcedModeEdid(panel(), { width: 1920, height: 1080, refreshHz: 50 })
		assert.equal(r.ok, true)
		assert.equal(r.source, 'panel')
		assert.equal(r.slot, 3)
		assert.equal(r.replacedTag, 0xfe)
		assert.equal(r.rangeWidened, true)
		assert.equal(r.edid.toString('hex'), PANEL_50_HEX)
		assert.deepEqual([r.edid[108], r.edid[109]], [0x65, 0x2e])
		assert.equal(r.edid[90 + 7], 57, 'min H rate lowered to floor(118.77 MHz / 2080) kHz')
		assert.equal(r.edid.reduce((s, b) => s + b, 0) % 256, 0)
		assert.deepEqual(E.validateEdid(r.edid), { ok: true, blocks: 1 })
		const t = E.decodeDtd(r.edid, 108)
		assert.equal(`${t.hActive}x${t.vActive}`, '1920x1080')
		assert.equal(E.dtdRefreshHz(t).toFixed(2), '50.00')
		assert.equal(r.edid.subarray(0, 108).toString('hex'), PANEL_50_HEX.slice(0, 216), 'only slot 3, range limits, checksum change')
	})

	it('the mode already in the EDID is reported, not added', () => {
		const r = E.buildForcedModeEdid(panel(), { width: 1920, height: 1080, refreshHz: 60 })
		assert.equal(r.ok, true)
		assert.equal(r.alreadyPresent, true)
		assert.ok(r.edid.equals(panel()))
	})

	it('a size without a DTD is built from the modeline (CVT), clock rescaled to the exact rate', () => {
		const cvt = ['74.50', '1280', '1344', '1472', '1664', '720', '723', '728', '748', '-hsync', '+vsync']
		const r = E.buildForcedModeEdid(panel(), { width: 1280, height: 720, refreshHz: 50, fallbackTimings: cvt })
		assert.equal(r.ok, true)
		assert.equal(r.source, 'modeline')
		const t = E.decodeDtd(r.edid, 108)
		assert.deepEqual([t.hActive, t.hBlank, t.hSyncOffset, t.hSyncWidth, t.vActive, t.vBlank, t.vSyncOffset, t.vSyncWidth], [1280, 384, 64, 128, 720, 28, 3, 5])
		assert.equal(t.flags, 0x1c, 'digital separate, +vsync, -hsync')
		assert.equal(Math.abs(E.dtdRefreshHz(t) - 50) < 0.01, true)
		assert.equal(E.dtdFromModelineTimings([...cvt.slice(0, 9), 'Interlace']), null, 'interlaced modelines are refused')
		assert.deepEqual(E.validateEdid(r.edid), { ok: true, blocks: 1 })
		const none = E.buildForcedModeEdid(panel(), { width: 1280, height: 720, refreshHz: 50 })
		assert.equal(none.ok, false)
		assert.match(none.error, /no 1280x720 timing/)
	})

	it('no dummy / 0xFE / 0xFC slot → clean failure', () => {
		const b = panel()
		b[108 + 3] = 0xff // serial string: not ours to overwrite
		const r = E.buildForcedModeEdid(withChecksum(b), { width: 1920, height: 1080, refreshHz: 50 })
		assert.equal(r.ok, false)
		assert.match(r.error, /no free descriptor slot/)
	})

	it('extension blocks are carried over unchanged', () => {
		const ext = Buffer.alloc(128)
		ext[0] = 0x02
		ext[1] = 0x03
		ext[127] = E.edidChecksumByte(ext)
		const base = panel()
		base[126] = 1
		const two = Buffer.concat([withChecksum(base), ext])
		const r = E.buildForcedModeEdid(two, { width: 1920, height: 1080, refreshHz: 50 })
		assert.equal(r.ok, true)
		assert.equal(r.edid.length, 256)
		assert.equal(r.edid[126], 1)
		assert.ok(r.edid.subarray(128).equals(ext))
		assert.deepEqual(E.validateEdid(r.edid), { ok: true, blocks: 2 })
	})

	it('validation rejects a bad checksum, header, size and extension count', () => {
		const bad = panel()
		bad[127] ^= 1
		assert.match(E.validateEdid(bad).error, /checksum/)
		const hdr = panel()
		hdr[1] = 0
		assert.match(E.validateEdid(withChecksum(hdr)).error, /header/)
		assert.match(E.validateEdid(panel().subarray(0, 100)).error, /128/)
		const cnt = panel()
		cnt[126] = 2
		assert.match(E.validateEdid(withChecksum(cnt)).error, /extensions/)
	})

	it('encodeDtd round-trips and refuses fields that do not fit', () => {
		const t = E.decodeDtd(panel(), 54)
		assert.ok(E.encodeDtd(t).equals(panel().subarray(54, 72)))
		assert.throws(() => E.encodeDtd({ ...t, vSyncOffset: 64 }), /vSyncOffset/)
	})

	it('cross-checks with edid-decode when installed', (t) => {
		if (spawnSync('sh', ['-c', 'command -v edid-decode']).status !== 0) return t.skip('edid-decode not installed')
		const r = E.buildForcedModeEdid(panel(), { width: 1920, height: 1080, refreshHz: 50 })
		const out = spawnSync('edid-decode', ['-'], { input: r.edid, encoding: 'utf8' }).stdout
		assert.match(out, /1920x1080\s+50\.00\d* Hz/)
	})
})

const QUERY = `Screen 0: minimum 8 x 8, current 1920 x 1080, maximum 32767 x 32767
DP-2 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 344mm x 193mm
   1920x1080    144.00*+  60.00    50.00
HDMI-0 disconnected (normal left inverted right x axis y axis)
DP-4 connected 1920x1080+1920+0 (normal left inverted right x axis y axis) 0mm x 0mm
   1920x1080     60.00*+
`

describe('WO-1129 plan', () => {
	it('xrandr mode-list rates are read per output', () => {
		assert.equal(P.xrandrOutputListsModeRate(QUERY, 'DP-2', '1920x1080', 50), true)
		assert.equal(P.xrandrOutputListsModeRate(QUERY, 'DP-4', '1920x1080', 50), false)
		assert.equal(P.xrandrOutputListsModeRate(QUERY, 'DP-4', '1920x1080', 60), true)
		assert.equal(P.xrandrOutputListsModeRate(QUERY, 'DP-2', '1280x720', 50), false)
	})

	it('only an EXPLICIT custom source is forced; the operator GUI keeps its output', () => {
		const layout = {
			operatorGui: { 1: { sysId: 'DP-0', mode: '1920x1080' } },
			screens: {
				1: { sysId: 'DP-2', mode: '1920x1080', rate: 50, screenIndex: 1, osModeSource: 'custom' },
				2: { sysId: 'DP-4', mode: '1920x1080', rate: 50, screenIndex: 2, osModeSource: 'custom' }, // legacy inference
				3: { sysId: 'DP-0', mode: '1280x720', rate: 50, screenIndex: 3, osModeSource: 'custom' },
			},
		}
		const config = { screen_1_os_mode_source: 'custom', casparServer: { screen_3_os_mode_source: 'custom' } }
		assert.deepEqual(P.collectForcedModeHeads(config, layout), [{ output: 'DP-2', width: 1920, height: 1080, refreshHz: 50, screenN: 1 }])
		assert.deepEqual(P.collectForcedModeHeads({}, layout, () => assert.fail('nothing explicit: no output resolved')), [])
	})

	const head = { output: 'DP-2', width: 1920, height: 1080, refreshHz: 50, screenN: 1 }
	const query60 = QUERY.replace('  60.00    50.00', '  60.00')
	const built = E.buildForcedModeEdid(panel(), head).edid
	const base = (over) => ({ heads: [head], installed: new Map(), liveEdid: () => panel(), storedOrig: () => null, queryText: query60, ...over })

	it('missing mode → install the built EDID', () => {
		const p = P.planCustomEdidSync(base())
		assert.equal(p.install.length, 1)
		assert.ok(p.install[0].edid.equals(built))
		assert.ok(p.install[0].orig.equals(panel()))
		assert.equal(p.install[0].label, 'DP-2: forcing 1920x1080@50')
		assert.deepEqual([p.remove, p.pending, p.warnings], [[], [], []])
	})

	it('natively listed and nothing installed → nothing to do (never automatic)', () => {
		const p = P.planCustomEdidSync(base({ queryText: QUERY }))
		assert.deepEqual([p.install, p.remove, p.pending], [[], [], []])
	})

	it('installed + live (X reports our EDID) + listed → steady state, base is the stored original', () => {
		const p = P.planCustomEdidSync(base({ installed: new Map([['DP-2', built]]), liveEdid: () => built, storedOrig: () => panel(), queryText: QUERY }))
		assert.deepEqual([p.install, p.remove, p.pending, p.warnings], [[], [], [], []])
	})

	it('installed but X not restarted yet → one pending restart, then a warning', () => {
		const attempted = new Set()
		const p1 = P.planCustomEdidSync(base({ installed: new Map([['DP-2', built]]), attempted }))
		assert.equal(p1.pending.length, 1)
		attempted.add(p1.pending[0].key)
		const p2 = P.planCustomEdidSync(base({ installed: new Map([['DP-2', built]]), attempted }))
		assert.equal(p2.pending.length, 0)
		assert.match(p2.warnings[0], /still does not list/)
	})

	it('custom source dropped → the connector is removed; a new rate → reinstall', () => {
		const p = P.planCustomEdidSync(base({ heads: [], installed: new Map([['DP-2', built], ['HDMI-0', built]]) }))
		assert.deepEqual(p.remove, ['DP-2', 'HDMI-0'])
		const p48 = P.planCustomEdidSync(base({ heads: [{ ...head, refreshHz: 48 }], installed: new Map([['DP-2', built]]), liveEdid: () => built, storedOrig: () => panel() }))
		assert.equal(p48.install.length, 1)
		assert.equal(E.dtdRefreshHz(E.decodeDtd(p48.install[0].edid, 108)).toFixed(2), '48.00')
	})
})

describe('WO-1129 sync (injected deps)', () => {
	const config = { screen_1_os_mode_source: 'custom' }
	const layout = { screens: { 1: { sysId: 'DP-2', mode: '1920x1080', rate: 50, screenIndex: 1 } } }
	const tmp = () => tmpDir('wo1129-')
	const deps = (over) => ({
		isNvidia: () => true,
		layout: () => layout,
		resolver: () => (s) => s,
		installDir: tmp(),
		stageDir: tmp(),
		queryXrandr: async () => QUERY.replace('  60.00    50.00', '  60.00'),
		liveEdid: () => panel(),
		fallbackTimings: () => null,
		...over,
	})

	it('not NVIDIA → untouched (RandR path stays)', async () => {
		const r = await syncForcedModeEdids(config, { deps: deps({ isNvidia: () => false, runHelper: () => assert.fail('no helper') }) })
		assert.equal(r.skipped, 'not_nvidia')
	})

	it('install runs the helper once with the EDID on stdin and asks for ONE restart', async () => {
		const calls = []
		const d = deps({ runHelper: async (args, input) => (calls.push([args, input]), { ok: true }) })
		const r = await syncForcedModeEdids(config, { deps: d })
		assert.deepEqual(calls.map((c) => c[0]), [['--install', 'DP-2']])
		assert.equal(E.validateEdid(calls[0][1]).ok, true)
		assert.equal(r.restartNeeded, true)
		assert.deepEqual(r.messages, ['DP-2: forcing 1920x1080@50 needs a display restart'])
		assert.ok(fs.readFileSync(path.join(d.stageDir, 'DP-2.orig.bin')).equals(panel()), 'the real EDID is kept for later rebuilds')
	})

	it('sudo -n refused → a clear warning, no restart, no throw', async () => {
		const d = deps({ runHelper: async () => ({ ok: false, error: 'sudo -n highascg-apply-display-edid.sh: a password is required' }) })
		const r = await syncForcedModeEdids(config, { deps: d })
		assert.equal(r.restartNeeded, false)
		assert.match(r.warnings[0], /^DP-2: custom EDID not installed \(sudo -n .*password/)
	})

	it('installed files are read by connector name; junk names are ignored', () => {
		const dir = tmp()
		fs.writeFileSync(path.join(dir, 'DP-2.bin'), panel())
		fs.writeFileSync(path.join(dir, 'bad name.bin'), panel())
		fs.writeFileSync(path.join(dir, '.lock'), '')
		assert.deepEqual([...readInstalledEdids(dir).keys()], ['DP-2'])
	})
})

describe('WO-1129 root helper (bash, as the test user)', () => {
	const helper = path.join(ROOT, 'tools/runtime/highascg-apply-display-edid.sh')
	const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
	const run = (root, args, input) =>
		spawnSync('bash', [helper, ...args], { input, encoding: 'utf8', env: { ...process.env, HIGHASCG_EDID_TEST_ROOT: root } })
	const fresh = () => {
		const r = tmpDir('wo1129-helper-')
		fs.mkdirSync(path.join(r, 'etc/X11/xorg.conf.d'), { recursive: true })
		fs.writeFileSync(
			path.join(r, 'etc/X11/xorg.conf.d/99-highascg-force-composition.conf'),
			'Section "Device"\n    Identifier "NVIDIA Default Device"\n    Driver "nvidia"\n    Option "ForceCompositionPipeline" "On"\nEndSection\n',
		)
		return r
	}

	it('install / install / remove / remove keeps ONE snippet with every connector, composition carried over', (t) => {
		if (asRoot) return t.skip('the test-root override is ignored as root')
		const r = fresh()
		const snip = path.join(r, 'etc/X11/xorg.conf.d/98-highascg-custom-edid.conf')
		assert.equal(run(r, ['--install', 'DP-2'], panel()).status, 0)
		assert.equal(run(r, ['--install', 'HDMI-0'], panel()).status, 0)
		const s = fs.readFileSync(snip, 'utf8')
		assert.match(s, /Option "ForceCompositionPipeline" "On"/)
		assert.ok(s.includes(`Option "CustomEDID" "DP-2:${r}/etc/X11/highascg-edid/DP-2.bin; HDMI-0:${r}/etc/X11/highascg-edid/HDMI-0.bin"`), s)
		assert.equal((fs.statSync(path.join(r, 'etc/X11/highascg-edid/DP-2.bin')).mode & 0o777).toString(8), '644')
		assert.equal(run(r, ['--remove', 'DP-2'], '').status, 0)
		assert.ok(fs.readFileSync(snip, 'utf8').includes(`"HDMI-0:${r}/etc/X11/highascg-edid/HDMI-0.bin"`))
		assert.equal(run(r, ['--remove', 'HDMI-0'], '').status, 0)
		assert.equal(fs.existsSync(snip), false, 'no forced modes left → no snippet')
		assert.ok(fs.existsSync(path.join(r, 'etc/X11/xorg.conf.d/99-highascg-force-composition.conf')), 'the composition snippet is never touched')
	})

	it('rejects a bad checksum, a bad header and a bad connector name', (t) => {
		if (asRoot) return t.skip('the test-root override is ignored as root')
		const r = fresh()
		const badSum = panel()
		badSum[127] ^= 1
		const badHdr = panel()
		badHdr[0] = 1
		const cases = [
			[['--install', 'DP-2'], withChecksum(badHdr), /bad EDID header/],
			[['--install', 'DP-2'], badSum, /checksum is wrong/],
			[['--install', 'DP-2'], panel().subarray(0, 100), /128·n bytes/],
			[['--install', 'DP;2'], panel(), /bad connector name/],
			[['--install', '../x'], panel(), /bad connector name/],
			[['--remove', 'DP 2'], '', /bad connector name|usage/],
		]
		for (const [args, input, re] of cases) {
			const res = run(r, args, input)
			assert.notEqual(res.status, 0, args.join(' '))
			assert.match(res.stderr, re)
		}
		assert.deepEqual(fs.readdirSync(path.join(r, 'etc/X11/xorg.conf.d')), ['99-highascg-force-composition.conf'])
	})

	it('without root and without the test root it refuses', (t) => {
		if (asRoot) return t.skip('running as root')
		const env = { ...process.env }
		delete env.HIGHASCG_EDID_TEST_ROOT
		const res = spawnSync('bash', [helper, '--remove', 'DP-2'], { encoding: 'utf8', env })
		assert.equal(res.status, 1)
		assert.match(res.stderr, /root required/)
	})
})

describe('WO-1129 wiring', () => {
	it('the sudoers installer ships and grants the helper path, no wildcard (WO-97)', () => {
		const src = read('scripts/setup/12-passwordless-sudo.sh')
		const line = src.split('\n').find((l) => l.includes(`NOPASSWD: ${EDID_HELPER}`))
		assert.ok(line, 'grant line')
		assert.doesNotMatch(line, /\*/)
		assert.ok(src.includes('tools/runtime/highascg-apply-display-edid.sh" /usr/local/lib/highascg/highascg-apply-display-edid.sh'))
	})

	it('the ISO never ships a build host forced mode; the verifier checks helper + absence', () => {
		for (const l of ['penguins-eggs-exclude-highascg-fragment.list', 'penguins-eggs-exclude-highascg-embed-server.list']) {
			const rows = read(`tools/eggs/live-usb/${l}`).split('\n')
			for (const p of ['etc/X11/highascg-edid', 'etc/X11/highascg-edid/*', 'etc/X11/xorg.conf.d/98-highascg-custom-edid.conf']) {
				assert.ok(rows.includes(p), `${p} in ${l}`)
			}
		}
		const v = read('tools/eggs/live-usb/verify-iso-squashfs-excludes.sh')
		assert.ok(v.includes("'etc/X11/highascg-edid'") && v.includes("'etc/X11/xorg.conf.d/98-highascg-custom-edid.conf'"))
		assert.ok(v.includes("squash_has_path 'usr/local/lib/highascg/highascg-apply-display-edid.sh'"))
	})

	it('Full Apply folds the forced-mode restart into its one nodm restart', () => {
		const src = read('src/utils/full-config-apply.js')
		assert.match(src, /const forcedMode = await syncForcedModeEdids\(ctx\.config, \{ log \}\)\.catch\(/)
		assert.match(src, /const needsNodm = opts\.forceNodmRestart === true \|\| canvasCheck\.needed \|\| forcedMode\.restartNeeded === true/)
	})
})
