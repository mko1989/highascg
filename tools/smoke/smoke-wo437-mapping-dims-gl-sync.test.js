'use strict'

/**
 * WO-437 (todos06.08 items 2+3): outputs whose dropdown said 2160p5000 carried stale stored
 * width:1920/height:1080 (the pre-WO-437 inspector saved the hidden custom inputs' numbers
 * alongside a standard mode pick), and every resolver preferred the stored numbers — so GPU
 * ports reported 1080p as the incoming signal. Separately, a mapping-node-only rig has an
 * empty layout-plan `screens`, so the WO-407 GL-sync auto resolved nothing and caspar ran
 * without __GL_SYNC_DISPLAY_DEVICE.
 *
 * Invariant pinned here: a STANDARD video-mode id is authoritative over stored width/height,
 * client and server side; and GL-sync auto falls back to the leftmost mapping-driven GPU head.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** Strip comments so an explanatory sentence can never satisfy an assertion. */
function code(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const STALE = { id: 'out_1', mode: '2160p5000', label: 'Output 1', width: 1920, height: 1080, fps: 50 }

test('WO-437: client resolver — standard mode outranks stale stored dims', async () => {
	const { resolveMappingOutputResolution } = await import('../../client/lib/mapping-node-service.js')
	const r = resolveMappingOutputResolution(STALE)
	assert.equal(r.width, 3840, 'mode 2160p5000 must resolve 3840 wide even with stored width 1920')
	assert.equal(r.height, 2160)
	assert.equal(r.isCustom, false)
	// Custom modes still honour stored dims (they ARE the mode).
	const c = resolveMappingOutputResolution({ mode: '3456x1152p50', width: 3456, height: 1152 })
	assert.equal(c.width, 3456)
	assert.equal(c.isCustom, true)
})

test('WO-437: server resolver — standard mode outranks stale stored dims', () => {
	const { resolveOutputPixelSize } = require('../../src/utils/mapping-gpu-os-layout')
	const r = resolveOutputPixelSize(STALE)
	assert.equal(r.width, 3840)
	assert.equal(r.height, 2160)
	// Custom-mode outputs keep their explicit dims.
	const c = resolveOutputPixelSize({ mode: '3456x1152p50', width: 3456, height: 1152, fps: 50 })
	assert.equal(c.width, 3456)
})

test('WO-437: inspector standard-mode save derives dims from the mode, not the hidden inputs', () => {
	const src = code(read('client/components/device-view-inspector-mapping.js'))
	const m = /const saveCustom = async \(\) => \{([\s\S]*?)\n\t\t\}/.exec(src)
	assert.ok(m, 'saveCustom still exists')
	assert.match(
		m[1],
		/videoModeToResolution\(vMode\.value\)/,
		'a standard-mode pick must save the mode’s canonical dims — saving the stale custom ' +
			'inputs alongside it is exactly the corruption WO-437 healed',
	)
})

test('WO-437: GPU feed resolver routes through resolveMappingOutputResolution', () => {
	const src = code(read('client/lib/device-view-gpu-source-inherit.js'))
	assert.match(
		src,
		/resolveMappingOutputResolution\(output\)/,
		'the mode-vs-stored-dims precedence must live in ONE place; the inlined ' +
			'`output.width ?? mode dims` variant reported stale sizes on GPU ports',
	)
})

test('WO-437: GL-sync auto falls back to the leftmost mapping-driven GPU head', () => {
	const src = code(read('src/utils/caspar-gl-sync-env.js'))
	const afterScreenFallback = src.split('screen_1_system_id')[1] || ''
	assert.match(
		afterScreenFallback,
		/planMappingSysId\(\)/,
		'a mapping-only rig (empty plan.screens) must still pin __GL_SYNC_DISPLAY_DEVICE, ' +
			'or the WO-407 cross-panel vblank beat returns',
	)
	assert.match(src, /mappingGpuOutputs/, 'fallback reads the layout plan’s mapping rows')
})
