'use strict'

/**
 * WO-439 (owner escalation on WO-437): the Device-View "NVIDIA sync to display" tick is the
 * owner's ONE control for both the NVIDIA vsync policy (HIGHASCG_NVIDIA_SYNC_OUTPUT) and
 * caspar's GL swap gating (__GL_SYNC_DISPLAY_DEVICE) — owner 03.08, WO-407. Both consumers
 * resolved the ticked PORT to an output NAME only via `screen_N_system_id` / layout-plan
 * screens, which do not exist on a mapping-node-only rig — so the tick was read and then
 * silently dropped, and the owner's explicit instruction did nothing.
 *
 * Contract pinned here: a ticked port must resolve through the device graph's gpu_p{N-1}
 * connector when screen assignments are absent, for BOTH consumers.
 */

const { test } = require('node:test')
const assert = require('node:assert')

/** Mapping-node-only rig: tick set, NO screen_N_system_id, NO screen destinations. */
function mappingOnlyConfig(tickPort, connectorName) {
	return {
		casparServer: { [`screen_${tickPort}_nvidia_sync_to_display`]: true },
		deviceGraph: {
			devices: [{ id: 'caspar_host', role: 'caspar_host' }],
			connectors: [
				{ id: `gpu_p${tickPort - 1}`, deviceId: 'caspar_host', kind: 'gpu_out', externalRef: connectorName },
			],
			edges: [],
		},
	}
}

test('WO-439: ticked port resolves via the graph connector when no screens are assigned', () => {
	const { resolveGpuPortIndexToXrandrOutput } = require('../../src/utils/xrandr-output-resolve')
	assert.equal(resolveGpuPortIndexToXrandrOutput(mappingOnlyConfig(1, 'DP-0'), 1), 'DP-0')
	assert.equal(resolveGpuPortIndexToXrandrOutput(mappingOnlyConfig(3, 'DP-4'), 3), 'DP-4')
	assert.equal(resolveGpuPortIndexToXrandrOutput(mappingOnlyConfig(1, 'DP-0'), 2), '', 'unticked port has no connector here')
})

test('WO-439: GL-sync resolution honours the tick on a mapping-only rig', () => {
	const { resolveGlSyncDisplay } = require('../../src/utils/caspar-gl-sync-env')
	assert.equal(
		resolveGlSyncDisplay(mappingOnlyConfig(1, 'DP-0')),
		'DP-0',
		'the tick is priority 1 — it must never be silently dropped for lack of screen assignments',
	)
	// The tick placement is authoritative: moving it moves the sync head.
	assert.equal(resolveGlSyncDisplay(mappingOnlyConfig(3, 'DP-4')), 'DP-4')
})

test('WO-439: NVIDIA policy export honours the tick on a mapping-only rig', () => {
	const { resolveNvidiaSyncToDisplayOutput } = require('../../src/utils/x-display-session-runtime')
	assert.equal(resolveNvidiaSyncToDisplayOutput(mappingOnlyConfig(1, 'DP-0')), 'DP-0')
	assert.equal(resolveNvidiaSyncToDisplayOutput({ casparServer: {} }), null, 'no tick → no export')
})

test('WO-439: explicit screen_N_system_id still outranks the graph connector', () => {
	const { resolveGlSyncDisplay } = require('../../src/utils/caspar-gl-sync-env')
	const cfg = mappingOnlyConfig(1, 'DP-0')
	cfg.casparServer.screen_1_system_id = 'DP-7'
	assert.equal(resolveGlSyncDisplay(cfg), 'DP-7')
})
