'use strict'

/**
 * WO-805 — a custom RandR mode is created once per X server, not twice per Apply. Each Apply runs applyX11Layout
 * twice (persist, then live) and both re-created the mode; on NVIDIA (refuses RandR user modes: `--addmode` BadMatch)
 * that failed every time, and the strip first switched the LIVE output to the first listed WxH. Runs against a fake
 * X server (recorded xrandr calls) — nothing reaches :0.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const CUSTOM = require.resolve('../../src/utils/xrandr-custom-mode')
const realTimings = require('../../src/utils/modeline-timings')

const CVT = `# 3840x1792 49.95 Hz (CVT) hsync: 92.47 kHz; pclk: 482.00 MHz
Modeline "3840x1792_50.00"  482.00  3840 4128 4544 5248  1792 1795 1805 1852 -hsync +vsync
`
const MODE = '3840x1792_50.00'

/** Minimal X server: user modes, per-output mode lists, an NVIDIA-like refusal of --addmode. */
function fakeX({ refusesAddmode }) {
	const x = {
		calls: [],
		userModes: new Set(),
		outputs: { 'DP-0': new Set(['3840x1792', '1920x1080']) },
		current: { 'DP-0': '3840x1792' },
		restart() {
			this.userModes.clear()
			this.outputs['DP-0'] = new Set(['3840x1792', '1920x1080'])
		},
		query() {
			let s = 'Screen 0: minimum 8 x 8, current 3840 x 1792, maximum 32767 x 32767\n'
			for (const [out, modes] of Object.entries(this.outputs)) {
				s += `${out} connected primary 3840x1792+0+0 (normal left inverted right x axis y axis) 600mm x 280mm\n`
				for (const m of modes) s += `   ${m}  50.00${this.current[out] === m ? '*' : ' '}\n`
			}
			for (const m of this.userModes) {
				if (!Object.values(this.outputs).some((set) => set.has(m))) s += `  ${m} (0x1c9) 482.000MHz -HSync +VSync\n`
			}
			return s
		},
		available(out) {
			return new Set(this.outputs[out])
		},
		xrandr(args) {
			const a = args.filter((v, i) => !(v === '--display' || args[i - 1] === '--display'))
			x.calls.push(a.join(' '))
			const fail = (why) => {
				throw new Error(`X Error: ${why}`)
			}
			if (a[0] === '--newmode') return x.userModes.has(a[1]) ? fail('BadName') : void x.userModes.add(a[1])
			if (a[0] === '--rmmode') {
				if (Object.values(x.outputs).some((s) => s.has(a[1]))) fail('BadAccess')
				return x.userModes.delete(a[1]) ? undefined : fail('BadName')
			}
			if (a[0] === '--addmode') return refusesAddmode ? fail('BadMatch') : void x.outputs[a[1]].add(a[2])
			if (a[0] === '--delmode') return x.outputs[a[1]].delete(a[2]) ? undefined : fail('BadMatch')
			if (a[0] === '--output' && a[2] === '--mode') return void (x.current[a[1]] = a[3])
			return undefined
		},
	}
	return x
}

function loadWith(x) {
	const origLoad = Module._load
	Module._load = function (request, parent) {
		if (parent && parent.filename === CUSTOM) {
			if (request === 'child_process') {
				return {
					execFileSync(cmd, args) {
						assert.equal(cmd, 'xrandr')
						return x.xrandr(args)
					},
				}
			}
			if (request.endsWith('/modeline-timings')) return { ...realTimings, runTimingGenerator: () => CVT }
		}
		return origLoad.apply(this, arguments)
	}
	delete require.cache[CUSTOM]
	try {
		return require(CUSTOM)
	} finally {
		Module._load = origLoad
		delete require.cache[CUSTOM]
	}
}

/** One applyX11Layout run's custom-mode step, as os-config-xrandr-apply.js calls it (query first). */
function run(mod, x, logs) {
	const queryText = x.query()
	return mod.tryAddXrandrModeFromCvt({
		output: 'DP-0',
		width: 3840,
		height: 1792,
		refreshHz: 50,
		env: {},
		logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
		availableModes: x.available('DP-0'),
		queryText,
	})
}

test('WO-805: NVIDIA refuses the mode — tried once, then not retried while X still shows that', () => {
	const x = fakeX({ refusesAddmode: true })
	const mod = loadWith(x)
	const logs = []
	assert.equal(run(mod, x, logs), null, 'persist run: created, --addmode refused → EDID fallback')
	const first = x.calls.length
	assert.ok(first > 0)
	assert.equal(run(mod, x, logs), null, 'live run: same result')
	assert.equal(run(mod, x, logs), null, 'next Apply, persist')
	assert.equal(run(mod, x, logs), null, 'next Apply, live')
	assert.equal(x.calls.length, first, 'no xrandr call after the first attempt')
	assert.ok(logs.some((l) => l.includes('not retried (WO-805)')))
	assert.equal(x.current['DP-0'], '3840x1792', 'the live output never left its mode')
})

test('WO-805: a dangling mode from an earlier process is stripped with --rmmode only (no modeset of the live output)', () => {
	const x = fakeX({ refusesAddmode: true })
	x.userModes.add(MODE) // left behind by the previous node process
	x.current['DP-0'] = '3840x1792'
	x.outputs['DP-0'] = new Set(['1920x1080', '3840x1792']) // first listed WxH is NOT the current mode
	const mod = loadWith(x)
	assert.equal(run(mod, x, []), null)
	assert.ok(!x.calls.some((c) => c.includes('--mode')), `no --output … --mode: ${x.calls.join(' | ')}`)
	assert.deepEqual(
		x.calls.map((c) => c.split(' ').slice(0, 3).join(' ')),
		[`--newmode ${MODE} 482.00`, `--rmmode ${MODE}`, `--newmode ${MODE} 482.00`, `--addmode DP-0 ${MODE}`, `--delmode DP-0 ${MODE}`],
		'strip = --rmmode only (no switch-away, no --delmode); the trailing delmode is the addmode retry after BadMatch',
	)
	assert.equal(x.current['DP-0'], '3840x1792')
})

test('WO-805: a driver that accepts the mode — created once, reused while it is on the output', () => {
	const x = fakeX({ refusesAddmode: false })
	const mod = loadWith(x)
	const logs = []
	assert.equal(run(mod, x, logs), MODE)
	const first = x.calls.length
	assert.equal(run(mod, x, logs), MODE, 'same mode as before for the live run')
	assert.equal(run(mod, x, logs), MODE)
	assert.equal(x.calls.length, first, 'reused, no re-create')
	assert.ok(logs.some((l) => l.includes('reused (WO-805)')))
})

test('WO-805: a restarted X server (no user modes) gets the mode created again', () => {
	const x = fakeX({ refusesAddmode: false })
	const mod = loadWith(x)
	assert.equal(run(mod, x, []), MODE)
	x.restart()
	const before = x.calls.length
	assert.equal(run(mod, x, []), MODE)
	assert.ok(x.calls.length > before, 're-created after the X restart')
	assert.ok(x.outputs['DP-0'].has(MODE))
})

test('WO-805: without queryText (other callers) the old always-create path runs', () => {
	const x = fakeX({ refusesAddmode: false })
	const mod = loadWith(x)
	assert.equal(run(mod, x, []), MODE)
	const before = x.calls.length
	const again = mod.tryAddXrandrModeFromCvt({
		output: 'DP-0',
		width: 3840,
		height: 1792,
		refreshHz: 50,
		env: {},
		availableModes: x.available('DP-0'),
	})
	assert.equal(again, MODE)
	assert.ok(x.calls.length > before)
})
