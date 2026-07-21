'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
	computeOperatorGuiDevicePixelRatio,
	buildOperatorGuiUserJs,
	writeOperatorGuiScalePref,
} = require('../../src/system/operator-gui-scale')

test('1920x1080 (the CSS baseline) gets ratio 1 — no change for existing 1080p boxes', () => {
	assert.equal(computeOperatorGuiDevicePixelRatio({ width: 1920, height: 1080 }), 1)
})

test('3840x2160 (2160p, the reported case) gets ratio 2', () => {
	assert.equal(computeOperatorGuiDevicePixelRatio({ width: 3840, height: 2160 }), 2)
})

test('2560x1440 gets ratio 1.33 (min of the two axis ratios)', () => {
	assert.equal(computeOperatorGuiDevicePixelRatio({ width: 2560, height: 1440 }), 1.33)
})

test('below-baseline and missing dims never go under 1', () => {
	assert.equal(computeOperatorGuiDevicePixelRatio({ width: 1280, height: 720 }), 1)
	assert.equal(computeOperatorGuiDevicePixelRatio(null), 1)
	assert.equal(computeOperatorGuiDevicePixelRatio({}), 1)
})

test('absurd resolution is clamped to the 4x ceiling', () => {
	assert.equal(computeOperatorGuiDevicePixelRatio({ width: 999999, height: 999999 }), 4)
})

test('buildOperatorGuiUserJs emits the exact Firefox pref line', () => {
	const text = buildOperatorGuiUserJs(2)
	assert.match(text, /^user_pref\("layout\.css\.devPixelsPerPx", "2"\);$/m)
})

test('writeOperatorGuiScalePref writes user.js into the profile dir with the computed ratio', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-gui-scale-test-'))
	try {
		const ratio = writeOperatorGuiScalePref(dir, { width: 3840, height: 2160 })
		assert.equal(ratio, 2)
		const written = fs.readFileSync(path.join(dir, 'user.js'), 'utf8')
		assert.match(written, /devPixelsPerPx", "2"/)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('writeOperatorGuiScalePref fails soft (returns null, does not throw) on an unwritable dir', () => {
	const log = []
	const ratio = writeOperatorGuiScalePref('/nonexistent-dir-for-test/deeper', { width: 3840, height: 2160 }, (level, msg) =>
		log.push([level, msg]),
	)
	assert.equal(ratio, null)
	assert.ok(log.length >= 1)
})

test('operator-gui-launcher wires the scale-pref write into launchOperatorGuiBrowser before spawn', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/system/operator-gui-launcher.js'), 'utf8')
	assert.match(src, /\bwriteOperatorGuiScalePref\(/)
	assert.match(src, /\bresolveOperatorGuiChannelDims\(/)
})
