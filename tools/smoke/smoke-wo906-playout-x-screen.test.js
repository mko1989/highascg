'use strict'
/**
 * WO-906 — the playout X screen: the split of the layout plan (operator GUI heads → :0.0, every other head → :0.1, each
 * screen from 0,0), the generated two-screen conf (accepted by the root helper, no shared edge for the pointer), the
 * merge of both screens' xrandr back onto the plan's canvas, xrandr / NVIDIA / custom-mode calls per screen, Caspar's
 * window positions and caspar-env, and the sync (helper off when the switch is off). The box's real conf is never read.
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo906-x-'))
process.env.HOME = tmp // caspar-env + the staged conf land here (ENV_FILE is resolved at require time)
const CONF = path.join(tmp, '98-highascg-screens.conf')

const xs = require('../../src/utils/x-screens')
const { syncPlayoutXScreens } = require('../../src/utils/x-screens-sync')
const { toPlayoutScreen } = require('../../src/config/build-caspar-generator-layout-sync')
const { buildXrandrLayoutArgv, formatXrandrLayoutShellCommand } = require('../../src/utils/xrandr-safety')
const { buildNvidiaDisplayPolicyShellLines } = require('../../src/utils/nvidia-display-policy')
const { buildApplyLayoutScriptContent } = require('../../src/utils/xrandr-persist-script')
const { writeCasparGlSyncEnvFile, ENV_FILE } = require('../../src/utils/caspar-gl-sync-env')

const HELPER = path.join(__dirname, '../runtime/highascg-xorg-screens-apply.sh')
const head = (sysId, x, w, h) => ({ sysId, x, y: 0, width: w, height: h, mode: `${w}x${h}`, rate: 50 })
/** The box (31.10.26): operator-first, DP-4 + DP-6 operator, DP-0 the Dioda PGM right of them. */
const LAYOUT = {
	screens: { 1: head('DP-0', 3840, 3840, 1792) },
	multiview: {},
	operatorGui: { 1: head('DP-4', 0, 1920, 1080), 2: head('DP-6', 1920, 1920, 1080) },
	prv: {},
	mappingGpuOutputs: [],
}

const Q0 = `Screen 0: minimum 8 x 8, current 3840 x 1080, maximum 32767 x 32767
DP-0 disconnected (normal left inverted right x axis y axis)
DP-4 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 607mm x 345mm
   1920x1080     50.00*+  60.00
DP-6 connected 1920x1080+1920+0 (normal left inverted right x axis y axis) 607mm x 345mm
   1920x1080     50.00*+  60.00
`
const Q1 = `Screen 1: minimum 8 x 8, current 3840 x 1792, maximum 32767 x 32767
DP-0 connected primary 3840x1792+0+0 (normal left inverted right x axis y axis) 1000mm x 500mm
   3840x1792     50.00*+
DP-4 disconnected (normal left inverted right x axis y axis)
DP-6 disconnected (normal left inverted right x axis y axis)
`

before(() => {
	process.env.HIGHASCG_XORG_SCREENS_CONF = CONF
})
after(() => {
	delete process.env.HIGHASCG_XORG_SCREENS_CONF
	fs.rmSync(tmp, { recursive: true, force: true })
})

describe('WO-906 playout X screen', () => {
	it('the switch reads like WO-868: nested casparServer wins, flat generator config too, default off', () => {
		assert.equal(xs.isPlayoutXScreen({}), false)
		assert.equal(xs.isPlayoutXScreen({ casparServer: { playout_x_screen: true } }), true)
		assert.equal(xs.isPlayoutXScreen({ playout_x_screen: 'true' }), true)
		assert.equal(xs.isPlayoutXScreen({ casparServer: { playout_x_screen: false }, playout_x_screen: true }), false)
	})

	it('split: GUI heads on screen 0 from 0,0; the PGM head on screen 1 from 0,0 (origin = its plan x)', () => {
		const s = xs.splitScreens(LAYOUT)
		assert.deepEqual(s.operator.heads.map((h) => [h.output, h.sx, h.sy]), [['DP-4', 0, 0], ['DP-6', 1920, 0]])
		assert.deepEqual(s.playout.origin, { x: 3840, y: 0 })
		assert.deepEqual(s.playout.heads.map((h) => [h.output, h.sx, h.sy]), [['DP-0', 0, 0]])
		const both = xs.splitScreens({ ...LAYOUT, screens: { 1: head('DP-4', 0, 1920, 1080) } })
		assert.deepEqual(both.playout.heads, [], 'a connector cabled to the GUI stays on the operator screen')
		assert.equal(xs.playoutOrigin({ playout_x_screen: true }, { ...LAYOUT, operatorGui: {} }), null, 'nothing to separate')
		assert.deepEqual(xs.playoutOrigin({ playout_x_screen: true }, LAYOUT), { x: 3840, y: 0 })
		assert.equal(xs.playoutOrigin({}, LAYOUT), null, 'switch off')
	})

	it('the generated conf passes the root helper, maps the screens back and leaves no shared edge', () => {
		const conf = xs.buildXorgScreensConf(xs.splitScreens(LAYOUT), { busId: 'PCI:1:0:0' })
		fs.writeFileSync(CONF, conf)
		const r = spawnSync('bash', [HELPER, 'check', CONF], { encoding: 'utf8' })
		assert.equal(r.status, 0, r.stderr + r.stdout)
		assert.match(conf, /Option "metamodes" "DP-4: nvidia-auto-select \+0\+0 \{ForceCompositionPipeline=On\}, DP-6: nvidia-auto-select \+1920\+0/)
		assert.match(conf, /Option "UseDisplayDevice" "DP-0"\n {4}Option "metamodes" "DP-0: nvidia-auto-select \+0\+0 /)
		assert.match(conf, /Screen 1 "HighAsCG Playout" Absolute 3904 1144\n/, 'below-right of the 3840x1080 operator screen')
		assert.match(conf, /Option "Xinerama" "0"/)
		assert.deepEqual(xs.installedScreens(), [
			{ n: 0, display: ':0.0', x: 0, y: 0, outputs: ['DP-4', 'DP-6'] },
			{ n: 1, display: ':0.1', x: 3840, y: 0, outputs: ['DP-0'] },
		])
		assert.deepEqual(xs.screenOfOutput('DP-0'), { display: ':0.1', x: 3840, y: 0 })
		assert.equal(xs.buildXorgScreensConf(xs.splitScreens({ ...LAYOUT, screens: {} }), { busId: 'PCI:1:0:0' }), null)
		assert.throws(() => xs.buildXorgScreensConf(xs.splitScreens(LAYOUT), { busId: 'PCI:1:0:0"; x' }), /invalid BusID/)
	})

	it('the operator screen can never be a playout X screen output (GUI picker, boot answer, boot default)', async () => {
		assert.deepEqual(['DP-4', 'DP-6', 'DP-0'].map((n) => xs.isOperatorPickable(n)), [true, true, false])
		assert.equal(xs.isOperatorPickable('DP-0', []), true, 'one X screen: any output')
		const { handlePost } = require('../../src/api/routes-operator-screen')
		const listOutputs = () => [{ name: 'DP-0', port: 1, x: 3840, y: 0, width: 3840, height: 1792 }]
		const r = handlePost(JSON.stringify({ name: 'DP-0' }), { config: {} }, { listOutputs, confine: { isActive: () => false } })
		assert.equal(r.status, 409)
		const boot = require('../../src/system/boot-screen-assignment')
		const deps = { bootId: () => 'b1', store: { get: () => null, set: () => {} }, invalidate: () => {}, gpuMap: () => ({}) }
		assert.equal((await boot.resolve({ config: {} }, { name: 'DP-0' }, deps)).status, 409)
		const lit = [{ id: 'gpu_p0', name: 'DP-0', port: 1 }, { id: 'gpu_p2', name: 'DP-4', port: 3 }]
		assert.equal(boot.defaultOperator({}, lit, 1).name, 'DP-4', 'a saved flag on the playout jack falls back to screen 0')
	})

	it('both screens\' xrandr merge onto the plan canvas: positions + origin, one primary, union canvas, no ghost rows', () => {
		const m = xs.mergeScreensXrandrText([
			{ screen: { x: 0, y: 0 }, text: Q0 },
			{ screen: { x: 3840, y: 0 }, text: Q1 },
		])
		assert.match(m, /^Screen 0: minimum 8 x 8, current 7680 x 1792, maximum 32767 x 32767\n/)
		assert.match(m, /\nDP-0 connected 3840x1792\+3840\+0 \(normal/)
		assert.match(m, /\nDP-4 connected primary 1920x1080\+0\+0/)
		assert.equal((m.match(/^DP-0 /gm) || []).length, 1, 'DP-0 once: its disconnected row on screen 0 is dropped')
		assert.equal((m.match(/^DP-4 /gm) || []).length, 1)
		assert.match(m, /DP-0 connected 3840x1792\+3840\+0 [^\n]*\n {3}3840x1792 {5}50\.00\*\+/, 'the mode rows follow their output')
		assert.equal(xs.mergeScreensXrandrText([{ screen: { x: 0, y: 0 }, text: Q0 }]), Q0.replace('current 3840 x 1080', 'current 3840 x 1080'))
	})

	it('xrandr / custom modes / NVIDIA policy run per X screen from the installed conf', () => {
		const argv = buildXrandrLayoutArgv([{ output: 'DP-0', x: 0, y: 0, mode: '3840x1792', rate: 50 }], ':0.1')
		assert.equal(formatXrandrLayoutShellCommand(argv), 'DISPLAY=:0.1 xrandr --display :0.1 --output DP-0 --pos 0x0 --mode 3840x1792 --rate 50')
		assert.throws(() => buildXrandrLayoutArgv([], ':0; id'), /Invalid X display/)
		assert.equal(buildXrandrLayoutArgv([])[1], ':0', 'default unchanged')
		const nv = buildNvidiaDisplayPolicyShellLines().join('\n')
		if (nv) assert.match(nv, /DISPLAY=:0\.0 '[^']+'\n {2}DISPLAY=:0\.1 '/)
		const script = buildApplyLayoutScriptContent({
			xauth: '/x',
			xrandrLayoutCmd: 'DISPLAY=:0.1 xrandr --display :0.1 --output DP-0 --pos 0x0 --mode 3840x1792',
			customModes: [{ modeName: '3840x1792_50', timings: ['1', '2'], outputs: ['DP-0', 'DP-4'] }],
		})
		assert.match(script, /xrandr --display :0\.1 --newmode 3840x1792_50 1 2 [^\n]*\nxrandr --display :0\.1 --addmode DP-0 3840x1792_50/)
		assert.match(script, /xrandr --display :0\.0 --newmode 3840x1792_50 1 2 [^\n]*\nxrandr --display :0\.0 --addmode DP-4 /)
	})

	it('Caspar windows move by minus the playout origin; caspar-env names :0.1 only while the conf is installed', () => {
		const merged = { playout_x_screen: true, screen_1_x: 3840, screen_1_y: 0, multiview_x: 5760, screen_1_slice_windows: [{ x: 3840, y: 10 }] }
		toPlayoutScreen(merged, LAYOUT)
		assert.deepEqual([merged.screen_1_x, merged.screen_1_y, merged.multiview_x, merged.screen_1_slice_windows[0]], [0, 0, 1920, { x: 0, y: 10 }])
		const off = { screen_1_x: 3840 }
		toPlayoutScreen(off, LAYOUT)
		assert.equal(off.screen_1_x, 3840, 'switch off: untouched')
		const cfg = { casparServer: { playout_x_screen: true, caspar_gl_sync_display: 'DP-0' } }
		assert.equal(writeCasparGlSyncEnvFile({ config: cfg }).casparDisplay, ':0.1')
		assert.match(fs.readFileSync(ENV_FILE, 'utf8'), /\nCASPAR_GL_SYNC_DISPLAY=DP-0\nCASPAR_DISPLAY=:0\.1\n$/)
		fs.renameSync(CONF, `${CONF}.away`)
		assert.equal(writeCasparGlSyncEnvFile({ config: cfg }).casparDisplay, null, 'conf not installed → one screen')
		assert.doesNotMatch(fs.readFileSync(ENV_FILE, 'utf8'), /CASPAR_DISPLAY/)
		fs.renameSync(`${CONF}.away`, CONF)
	})

	it('sync: switch off + a conf installed → helper off once; nothing installed → no call; a refusal is an error', async () => {
		const calls = []
		const run = async (cmd, args) => calls.push([cmd, ...args])
		let r = await syncPlayoutXScreens({ config: {} }, { run })
		assert.deepEqual([r.ok, r.changed, r.on], [true, true, false])
		assert.deepEqual(calls, [['sudo', '-n', xs.HELPER, 'off']])
		fs.rmSync(CONF)
		r = await syncPlayoutXScreens({ config: {} }, { run })
		assert.deepEqual([r.ok, r.changed, calls.length], [true, false, 1])
		fs.writeFileSync(CONF, '# one\n')
		r = await syncPlayoutXScreens({ config: {} }, { run: async () => { throw Object.assign(new Error('x'), { stderr: 'sudo: a password is required' }) } })
		assert.equal(r.ok, false)
		assert.match(r.error, /password is required.*install-xorg-screens-apply\.sh/)
		r = await syncPlayoutXScreens({ config: {} })
		assert.deepEqual([r.ok, r.changed], [true, false], 'no run injected under the test runner → the box is never touched')
	})
})
