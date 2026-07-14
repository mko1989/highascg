'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { transformFixtureCoords } = require('../../src/sampling/fixture-transform')

test('T179.2: transformFixtureCoords no transform (0,0)', () => {
	// Center point, no mirror, no rotation
	const result = transformFixtureCoords(0, 0, false, false, 0)
	assert.strictEqual(result.rx, 0)
	assert.strictEqual(result.ry, 0)
})

test('T179.2: transformFixtureCoords no mirror with 90° rotation', () => {
	// At (1, 0), rotate 90° should go to (0, 1)
	const result = transformFixtureCoords(1, 0, false, false, 90)
	assert.ok(Math.abs(result.rx - 0) < 0.01, `Expected rx ~0, got ${result.rx}`)
	assert.ok(Math.abs(result.ry - 1) < 0.01, `Expected ry ~1, got ${result.ry}`)
})

test('T179.2: transformFixtureCoords mirrorH only', () => {
	// At (1, 0), mirror H should negate X
	const result = transformFixtureCoords(1, 0, true, false, 0)
	assert.strictEqual(result.rx, -1)
	assert.strictEqual(result.ry, 0)
})

test('T179.2: transformFixtureCoords mirrorV only', () => {
	// At (0, 1), mirror V should negate Y
	const result = transformFixtureCoords(0, 1, false, true, 0)
	assert.strictEqual(result.rx, 0)
	assert.strictEqual(result.ry, -1)
})

test('T179.2: transformFixtureCoords mirrorH and mirrorV', () => {
	// At (1, 1), mirror both should negate both
	const result = transformFixtureCoords(1, 1, true, true, 0)
	assert.strictEqual(result.rx, -1)
	assert.strictEqual(result.ry, -1)
})

test('T179.2: transformFixtureCoords mirrorH then rotate 90°', () => {
	// At (1, 0), mirror H gives (-1, 0), then rotate 90° should give (0, -1)
	const result = transformFixtureCoords(1, 0, true, false, 90)
	assert.ok(Math.abs(result.rx - 0) < 0.01, `Expected rx ~0, got ${result.rx}`)
	assert.ok(Math.abs(result.ry - (-1)) < 0.01, `Expected ry ~-1, got ${result.ry}`)
})

test('T179.2: transformFixtureCoords 180° rotation', () => {
	// At (1, 1), rotate 180° should go to (-1, -1)
	const result = transformFixtureCoords(1, 1, false, false, 180)
	assert.ok(Math.abs(result.rx - (-1)) < 0.01, `Expected rx ~-1, got ${result.rx}`)
	assert.ok(Math.abs(result.ry - (-1)) < 0.01, `Expected ry ~-1, got ${result.ry}`)
})

test('T179.2: transformFixtureCoords combined mirror and 45° rotation', () => {
	// Test a complex case: point at (2, 0), mirror H (becomes -2, 0), rotate 45°
	// (-2, 0) rotated 45° should go to approx (-sqrt(2)*sqrt(2), -sqrt(2))
	const result = transformFixtureCoords(2, 0, true, false, 45)
	const sqrt2over2 = Math.sqrt(2) / 2
	const expectedRx = -2 * sqrt2over2
	const expectedRy = -2 * sqrt2over2
	assert.ok(Math.abs(result.rx - expectedRx) < 0.01, `Expected rx ~${expectedRx}, got ${result.rx}`)
	assert.ok(Math.abs(result.ry - expectedRy) < 0.01, `Expected ry ~${expectedRy}, got ${result.ry}`)
})
