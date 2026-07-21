'use strict'

/**
 * Reported live 2026-07-21: after wiring the operator monitor to a true DisplayPort connector,
 * the operator_gui destination's shape-overlay hole-punch rect kept computing 1920x1080 instead of
 * the destination's real 3840x2160 (2160p50), and the pinned GPU port identity ("DP-5" from an
 * earlier boot) no longer matched the currently-live connector name ("DP-4" — same physical port,
 * different xrandr enumeration). Two independent root causes, both fixed here:
 *
 *  1. os-layout-calculator-place.js: a multiview/operator_gui head's `osMode` can be filled from
 *     the destination's Caspar mode id (e.g. "2160p5000") when no OS-level override is set. Trusting
 *     that literally as an xrandr mode token fails the WxH match and silently falls back to 1920x1080.
 *  2. xrandr-output-resolve.js: resolveSysIdToXrandrOutput never consulted the GPU port A/B pairing
 *     table (config.gpuPhysicalTopology) before falling back to a fuzzy "closest name" heuristic.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { computePlacedLayoutResults } = require('../../src/utils/os-layout-calculator-place')
const {
	resolveSysIdToXrandrOutput,
	findTopologyPairForName,
	resolveViaPortPair,
} = require('../../src/utils/xrandr-output-resolve')

test('multiview head osMode = Caspar mode id (not a pixel token) resolves real WxH, not the 1920x1080 default', () => {
	const assignments = {
		allGpuAssignments: new Map(),
		mvAssignments: [
			{ sysId: 'DP-4', n: 1, osMode: '2160p5000', osBackend: 'xrandr', osRate: 50, casparMode: '2160p5000', manualX: null, manualY: null },
		],
		effectiveScreenCount: 0,
		swap: false,
	}
	const results = computePlacedLayoutResults({}, assignments)
	assert.equal(results.multiview[1].width, 3840)
	assert.equal(results.multiview[1].height, 2160)
	assert.equal(results.multiview[1].mode, '3840x2160')
})

test('multiview head osMode that IS already a real xrandr pixel token is still used as-is', () => {
	const assignments = {
		allGpuAssignments: new Map(),
		mvAssignments: [
			{ sysId: 'DP-4', n: 1, osMode: '1920x1080_50.00', osBackend: 'xrandr', osRate: 50, casparMode: '1080p5000', manualX: null, manualY: null },
		],
		effectiveScreenCount: 0,
		swap: false,
	}
	const results = computePlacedLayoutResults({}, assignments)
	assert.equal(results.multiview[1].mode, '1920x1080_50.00')
})

test('screen head with a Caspar-mode-id osMode also gets the real WxH (same guard, screen kind)', () => {
	const assignments = {
		allGpuAssignments: new Map([
			[1, { sysId: 'DP-0', osMode: '2160p5000', osBackend: 'xrandr', osRate: 50, casparMode: '2160p5000', manualX: null, manualY: null }],
		]),
		mvAssignments: [],
		effectiveScreenCount: 1,
		swap: false,
	}
	const results = computePlacedLayoutResults({}, assignments)
	assert.equal(results.screens[1].width, 3840)
	assert.equal(results.screens[1].height, 2160)
})

test('findTopologyPairForName finds the physical port owning a pinned dp name, either side', () => {
	const config = {
		gpuPhysicalTopology: [
			{ physicalPortId: 'gpu_p2', dpA: 'DP-4', dpB: 'DP-5' },
		],
	}
	assert.equal(findTopologyPairForName('DP-5', config)?.physicalPortId, 'gpu_p2')
	assert.equal(findTopologyPairForName('DP-4', config)?.physicalPortId, 'gpu_p2')
	assert.equal(findTopologyPairForName('DP-9', config), null)
	assert.equal(findTopologyPairForName('DP-5', {}), null)
})

test('resolveViaPortPair returns the OTHER pair member only when it is currently live', () => {
	const config = { gpuPhysicalTopology: [{ physicalPortId: 'gpu_p2', dpA: 'DP-4', dpB: 'DP-5' }] }
	const liveDp4Only = [{ name: 'DP-0', connected: true }, { name: 'DP-4', connected: true }]
	assert.equal(resolveViaPortPair('DP-5', config, liveDp4Only), 'DP-4')
	assert.equal(resolveViaPortPair('DP-4', config, liveDp4Only), '')
	const neitherLive = [{ name: 'DP-0', connected: true }]
	assert.equal(resolveViaPortPair('DP-5', config, neitherLive), '')
})

test('resolveSysIdToXrandrOutput: a stale pinned name resolves via its live A/B port sibling (real 2026-07-21 case)', () => {
	const config = {
		gpuPhysicalTopology: [
			{ physicalPortId: 'gpu_p0', dpA: 'DP-0', dpB: 'DP-1' },
			{ physicalPortId: 'gpu_p2', dpA: 'DP-4', dpB: 'DP-5' },
		],
	}
	const displays = [{ name: 'DP-0', connected: true }, { name: 'DP-4', connected: true }]
	// The port's cable/enumeration flipped from "B" (DP-5, pinned in config) to "A" (DP-4, live now).
	assert.equal(resolveSysIdToXrandrOutput('DP-5', { config, displays }), 'DP-4')
	// Already-live name is returned unchanged (first branch, no pairing needed).
	assert.equal(resolveSysIdToXrandrOutput('DP-4', { config, displays }), 'DP-4')
})

test('resolveSysIdToXrandrOutput: with no topology table, falls through to the pre-existing same-kind heuristic (unchanged behavior)', () => {
	const displays = [{ name: 'DP-0', connected: true }]
	assert.equal(resolveSysIdToXrandrOutput('DP-5', { config: {}, displays, inventory: [] }), 'DP-0')
})

test('wiring: the mode-token guard and port-pair resolution are actually in place', () => {
	const placeSrc = fs.readFileSync(path.join(__dirname, '../../src/utils/os-layout-calculator-place.js'), 'utf8')
	assert.match(placeSrc, /\blooksLikeXrandrModeToken\b/)
	assert.match(placeSrc, /osModeSource === 'edid' && rawOsMode && looksLikeXrandrModeToken/)

	const resolveSrc = fs.readFileSync(path.join(__dirname, '../../src/utils/xrandr-output-resolve.js'), 'utf8')
	assert.match(resolveSrc, /\bresolveViaPortPair\(/)
	assert.match(resolveSrc, /gpuPhysicalTopology/)
})
