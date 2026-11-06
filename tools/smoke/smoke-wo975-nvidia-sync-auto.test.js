'use strict'

/**
 * WO-975 — the "NVIDIA sync to display" tick is tri-state. AUTO (nothing chosen): the first screen destination (config
 * order) in a PGM mode with a PGM cable to a GPU port -> that port, never the operator monitor. An explicit tick on any
 * port wins (legacy meaning), `nvidia_sync_to_display_off: true` is an explicit OFF (no NVIDIA / Caspar sync device).
 * Stored `false` per-port values are NOT an explicit off.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
	nvidiaSyncToDisplayMode,
	nvidiaSyncAutoPortIndex,
} = require('../../src/utils/x-display-session-layout-resolve')
const { resolveGlSyncDisplay } = require('../../src/utils/caspar-gl-sync-env')
const { resolveNvidiaSyncToDisplayOutput } = require('../../src/utils/x-display-session-runtime')

const gpu = (n, name) => ({ id: `gpu_p${n}`, deviceId: 'caspar_host', kind: 'gpu_out', externalRef: name })
const dst = (id) => ({ id: `dst_in_${id}`, deviceId: 'destinations', kind: 'destination_in', externalRef: id })
/** Operator GUI -> gpu_p3 (port 4); Dioda (pgm_prv) PRV -> gpu_p0, PGM -> gpu_p1 (port 2); Proj -> gpu_p2 (port 3). */
function rig(extra = {}) {
	return {
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'gui', mode: 'operator_gui' },
				{ id: 'dioda', mode: 'pgm_prv' },
				{ id: 'proj', mode: 'pgm_prv' },
			],
		},
		deviceGraph: {
			version: 1,
			devices: [{ id: 'caspar_host', role: 'caspar_host' }, { id: 'destinations', role: 'destinations' }],
			connectors: [dst('gui'), dst('dioda'), dst('proj'), gpu(0, 'DP-0'), gpu(1, 'DP-2'), gpu(2, 'DP-4'), gpu(3, 'DP-6')],
			edges: [
				{ id: 'e1', sourceId: 'dst_in_gui', sinkId: 'gpu_p3' },
				{ id: 'e2', sourceId: 'dst_in_dioda', sinkId: 'gpu_p0', note: '{"outputLayer":2}' },
				{ id: 'e3', sourceId: 'dst_in_dioda', sinkId: 'gpu_p1' },
				{ id: 'e4', sourceId: 'dst_in_proj', sinkId: 'gpu_p2' },
			],
		},
		casparServer: { screen_4_operator_monitor: true, ...extra },
	}
}

test('auto: first PGM screen destination, its PGM-cabled port (PRV cable skipped, operator GUI never)', () => {
	const cfg = rig()
	assert.equal(nvidiaSyncAutoPortIndex(cfg), 2)
	assert.deepEqual(nvidiaSyncToDisplayMode(cfg), { mode: 'auto', port: 2 })
	assert.equal(resolveGlSyncDisplay(cfg), 'DP-2')
	assert.equal(resolveNvidiaSyncToDisplayOutput(cfg), 'DP-2', 'NVIDIA policy and Caspar GL sync share the one device')
})

test('stored false on every port is still AUTO (old default writes)', () => {
	const cfg = rig({ screen_1_nvidia_sync_to_display: false, screen_2_nvidia_sync_to_display: false })
	assert.equal(nvidiaSyncToDisplayMode(cfg).mode, 'auto')
	assert.equal(resolveGlSyncDisplay(cfg), 'DP-2')
})

test('explicit tick on another port wins (legacy configs keep their meaning)', () => {
	const cfg = rig({ screen_3_nvidia_sync_to_display: true })
	assert.deepEqual(nvidiaSyncToDisplayMode(cfg), { mode: 'on', port: 3 })
	assert.equal(resolveGlSyncDisplay(cfg), 'DP-4')
})

test('explicit OFF beats auto; ticking clears it by precedence', () => {
	const off = rig({ nvidia_sync_to_display_off: true })
	assert.equal(nvidiaSyncToDisplayMode(off).mode, 'off')
	assert.equal(resolveGlSyncDisplay(off), null)
	assert.equal(resolveNvidiaSyncToDisplayOutput(off), null)
	const tick = rig({ nvidia_sync_to_display_off: true, screen_3_nvidia_sync_to_display: true })
	assert.equal(nvidiaSyncToDisplayMode(tick).mode, 'on')
})

test('caspar_gl_sync_display override still outranks the tick state', () => {
	assert.equal(resolveGlSyncDisplay(rig({ caspar_gl_sync_display: 'DP-9' })), 'DP-9')
	assert.equal(resolveGlSyncDisplay(rig({ caspar_gl_sync_display: 'off' })), null)
})

test('the auto port is never the operator monitor; no PGM cable -> no auto port', () => {
	const cfg = rig({ screen_2_operator_monitor: true, screen_4_operator_monitor: false })
	assert.equal(nvidiaSyncAutoPortIndex(cfg), 3, 'falls through to the next PGM screen destination')
	const none = rig()
	none.deviceGraph.edges = []
	assert.equal(nvidiaSyncAutoPortIndex(none), null)
})
