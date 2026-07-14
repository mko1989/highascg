'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

/**
 * WO-214 smoke tests: timeline mixer row rendering and channel lookup.
 * Tests the fix for getActiveTimelineForChannel which was calling cm.programCh?.() instead of cm.programChannels[].
 * @see client/lib/audio-mixer-rows.js:77
 */

/**
 * Smoke test 1: Verify that code no longer uses the nonexistent cm.programCh?.() method.
 * This is a source-level regression check.
 */
function test_noNonexistentProgramChMethod() {
	const filePath = path.join(__dirname, '../../client/lib/audio-mixer-rows.js')
	const moduleContent = fs.readFileSync(filePath, 'utf-8')

	// The bug was calling cm.programCh?.() — this should NOT appear in the file
	assert(
		!moduleContent.includes('programCh?.('),
		'ERROR: code still contains the buggy cm.programCh?.() call',
	)

	// The fix should use programChannels?.[screenIdx]
	assert(
		moduleContent.includes('programChannels?.[screenIdx]'),
		'MISSING: expected code to use cm.programChannels?.[screenIdx]',
	)

	console.log('✓ No nonexistent programCh?.() method found')
}

/**
 * Smoke test 2: Verify the sendTo field names match the real structure.
 * The guard should check sendTo.program and sendTo.screenIdx.
 */
function test_sendToFieldNames() {
	const filePath = path.join(__dirname, '../../client/lib/audio-mixer-rows.js')
	const moduleContent = fs.readFileSync(filePath, 'utf-8')

	// sendTo.program should be checked
	assert(
		moduleContent.includes('sendTo.program === true'),
		'MISSING: expected code to check sendTo.program === true',
	)

	// sendTo.screenIdx should be used
	assert(
		moduleContent.includes('sendTo.screenIdx'),
		'MISSING: expected code to use sendTo.screenIdx',
	)

	console.log('✓ sendTo field names are correct (program, screenIdx)')
}

/**
 * Smoke test 3: Verify that timeline layer count and index usage.
 * TIMELINE_LAYER_BASE + tlLayerIdx should be used, where tlLayerIdx is the array index.
 */
function test_timelineLayerBase() {
	const filePath = path.join(__dirname, '../../client/lib/audio-mixer-rows.js')
	const moduleContent = fs.readFileSync(filePath, 'utf-8')

	// Should define TIMELINE_LAYER_BASE locally (line 102)
	assert(
		moduleContent.includes('const TIMELINE_LAYER_BASE = 210'),
		'MISSING: expected TIMELINE_LAYER_BASE = 210',
	)

	// Should use it with tlLayerIdx
	assert(
		moduleContent.includes('TIMELINE_LAYER_BASE + tlLayerIdx'),
		'MISSING: expected code to use TIMELINE_LAYER_BASE + tlLayerIdx',
	)

	console.log('✓ TIMELINE_LAYER_BASE (210) used correctly for layer mapping')
}

/**
 * Run all smoke tests.
 */
function runAllTests() {
	try {
		console.log('\n[WO-214 Smoke Tests] timeline mixer row channel lookup fix\n')

		test_noNonexistentProgramChMethod()
		test_sendToFieldNames()
		test_timelineLayerBase()

		console.log('\n✅ All smoke tests passed!\n')
		process.exit(0)
	} catch (err) {
		console.error('\n❌ Smoke test failed:', err.message, '\n')
		console.error(err.stack)
		process.exit(1)
	}
}

runAllTests()
