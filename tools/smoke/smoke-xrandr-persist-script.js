'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
	CustomXrandrModeRegistry,
	buildCustomModeBootstrapShellLines,
	buildApplyLayoutScriptContent,
} = require('../../src/utils/xrandr-persist-script')
const { computeModelineForWxH } = require('../../src/utils/xrandr-custom-mode')

const SAMPLE_TIMINGS = [
	'312.25',
	'5120',
	'5184',
	'5696',
	'6320',
	'1024',
	'1027',
	'1037',
	'1050',
	'-hsync',
	'+vsync',
]

test('CustomXrandrModeRegistry dedupes newmode across outputs', () => {
	const reg = new CustomXrandrModeRegistry()
	const plan = { modeName: '5120x1024_50.00', timings: SAMPLE_TIMINGS, width: 5120, height: 1024, refreshHz: 50 }
	reg.register('DP-0', plan)
	reg.register('DP-2', plan)
	const rows = reg.toArray()
	assert.equal(rows.length, 1)
	assert.deepEqual(rows[0].outputs, ['DP-0', 'DP-2'])
})

test('buildCustomModeBootstrapShellLines emits newmode before addmode', () => {
	const lines = buildCustomModeBootstrapShellLines([
		{ modeName: '5120x1024_50.00', timings: SAMPLE_TIMINGS, outputs: ['DP-0', 'DP-2'] },
	])
	assert.ok(lines.some((l) => l.includes('--newmode 5120x1024_50.00')))
	const newIdx = lines.findIndex((l) => l.includes('--newmode'))
	const add0 = lines.findIndex((l) => l.includes('--addmode DP-0'))
	const add2 = lines.findIndex((l) => l.includes('--addmode DP-2'))
	assert.ok(newIdx >= 0 && add0 > newIdx && add2 > add0)
	assert.equal(lines.filter((l) => l.includes('--newmode')).length, 1)
	assert.equal(lines.filter((l) => l.includes('--addmode')).length, 2)
})

test('buildApplyLayoutScriptContent orders custom modes before layout xrandr', () => {
	const script = buildApplyLayoutScriptContent({
		xauth: '/home/casparcg/.Xauthority',
		xrandrLayoutCmd: 'xrandr --display :0 --output DP-0 --pos 0x0 --mode 5120x1024_50.00',
		customModes: [{ modeName: '5120x1024_50.00', timings: SAMPLE_TIMINGS, outputs: ['DP-0'] }],
		sessionLines: ['xrandr --output DP-0 --primary'],
	})
	assert.match(script, /^#!\/bin\/bash/)
	const newIdx = script.indexOf('--newmode')
	const layoutIdx = script.indexOf('--output DP-0 --pos')
	const primaryIdx = script.indexOf('--primary')
	assert.ok(newIdx >= 0 && layoutIdx > newIdx)
	assert.ok(primaryIdx > layoutIdx)
})

/**
 * `cvt` ships in xserver-xorg-core, which a bare CI runner lacks, so the plumbing test injects a
 * deterministic `cvt` shim through the `env` argument (PATH-first) instead of relying on the host.
 */
function withShimmedCvt(fn) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvt-shim-'))
	try {
		const bin = path.join(dir, 'cvt')
		fs.writeFileSync(
			bin,
			[
				'#!/bin/sh',
				'echo "# $1x$2 49.93 Hz (CVT) hsync: 56.00 kHz; pclk: 141.50 MHz"',
				'echo "Modeline \\"$1x$2_$3.00\\"  141.50  $1 1488 1632 1840  $2 1083 1088 1122 -hsync +vsync"',
				'',
			].join('\n'),
			{ mode: 0o755 },
		)
		return fn({ ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH || ''}` })
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
}

test('computeModelineForWxH returns parsed mode without xrandr side effects', () => {
	const plan = withShimmedCvt((env) =>
		computeModelineForWxH({ width: 1920, height: 1080, refreshHz: 50, timingKind: 'cvt', env }),
	)
	assert.ok(plan)
	assert.match(plan.modeName, /^1920x1080_/)
	assert.ok(plan.timings.length >= 9)
	assert.equal(plan.width, 1920)
	assert.equal(plan.height, 1080)
	assert.equal(plan.timingKind, 'cvt')
})

const hasCvt = spawnSync('cvt', ['64', '64', '60'], { stdio: 'ignore' }).status === 0
test(
	'computeModelineForWxH works against the real host cvt',
	{ skip: hasCvt ? false : 'host cvt binary not installed (xserver-xorg-core); plumbing covered by the shim test above' },
	() => {
		const plan = computeModelineForWxH({ width: 1920, height: 1080, refreshHz: 50, timingKind: 'cvt' })
		assert.ok(plan)
		assert.match(plan.modeName, /^1920x1080_/)
		assert.ok(plan.timings.length >= 9)
	},
)
