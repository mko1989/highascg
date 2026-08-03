'use strict'

/**
 * WO-407 smoke — automatic GL vblank sync display (owner: "cant be done by modifying an
 * env file. it either needs to be auto or a check box in gui").
 *
 * The caspar-env file run.sh sources is now MACHINE-OWNED: rewritten on every config
 * Apply from the same layout plan that positions the outputs (screen 1's sysId), with a
 * casparServer.caspar_gl_sync_display override (auto | off | <connector>). These tests
 * pin the resolver's precedence and the apply-flow + run.sh wiring.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { resolveGlSyncDisplay } = require('../../src/utils/caspar-gl-sync-env')

test('WO-407: resolver precedence — off kills it, explicit wins, fallback to screen_1_system_id', () => {
	assert.equal(resolveGlSyncDisplay({ casparServer: { caspar_gl_sync_display: 'off' } }), null)
	assert.equal(resolveGlSyncDisplay({ casparServer: { caspar_gl_sync_display: 'none' } }), null)
	assert.equal(resolveGlSyncDisplay({ casparServer: { caspar_gl_sync_display: 'DP-4' } }), 'DP-4')
	// auto with no layout plan and no system id → null (run.sh then sets nothing)
	assert.equal(resolveGlSyncDisplay({ casparServer: {} }), null)
	// auto falls back to the stored connector when the layout plan can't resolve
	assert.equal(
		resolveGlSyncDisplay({ casparServer: { caspar_gl_sync_display: 'auto', screen_1_system_id: 'HDMI-1' } }),
		'HDMI-1',
	)
})

test('WO-407: the Device-View "NVIDIA sync to display" tick drives caspar GL sync too', () => {
	// One tick, both consumers of it: the nvidia policy script AND __GL_SYNC_DISPLAY_DEVICE.
	assert.equal(
		resolveGlSyncDisplay({
			casparServer: {
				screen_2_nvidia_sync_to_display: true,
				screen_2_system_id: 'DP-4',
				screen_1_system_id: 'DP-0',
			},
		}),
		'DP-4',
		'ticked port outranks the screen-1 auto fallback',
	)
	// Explicit override still outranks the tick (emergency escape hatch).
	assert.equal(
		resolveGlSyncDisplay({
			casparServer: { caspar_gl_sync_display: 'off', screen_2_nvidia_sync_to_display: true, screen_2_system_id: 'DP-4' },
		}),
		null,
	)
})

test('WO-407: apply flow rewrites the env file; run.sh sources and exports it', () => {
	const apply = read('src/utils/full-config-apply.js')
	assert.match(apply, /writeCasparGlSyncEnvFile\(\{ config: ctx\.config, log \}\)/, 'caspar-env refreshed on every Apply')

	const runsh = read('run.sh')
	assert.match(runsh, /\.config\/highascg\/caspar-env/, 'run.sh sources the box-local file')
	assert.match(runsh, /export __GL_SYNC_DISPLAY_DEVICE="\$CASPAR_GL_SYNC_DISPLAY"/, 'exported to caspar')

	const resolver = read('src/utils/caspar-gl-sync-env.js')
	assert.match(resolver, /calculateLayoutPositions\(config\)/, 'auto reads the layout plan, same source as the xrandr script')
	assert.match(resolver, /if \(display\) lines\.push/, 'null resolution writes the file WITHOUT the var — stale connectors cannot linger')
})
