/**
 * Smoke — virtual-canvas texture crop helpers (no Three.js bundle required).
 * Run: `node tools/smoke-previs-texture-crop.mjs`
 */

import {
	applyVirtualCanvasRegionToTexture,
	clampCanvasRegion,
	resolveCanvasRegionFromTag,
} from '../web/lib/previs-texture-crop.js'

const failures = []
function assert(cond, msg) {
	if (!cond) failures.push(msg)
}

class FakeVec2 {
	constructor() {
		this.x = 0
		this.y = 0
	}
	set(x, y) {
		this.x = x
		this.y = y
		return this
	}
}

const vc = { width: 1920, height: 1080 }

const full = resolveCanvasRegionFromTag({}, vc)
assert(full.canvasX === 0 && full.canvasY === 0 && full.canvasWidth === 1920 && full.canvasHeight === 1080, 'default full region')

const clamped = clampCanvasRegion({ canvasX: -10, canvasY: 5000, canvasWidth: 100, canvasHeight: 100 }, vc)
assert(clamped.canvasX === 0 && clamped.canvasY === 1079, 'clamp X/Y to canvas')
assert(clamped.canvasWidth >= 1 && clamped.canvasHeight >= 1, 'positive W/H')

const tag = {
	canvasRegion: { canvasX: 480, canvasY: 270, canvasWidth: 960, canvasHeight: 540 },
}
const r = resolveCanvasRegionFromTag(tag, vc)
assert(r.canvasWidth === 960 && r.canvasHeight === 540, 'tag region preserved')

const tex = {
	repeat: new FakeVec2(),
	offset: new FakeVec2(),
	flipY: true,
	needsUpdate: false,
}
applyVirtualCanvasRegionToTexture(tex, vc, r)
assert(tex.repeat.x === 0.5 && tex.repeat.y === 0.5, 'repeat half for half canvas')
assert(Math.abs(tex.offset.x - 0.25) < 1e-6, 'offset.x left quarter')
assert(Math.abs(tex.offset.y - 0.25) < 1e-6, 'flipY true: offset.y bottom-anchored quarter')

const texNoFlip = {
	repeat: new FakeVec2(),
	offset: new FakeVec2(),
	flipY: false,
	needsUpdate: false,
}
applyVirtualCanvasRegionToTexture(texNoFlip, vc, r)
assert(Math.abs(texNoFlip.offset.x - 0.25) < 1e-6, 'flipY false offset.x')
assert(Math.abs(texNoFlip.offset.y - 0.25) < 1e-6, 'flipY false: offset.y matches canvas top')

applyVirtualCanvasRegionToTexture(tex, vc, { canvasX: 0, canvasY: 0, canvasWidth: 1920, canvasHeight: 1080 })
assert(tex.repeat.x === 1 && tex.repeat.y === 1 && tex.offset.x === 0 && tex.offset.y === 0, 'full canvas resets transform')

if (failures.length) {
	console.error('[previs-texture-crop] failures:', failures)
	process.exit(1)
}
console.log('[previs-texture-crop] ok')
process.exit(0)
