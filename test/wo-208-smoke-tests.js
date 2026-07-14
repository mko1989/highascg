#!/usr/bin/env node
/**
 * WO-208: Smoke tests for timer instances and canonical layer allocation.
 * Standalone test file - run with: node test/wo-208-smoke-tests.js
 */

'use strict'

const assert = require('assert')

let passed = 0
let failed = 0

function test(name, fn) {
	try {
		fn()
		console.log(`✓ ${name}`)
		passed++
	} catch (e) {
		console.error(`✗ ${name}: ${e.message}`)
		failed++
	}
}

// Mock SceneState-like object for testing
class MockSceneState {
	constructor() {
		this.timers = []
		this.scenes = []
	}

	_save() {}
}

// Import the timer functions
const {
	createTimerFromLayer,
	getTimer,
	renameTimer,
	ensureCanonicalLayer,
	listTimers,
	findBoundLayers,
} = require('../client/lib/scene-state-timers.js')

// Test 1: createTimerFromLayer creates a timer with correct structure
test('createTimerFromLayer creates valid timer instance', () => {
	const mockLayer = {
		layerNumber: 10,
		source: {
			countdownConfig: { mode: 'duration', durationSec: 120 },
		},
	}

	const timer = createTimerFromLayer(mockLayer, 0)

	assert.ok(timer.id, 'Timer should have an id')
	assert.ok(timer.name.includes('Timer'), 'Timer should have a name')
	assert.strictEqual(timer.config.mode, 'duration', 'Config should inherit from layer')
	assert.strictEqual(timer.config.durationSec, 120, 'Config durationSec should match layer')
	assert.strictEqual(timer.canonicalLayerByScreen['0'], 10, 'Should record canonical layer for screen 0')
})

// Test 2: createTimerFromLayer handles undefined countdownConfig
test('createTimerFromLayer uses defaults when countdownConfig missing', () => {
	const mockLayer = { layerNumber: 15, source: {} }

	const timer = createTimerFromLayer(mockLayer, 1)

	assert.strictEqual(timer.config.mode, 'duration', 'Should use default mode')
	assert.strictEqual(timer.config.durationSec, 300, 'Should use default durationSec')
	assert.strictEqual(timer.canonicalLayerByScreen['1'], 15, 'Should record layer 15 for screen 1')
})

// Test 3: getTimer retrieves a timer by id
test('getTimer finds timer by id', () => {
	const state = new MockSceneState()
	const timer = { id: 'test-timer-1', name: 'Test Timer', config: {}, canonicalLayerByScreen: {} }
	state.timers.push(timer)

	const found = getTimer(state, 'test-timer-1')

	assert.strictEqual(found.id, 'test-timer-1', 'Should find timer by id')
	assert.strictEqual(found.name, 'Test Timer', 'Should return correct timer object')
})

// Test 4: getTimer returns null for missing id
test('getTimer returns null for missing timer', () => {
	const state = new MockSceneState()

	const found = getTimer(state, 'nonexistent')

	assert.strictEqual(found, null, 'Should return null for missing timer')
})

// Test 5: renameTimer updates timer name
test('renameTimer updates timer name', () => {
	const state = new MockSceneState()
	const timer = { id: 'timer-1', name: 'Old Name', config: {}, canonicalLayerByScreen: {} }
	state.timers.push(timer)

	const result = renameTimer(state, 'timer-1', 'New Name')

	assert.strictEqual(result, true, 'Should return true on success')
	assert.strictEqual(timer.name, 'New Name', 'Timer name should be updated')
})

// Test 6: renameTimer rejects empty names
test('renameTimer rejects empty names', () => {
	const state = new MockSceneState()
	const timer = { id: 'timer-1', name: 'Original', config: {}, canonicalLayerByScreen: {} }
	state.timers.push(timer)

	const result = renameTimer(state, 'timer-1', '   ')

	assert.strictEqual(result, false, 'Should return false for empty name')
	assert.strictEqual(timer.name, 'Original', 'Timer name should not change')
})

// Test 7: ensureCanonicalLayer allocates new layer on first use
test('ensureCanonicalLayer allocates new layer on first call', () => {
	const state = new MockSceneState()
	const timer = { id: 'timer-1', name: 'Timer', config: {}, canonicalLayerByScreen: {} }
	state.timers.push(timer)

	const scene = { layers: [] }

	const result = ensureCanonicalLayer(state, 'timer-1', 0, 20, scene)

	assert.strictEqual(result.layerNumber, 20, 'Should use preferred layer number')
	assert.strictEqual(result.isNewAllocation, true, 'Should indicate new allocation')
	assert.strictEqual(result.fallback, false, 'Should not be a fallback')
	assert.strictEqual(timer.canonicalLayerByScreen['0'], 20, 'Should record allocation')
})

// Test 8: ensureCanonicalLayer reuses canonical layer on second call
test('ensureCanonicalLayer reuses recorded canonical layer', () => {
	const state = new MockSceneState()
	const timer = {
		id: 'timer-1',
		name: 'Timer',
		config: {},
		canonicalLayerByScreen: { '0': 20 },
	}
	state.timers.push(timer)

	const scene = { layers: [] }

	const result = ensureCanonicalLayer(state, 'timer-1', 0, 25, scene) // Try different layer

	assert.strictEqual(result.layerNumber, 20, 'Should return recorded canonical layer (20), not preferred (25)')
	assert.strictEqual(result.isNewAllocation, false, 'Should not allocate again')
})

// Test 9: ensureCanonicalLayer falls back when preferred layer is taken
test('ensureCanonicalLayer falls back to next free layer when taken', () => {
	const state = new MockSceneState()
	const timer = { id: 'timer-1', name: 'Timer', config: {}, canonicalLayerByScreen: {} }
	state.timers.push(timer)

	// Scene already has a layer at 20
	const scene = {
		layers: [
			{ layerNumber: 20, source: { value: 'some-media' } },
		],
	}

	const result = ensureCanonicalLayer(state, 'timer-1', 0, 20, scene)

	assert.strictEqual(result.fallback, true, 'Should indicate fallback')
	assert.strictEqual(result.layerNumber, 21, 'Should use next free layer (21)')
	assert.strictEqual(timer.canonicalLayerByScreen['0'], 21, 'Should record fallback layer')
})

// Test 10: listTimers returns all timers
test('listTimers returns all valid timer instances', () => {
	const state = new MockSceneState()
	state.timers = [
		{ id: 'timer-1', name: 'T1', config: {}, canonicalLayerByScreen: {} },
		{ id: 'timer-2', name: 'T2', config: {}, canonicalLayerByScreen: {} },
		null, // Invalid entry
		{ id: 'timer-3', name: 'T3', config: {}, canonicalLayerByScreen: {} },
	]

	const timers = listTimers(state)

	assert.strictEqual(timers.length, 3, 'Should return 3 valid timers')
	assert.ok(timers.every((t) => t && t.id), 'All returned items should be valid timers')
})

// Test 11: findBoundLayers locates layers referencing a timer
test('findBoundLayers finds all layers bound to a timer', () => {
	const state = new MockSceneState()
	const timer = { id: 'timer-1', name: 'Timer', config: {}, canonicalLayerByScreen: {} }
	state.timers.push(timer)

	state.scenes = [
		{
			id: 'scene-1',
			layers: [
				{ layerNumber: 10, source: { countdownTimerId: 'timer-1' } },
				{ layerNumber: 11, source: { value: 'media' } },
				{ layerNumber: 12, source: { countdownTimerId: 'timer-1' } },
			],
		},
		{
			id: 'scene-2',
			layers: [
				{ layerNumber: 10, source: { countdownTimerId: 'timer-1' } },
			],
		},
	]

	const bound = findBoundLayers(state, 'timer-1')

	assert.strictEqual(bound.length, 3, 'Should find 3 bound layers')
	assert.strictEqual(bound[0].sceneId, 'scene-1', 'First should be from scene-1')
	assert.strictEqual(bound[0].layerIndex, 0, 'First should be at layer index 0')
})

// Test 12: findBoundLayers returns empty when no layers bound
test('findBoundLayers returns empty array when no bindings found', () => {
	const state = new MockSceneState()
	state.scenes = [
		{
			id: 'scene-1',
			layers: [
				{ layerNumber: 10, source: { value: 'media' } },
			],
		},
	]

	const bound = findBoundLayers(state, 'nonexistent-timer')

	assert.strictEqual(bound.length, 0, 'Should return empty array')
	assert.ok(Array.isArray(bound), 'Result should be an array')
})

// Print summary
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
