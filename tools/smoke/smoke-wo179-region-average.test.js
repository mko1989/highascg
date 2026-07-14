'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { averageRegion } = require('../../src/sampling/fixture-transform')

test('T179.3: averageRegion with all red pixels', () => {
	// Create 4x4 frame, all red
	const frame = new Uint8Array(4 * 4 * 3)
	for (let i = 0; i < frame.length; i += 3) {
		frame[i] = 255     // R
		frame[i + 1] = 0   // G
		frame[i + 2] = 0   // B
	}

	const result = averageRegion(frame, 4, 4, 0, 3, 0, 3)
	assert.strictEqual(result.r, 255)
	assert.strictEqual(result.g, 0)
	assert.strictEqual(result.b, 0)
})

test('T179.3: averageRegion with half red half blue', () => {
	// Create 4x2 frame: left half red, right half blue
	const frame = new Uint8Array(4 * 2 * 3)
	for (let y = 0; y < 2; y++) {
		for (let x = 0; x < 4; x++) {
			const idx = (y * 4 + x) * 3
			if (x < 2) {
				// Left half: red
				frame[idx] = 255
				frame[idx + 1] = 0
				frame[idx + 2] = 0
			} else {
				// Right half: blue
				frame[idx] = 0
				frame[idx + 1] = 0
				frame[idx + 2] = 255
			}
		}
	}

	// Sample left half only
	const leftResult = averageRegion(frame, 4, 2, 0, 1, 0, 1)
	assert.strictEqual(leftResult.r, 255)
	assert.strictEqual(leftResult.g, 0)
	assert.strictEqual(leftResult.b, 0)

	// Sample right half only
	const rightResult = averageRegion(frame, 4, 2, 2, 3, 0, 1)
	assert.strictEqual(rightResult.r, 0)
	assert.strictEqual(rightResult.g, 0)
	assert.strictEqual(rightResult.b, 255)

	// Sample entire frame (should be purple-ish)
	const allResult = averageRegion(frame, 4, 2, 0, 3, 0, 1)
	assert.strictEqual(allResult.r, 128) // Average of 255 and 0 (rounds to 128)
	assert.strictEqual(allResult.g, 0)
	assert.strictEqual(allResult.b, 128) // Average of 0 and 255 (rounds to 128)
})

test('T179.3: averageRegion out of bounds', () => {
	const frame = new Uint8Array(2 * 2 * 3)
	// Fill with white
	for (let i = 0; i < frame.length; i++) {
		frame[i] = 255
	}

	// Sample partly out of bounds
	const result = averageRegion(frame, 2, 2, -1, 1, -1, 1)
	// Should average only the valid pixels (0,0), (1,0), (0,1), (1,1) = 4 pixels of white
	assert.strictEqual(result.r, 255)
	assert.strictEqual(result.g, 255)
	assert.strictEqual(result.b, 255)
})

test('T179.3: averageRegion empty region', () => {
	const frame = new Uint8Array(2 * 2 * 3)
	for (let i = 0; i < frame.length; i++) {
		frame[i] = 100
	}

	// Sample out of bounds entirely
	const result = averageRegion(frame, 2, 2, 10, 20, 10, 20)
	assert.strictEqual(result.r, 0)
	assert.strictEqual(result.g, 0)
	assert.strictEqual(result.b, 0)
})
