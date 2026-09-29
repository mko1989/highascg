'use strict'

/**
 * WO-573 follow-up (21.09.2026, owner: "the multiview + operator gui needs a fix. they can both
 * be enabled when needed so they need separate binding.") — a genuine `multiview`-mode destination
 * and an `operator_gui` destination, cabled to two DIFFERENT physical GPU outputs, must both be
 * placed independently. Before this fix, `os-layout-calculator-assign.js` classified both as
 * `binding.type: 'multiview'` with a hardcoded `index: 1`, so `os-layout-calculator-place.js` put
 * BOTH into the same `results.multiview[1]` slot — whichever connector the device-graph loop
 * visited last silently won, and the other destination's window/xrandr head vanished from the plan
 * entirely (never applied, never verified, never offered to `resolveLayoutRectForOperatorPort`).
 *
 * This test cables them to separate GPU ports and asserts BOTH survive with distinct positions —
 * it fails against the pre-fix code (one of the two heads is simply missing).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateLayoutPositions } = require('../../src/utils/os-layout-calculator')

const HOST = 'caspar_host'
const DEST_DEV = 'destinations_1'

function config() {
	return {
		screen_count: 1,
		casparServer: { screen_count: 1 },
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'og1', label: 'Operator GUI', mainScreenIndex: 2, mode: 'operator_gui', videoMode: 'custom', width: 1920, height: 1080, fps: 50 },
				{ id: 'mv1', label: 'Multiview', mainScreenIndex: 0, mode: 'multiview', videoMode: 'custom', width: 3840, height: 1080, fps: 50 },
				{ id: 'main1', label: 'Main', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000' },
			],
		},
		screen_1_mode: '1080p5000',
		screen_1_system_id: 'DP-0',
		deviceGraph: {
			devices: [
				{ id: HOST, role: 'caspar_host', label: 'Host' },
				{ id: DEST_DEV, role: 'destinations', label: 'Dest' },
			],
			connectors: [
				{ id: 'gpu_p0', deviceId: HOST, kind: 'gpu_out', label: 'gpu_p0', externalRef: 'DP-0' },
				{ id: 'gpu_p1', deviceId: HOST, kind: 'gpu_out', label: 'gpu_p1', externalRef: 'DP-6' },
				{ id: 'gpu_p2', deviceId: HOST, kind: 'gpu_out', label: 'gpu_p2', externalRef: 'DP-5' },
				{ id: 'dst_in_main1', deviceId: DEST_DEV, kind: 'destination_in', externalRef: 'main1', label: 'in' },
				{ id: 'dst_in_mv1', deviceId: DEST_DEV, kind: 'destination_in', externalRef: 'mv1', label: 'in' },
				{ id: 'dst_in_og1', deviceId: DEST_DEV, kind: 'destination_in', externalRef: 'og1', label: 'in' },
			],
			edges: [
				{ id: 'e_main', sourceId: 'dst_in_main1', sinkId: 'gpu_p0' },
				{ id: 'e_mv', sourceId: 'dst_in_mv1', sinkId: 'gpu_p1' },
				{ id: 'e_og', sourceId: 'dst_in_og1', sinkId: 'gpu_p2' },
			],
		},
	}
}

test('WO-573: multiview and operator_gui on separate GPU ports both survive layout planning', () => {
	const layout = calculateLayoutPositions(config())

	assert.ok(layout.multiview?.[1], 'the genuine multiview destination must have a placed head')
	assert.ok(layout.operatorGui?.[1], 'operator_gui must have its OWN placed head')

	assert.equal(layout.multiview[1].sysId, 'DP-6')
	assert.equal(layout.operatorGui[1].sysId, 'DP-5')

	assert.notEqual(
		layout.multiview[1].x,
		layout.operatorGui[1].x,
		'the two heads must not collapse onto the same position (the pre-fix collision)',
	)
	assert.deepEqual({ w: layout.multiview[1].width, h: layout.multiview[1].height }, { w: 3840, h: 1080 })
	assert.deepEqual({ w: layout.operatorGui[1].width, h: layout.operatorGui[1].height }, { w: 1920, h: 1080 })
})

test('WO-573: xrandr-layout-verify sees BOTH heads as planned (not just whichever won the collision)', () => {
	const { plannedHeadsFromLayout } = require('../../src/utils/xrandr-layout-verify')
	const layout = calculateLayoutPositions(config())
	const planned = plannedHeadsFromLayout(layout)
	const sysIds = planned.map((h) => h.sysId)
	assert.ok(sysIds.includes('DP-6'), 'multiview head must be in the planned set')
	assert.ok(sysIds.includes('DP-5'), 'operator_gui head must be in the planned set')
})

test('WO-573: resolveLayoutRectForOperatorPort resolves operator_gui port to its own rect, not the multiview one', () => {
	const { resolveLayoutRectForOperatorPort } = require('../../src/utils/x-display-session-layout')
	const layout = calculateLayoutPositions(config())
	// gpu_p2 -> DP-5 -> physical screen index 3 (gpu_p2 is the 3rd rear jack, 1-based)
	const rect = resolveLayoutRectForOperatorPort(config(), layout, 3)
	assert.ok(rect, 'operator_gui port must resolve to a rect')
	assert.equal(rect.kind, 'operator_gui')
	assert.equal(rect.sysId, 'DP-5')
	assert.equal(rect.width, 1920)
	assert.equal(rect.height, 1080)
})
