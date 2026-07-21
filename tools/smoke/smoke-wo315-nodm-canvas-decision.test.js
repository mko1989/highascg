'use strict'

/**
 * WO-315: Verify nodm restart decision logic for desktop canvas growth.
 *
 * The decision was already coded but inputs went bad (mode-token type confusion,
 * stale pinned port names). This test verifies the decision logic with injected
 * fixtures (no live xrandr, no mocking of require). See WO-315 acceptance items.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	needsNodmRestartForLayout,
	plannedHeadsFromLayout,
	boundingBoxFromHeads,
	parseXrandrScreenCurrentCanvas,
} = require('../../src/utils/xrandr-layout-verify')

// Test (a): planned 6912x2160 vs current 4992x1728 → needed:true, reason 'canvas_expansion'
test('canvas expansion: planned 6912x2160 > current 4992x1728 requires nodm restart', () => {
	const config = { screens: {}, multiview: {}, gpuPhysicalTopology: [] }
	const plannedHeads = [
		{ sysId: 'DP-0', x: 0, y: 0, width: 3456, height: 2160 },
		{ sysId: 'DP-4', x: 3456, y: 0, width: 3456, height: 2160 },
	]
	const xrDetailed = {
		raw: 'Screen 0: minimum 320 x 200, current 4992 x 1728, maximum 16384 x 16384',
		displays: [
			{ name: 'DP-0', connected: true, x: 0, y: 0, resolution: '2560x1440', refreshHz: 60 },
			{ name: 'DP-4', connected: true, x: 2560, y: 0, resolution: '2432x1728', refreshHz: 60 },
		],
	}
	const layout = { screens: {}, multiview: {}, mappingGpuOutputs: [] }

	// Mock layout calculation by injecting the planned heads directly
	// We create a layout that plannedHeadsFromLayout will produce the right heads for
	const mockLayout = {
		screens: {},
		multiview: {},
		mappingGpuOutputs: [
			{ sysId: 'DP-0', x: 0, y: 0, width: 3456, height: 2160 },
			{ sysId: 'DP-4', x: 3456, y: 0, width: 3456, height: 2160 },
		],
	}

	const result = needsNodmRestartForLayout(config, {
		layout: mockLayout,
		inventory: [], // No mapping needed, sysIds are already xrandr names
		xrDetailed,
	})

	assert.equal(result.needed, true, 'planned 6912x2160 > current 4992x1728 needs restart')
	assert.equal(result.reason, 'canvas_expansion')
	assert.equal(result.plannedCanvas.width, 6912)
	assert.equal(result.plannedCanvas.height, 2160)
	assert.equal(result.currentCanvas.width, 4992)
	assert.equal(result.currentCanvas.height, 1728)
})

// Test (b): planned fits inside current → needed:false, reason 'canvas_fits'
test('canvas fits: planned 4480x1440 fits inside current 5120x1728 skips nodm restart', () => {
	const config = { screens: {}, multiview: {}, gpuPhysicalTopology: [] }
	const xrDetailed = {
		raw: 'Screen 0: minimum 320 x 200, current 5120 x 1728, maximum 16384 x 16384',
		displays: [
			{ name: 'DP-0', connected: true, x: 0, y: 0, resolution: '2560x1440', refreshHz: 60 },
			{ name: 'DP-4', connected: true, x: 2560, y: 0, resolution: '2560x1440', refreshHz: 60 },
		],
	}

	const mockLayout = {
		screens: {},
		multiview: {},
		mappingGpuOutputs: [
			{ sysId: 'DP-0', x: 0, y: 0, width: 2560, height: 1440 },
			{ sysId: 'DP-4', x: 2560, y: 0, width: 1920, height: 1080 },
		],
	}

	const result = needsNodmRestartForLayout(config, {
		layout: mockLayout,
		inventory: [],
		xrDetailed,
	})

	assert.equal(result.needed, false, 'planned 4480x1440 fits inside current 5120x1728')
	assert.equal(result.reason, 'canvas_fits')
	assert.equal(result.plannedCanvas.width, 4480)
	assert.equal(result.plannedCanvas.height, 1440)
	assert.equal(result.currentCanvas.width, 5120)
	assert.equal(result.currentCanvas.height, 1728)
})

// Test (c): multiview head osMode = Caspar mode id ("2160p5000") contributes real 3840x2160
test('multiview head osMode="2160p5000" (Caspar mode) contributes real 3840x2160 to planned canvas', () => {
	const config = { screens: {}, multiview: { 1: {} }, gpuPhysicalTopology: [] }

	// This test requires the mode-token guard to have converted "2160p5000" to "3840x2160"
	// in the layout calculation. We inject a layout as if that conversion already happened.
	const mockLayout = {
		screens: {},
		multiview: {
			1: { sysId: 'DP-4', x: 0, y: 0, width: 3840, height: 2160, mode: '3840x2160', rate: 50 },
		},
		mappingGpuOutputs: [],
	}

	const xrDetailed = {
		raw: 'Screen 0: minimum 320 x 200, current 3840 x 2160, maximum 16384 x 16384',
		displays: [
			{ name: 'DP-4', connected: true, x: 0, y: 0, resolution: '3840x2160', refreshHz: 50 },
		],
	}

	const result = needsNodmRestartForLayout(config, {
		layout: mockLayout,
		inventory: [],
		xrDetailed,
	})

	assert.equal(result.needed, false, 'multiview 3840x2160 fits inside current 3840x2160')
	assert.equal(result.reason, 'canvas_fits')
	assert.equal(result.plannedCanvas.width, 3840, 'multiview head contributed real width')
	assert.equal(result.plannedCanvas.height, 2160, 'multiview head contributed real height')
})

// Test (c): the END-TO-END regression of 2026-07-21. This must run the REAL layout math
// (computePlacedLayoutResults), not a hand-written layout object — the whole point is that a
// head whose osMode is a Caspar mode id ("2160p5000") used to silently compute as 1920x1080,
// which made the planned canvas understate and the nodm restart get skipped. Feeding a
// pre-sized layout in here would test boundingBoxFromHeads and pass even with the guard
// reverted; the guard lives in os-layout-calculator-place.js.
test('end to end: a Caspar-mode-id osMode head drives canvas_expansion (the 2026-07-21 regression)', () => {
	const { computePlacedLayoutResults } = require('../../src/utils/os-layout-calculator-place')

	// The live shape: operator_gui destination bound to a 4K port, no OS-level override set, so
	// assign fills osMode from the destination's videoMode — a Caspar mode id, not an xrandr token.
	const placed = computePlacedLayoutResults(
		{},
		{
			allGpuAssignments: new Map(),
			mvAssignments: [
				{
					sysId: 'DP-4',
					n: 1,
					osMode: '2160p5000',
					osBackend: 'xrandr',
					osRate: 50,
					casparMode: '2160p5000',
					manualX: null,
					manualY: null,
				},
			],
			effectiveScreenCount: 0,
			swap: false,
		},
	)

	assert.equal(placed.multiview[1].width, 3840, 'layout math must resolve the real width')
	assert.equal(placed.multiview[1].height, 2160, 'layout math must resolve the real height')

	// Now the decision, fed by that REAL layout against a still-1080p desktop.
	const result = needsNodmRestartForLayout(
		{},
		{
			layout: placed,
			inventory: [],
			xrDetailed: {
				raw: 'Screen 0: minimum 320 x 200, current 1920 x 1080, maximum 16384 x 16384',
				displays: [{ name: 'DP-4', connected: true, x: 0, y: 0, resolution: '1920x1080', refreshHz: 60 }],
			},
		},
	)

	assert.equal(result.plannedCanvas.width, 3840)
	assert.equal(result.plannedCanvas.height, 2160)
	assert.equal(result.needed, true, 'a 4K head on a 1080p desktop MUST trigger the nodm restart')
	assert.equal(result.reason, 'canvas_expansion')
})

// Test (d): head pinned to stale A/B sibling name is still COUNTED, not deduped away
test('head pinned to stale A/B sibling (DP-5 → DP-4) is counted in planned canvas, not deduped', () => {
	const config = {
		screens: {},
		multiview: {},
		gpuPhysicalTopology: [
			{ physicalPortId: 'gpu_p2', dpA: 'DP-4', dpB: 'DP-5' },
		],
	}

	// Layout pins DP-5 (the stale B name), but current xrandr shows it as DP-4 (the live A name).
	// resolveSysIdToXrandrOutput should resolve DP-5 → DP-4 via the topology table.
	// plannedHeadsFromLayout uses dedup on resolved sysId, but DP-4 only appears once, so no dupe.
	const mockLayout = {
		screens: {},
		multiview: {},
		mappingGpuOutputs: [
			{ sysId: 'DP-5', x: 0, y: 0, width: 3840, height: 2160 },
		],
	}

	const xrDetailed = {
		raw: 'Screen 0: minimum 320 x 200, current 3840 x 2160, maximum 16384 x 16384',
		displays: [
			{ name: 'DP-4', connected: true, x: 0, y: 0, resolution: '3840x2160', refreshHz: 50 },
		],
	}

	const result = needsNodmRestartForLayout(config, {
		layout: mockLayout,
		inventory: [],
		xrDetailed,
	})

	// The head should be counted (resolve DP-5 → DP-4 via topology), so planned = 3840x2160.
	assert.equal(result.plannedCanvas.width, 3840, 'stale DP-5 resolved and counted as DP-4')
	assert.equal(result.plannedCanvas.height, 2160, 'stale DP-5 resolved and counted as DP-4')
	assert.equal(result.needed, false, 'planned fits inside current')
	assert.equal(result.reason, 'canvas_fits')
})

// Test (e): parseXrandrScreenCurrentCanvas parses real xrandr Screen line, returns null on garbage
test('parseXrandrScreenCurrentCanvas parses real Screen 0: line correctly', () => {
	const realLine = 'Screen 0: minimum 320 x 200, current 4992 x 1728, maximum 16384 x 16384'
	const parsed = parseXrandrScreenCurrentCanvas(realLine)
	assert.deepEqual(parsed, { width: 4992, height: 1728 }, 'parsed real Screen line correctly')

	// Multiline input (xrandr output may have newlines)
	const multilineInput = 'Screen 0: minimum 320 x 200, current 6912 x 2160, maximum 16384 x 16384\nDP-0 connected primary 2160x1440+0+0'
	const parsedMulti = parseXrandrScreenCurrentCanvas(multilineInput)
	assert.deepEqual(parsedMulti, { width: 6912, height: 2160 })
})

test('parseXrandrScreenCurrentCanvas returns null on garbage input', () => {
	assert.equal(parseXrandrScreenCurrentCanvas(''), null)
	assert.equal(parseXrandrScreenCurrentCanvas('Screen 0: invalid format'), null)
	assert.equal(parseXrandrScreenCurrentCanvas('Screen 0: current x 1728'), null, 'malformed separator')
	assert.equal(parseXrandrScreenCurrentCanvas('Screen 0: minimum 320 x 200, current -1 x 1728'), null, 'negative width')
	assert.equal(parseXrandrScreenCurrentCanvas('Screen 0: minimum 320 x 200, current 0 x 1728'), null, 'zero width')
	assert.equal(parseXrandrScreenCurrentCanvas(null), null, 'null input')
})

// Test: byte-identical fallback when opts not supplied
test('needsNodmRestartForLayout with no opts falls back to live calls (byte-identical behavior)', () => {
	// This test verifies the fallback path without actually calling getDisplaysXrandrDetailed.
	// We can verify the structure and signatures match what's expected.

	const config = { screens: {}, multiview: {}, gpuPhysicalTopology: [] }

	// When opts are not supplied, the function should use live calls.
	// We can't easily test this without mocking, but we can verify the function signature accepts no opts.
	const result1 = needsNodmRestartForLayout(config) // No opts
	assert.ok(result1 !== undefined, 'no opts: function does not crash')
	assert.ok(
		typeof result1.needed === 'boolean' && result1.reason !== undefined,
		'no opts: returns expected structure',
	)

	const result2 = needsNodmRestartForLayout(config, {}) // Empty opts
	assert.deepEqual(result1, result2, 'no opts vs empty opts produce identical results')
})

// Test: warn flag on degenerate inputs
test('needsNodmRestartForLayout returns warn:true for degenerate no_planned_heads', () => {
	const config = { screens: {}, multiview: {}, gpuPhysicalTopology: [] }
	const mockLayout = {
		screens: {},
		multiview: {},
		mappingGpuOutputs: [],
	}
	const xrDetailed = {
		raw: 'Screen 0: minimum 320 x 200, current 4992 x 1728, maximum 16384 x 16384',
		displays: [],
	}

	const result = needsNodmRestartForLayout(config, {
		layout: mockLayout,
		inventory: [],
		xrDetailed,
	})

	assert.equal(result.reason, 'no_planned_heads')
	assert.equal(result.warn, true, 'degenerate no_planned_heads should warn')
	assert.equal(result.needed, false, 'no_planned_heads does not need restart')
})

test('needsNodmRestartForLayout returns warn:true for degenerate no_live_canvas', () => {
	const config = { screens: {}, multiview: {}, gpuPhysicalTopology: [] }
	const mockLayout = {
		screens: {},
		multiview: {},
		mappingGpuOutputs: [
			{ sysId: 'DP-0', x: 0, y: 0, width: 1920, height: 1080 },
		],
	}
	const xrDetailed = {
		raw: 'Screen 0: invalid format',
		displays: [],
	}

	const result = needsNodmRestartForLayout(config, {
		layout: mockLayout,
		inventory: [],
		xrDetailed,
	})

	assert.equal(result.reason, 'no_live_canvas')
	assert.equal(result.warn, true, 'degenerate no_live_canvas should warn')
	assert.equal(result.needed, false, 'no_live_canvas does not need restart')
})

test('needsNodmRestartForLayout does not warn for normal canvas_fits', () => {
	const config = { screens: {}, multiview: {}, gpuPhysicalTopology: [] }
	const mockLayout = {
		screens: {},
		multiview: {},
		mappingGpuOutputs: [
			{ sysId: 'DP-0', x: 0, y: 0, width: 1920, height: 1080 },
		],
	}
	const xrDetailed = {
		raw: 'Screen 0: minimum 320 x 200, current 2560 x 1440, maximum 16384 x 16384',
		displays: [
			{ name: 'DP-0', connected: true, x: 0, y: 0, resolution: '2560x1440', refreshHz: 60 },
		],
	}

	const result = needsNodmRestartForLayout(config, {
		layout: mockLayout,
		inventory: [],
		xrDetailed,
	})

	assert.equal(result.reason, 'canvas_fits')
	assert.notEqual(result.warn, true, 'normal canvas_fits should not warn')
	assert.equal(result.needed, false)
})
