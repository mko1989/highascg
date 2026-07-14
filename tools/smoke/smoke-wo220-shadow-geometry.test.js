/**
 * WO-220: Shadow geometry math tests
 * Test the shadow outset calculation and fill expansion logic
 */

const assert = require('node:assert')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// Extract the pure math functions from pip-overlay-amcp.js
// (avoiding browser dependencies)

function outsetPxForShadow(blur, offsetX, offsetY, spread) {
	const ox = Math.abs(Number(offsetX) || 0)
	const oy = Math.abs(Number(offsetY) || 0)
	const sp = Math.max(0, Number(spread) || 0)
	return Math.max(12, blur + Math.max(ox, oy) + sp + 2)
}

function expandFillOutward(contentFill, outsetPx, chW, chH) {
	const w = Math.max(1, chW)
	const h = Math.max(1, chH)
	const ox = outsetPx / w
	const oy = outsetPx / h
	let x = contentFill.x - ox
	let y = contentFill.y - oy
	let sx = contentFill.scaleX + 2 * ox
	let sy = contentFill.scaleY + 2 * oy
	return { x, y, scaleX: sx, scaleY: sy }
}

test('shadow outset: logged case (blur 20, ox 10, oy 16, sp 8)', (t) => {
	const outset = outsetPxForShadow(20, 10, 16, 8)
	// Expected: 20 + max(10, 16) + 8 + 2 = 46px
	assert.strictEqual(outset, 46, `should be 46, got ${outset}`)
})

test('shadow outset: minimum (all zeros)', (t) => {
	const outset = outsetPxForShadow(0, 0, 0, 0)
	// Should be Math.max(12, 0 + 0 + 0 + 2) = 12
	assert.strictEqual(outset, 12, `should be 12, got ${outset}`)
})

test('shadow outset: blur dominant', (t) => {
	const outset = outsetPxForShadow(50, 0, 0, 0)
	// Should be Math.max(12, 50 + 0 + 0 + 2) = 52
	assert.strictEqual(outset, 52, `should be 52, got ${outset}`)
})

test('shadow outset >= blur + max(ox,oy) + spread', (t) => {
	// Test several cases to ensure the formula holds
	const cases = [
		[20, 10, 16, 8],
		[0, 5, 5, 5],
		[100, 0, 0, 10],
		[15, 25, 20, 0],
	]
	for (const [blur, ox, oy, sp] of cases) {
		const outset = outsetPxForShadow(blur, ox, oy, sp)
		const minExpected = blur + Math.max(ox, oy) + sp
		assert(outset >= minExpected, `outset ${outset} should be >= ${minExpected}`)
	}
})

test('expandFillOutward: grows rectangle on all sides', (t) => {
	const contentFill = { x: 0.1, y: 0.1, scaleX: 0.8, scaleY: 0.8 }
	const chW = 3072
	const chH = 1728
	const outsetPx = 46

	const expanded = expandFillOutward(contentFill, outsetPx, chW, chH)

	// After expansion, the left/top should be smaller (moved left/up)
	// and scaleX/scaleY should be larger
	assert(expanded.x < contentFill.x, 'x should move left (smaller)')
	assert(expanded.y < contentFill.y, 'y should move up (smaller)')
	assert(expanded.scaleX > contentFill.scaleX, 'scaleX should increase')
	assert(expanded.scaleY > contentFill.scaleY, 'scaleY should increase')

	// The expansion should be symmetric (outsetPx / chW added on each side)
	const oxNorm = outsetPx / chW
	const oyNorm = outsetPx / chH
	assert.strictEqual(expanded.x, contentFill.x - oxNorm)
	assert.strictEqual(expanded.y, contentFill.y - oyNorm)
	assert.strictEqual(expanded.scaleX, contentFill.scaleX + 2 * oxNorm)
	assert.strictEqual(expanded.scaleY, contentFill.scaleY + 2 * oyNorm)
})

test('expandFillOutward: large outset', (t) => {
	const contentFill = { x: 0.2, y: 0.2, scaleX: 0.6, scaleY: 0.6 }
	const chW = 3072
	const chH = 1728
	const outsetPx = 200

	const expanded = expandFillOutward(contentFill, outsetPx, chW, chH)

	// Verify the math
	const oxNorm = outsetPx / chW // ~0.065
	const oyNorm = outsetPx / chH // ~0.116

	assert.strictEqual(expanded.scaleX, contentFill.scaleX + 2 * oxNorm)
	assert.strictEqual(expanded.scaleY, contentFill.scaleY + 2 * oyNorm)
})

test('template: pip_shadow.html contains WO-220 fix marker', (t) => {
	const templatePath = path.join(__dirname, '../../template/pip_shadow.html')
	const content = fs.readFileSync(templatePath, 'utf8')
	assert(
		content.includes('rgba(0, 0, 0, 0.002)'),
		'pip_shadow.html should contain the invisible background fix marker rgba(0, 0, 0, 0.002)'
	)
	assert(
		content.includes('WO-220'),
		'pip_shadow.html should reference WO-220 in a comment'
	)
})

test('template: pip_glow.html contains WO-220 fix marker', (t) => {
	const templatePath = path.join(__dirname, '../../template/pip_glow.html')
	const content = fs.readFileSync(templatePath, 'utf8')
	assert(
		content.includes('rgba(0, 0, 0, 0.002)'),
		'pip_glow.html should contain the invisible background fix marker rgba(0, 0, 0, 0.002)'
	)
	assert(
		content.includes('WO-220'),
		'pip_glow.html should reference WO-220 in a comment'
	)
})
