'use strict'

/**
 * WO-888 — (1) caspar's GL frame sync and the NVIDIA XVideoSyncToDisplayID stick to a real PGM screen automatically:
 * a stale "NVIDIA sync to display" tick on the OPERATOR MONITOR (box 31.10: port 3 = DP-4 = the GUI head) pinned
 * caspar to the GUI's vblank; it is now ignored, any other ticked screen still wins, and the NVIDIA policy follows
 * the same resolution (before, no tick = no NVIDIA target). (2) Caspar's screen-consumer windows never take focus
 * (Openbox per-app rule, alt-tab micro stutter on PGM). (3) The Device-View GPU inspector has no Confine select.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { resolveGlSyncDisplay } = require('../../src/utils/caspar-gl-sync-env')
const { resolveNvidiaSyncToDisplayOutput } = require('../../src/utils/x-display-session-runtime')
const { withCasparRule, ensureOpenboxCasparRule, RULE_MARKER } = require('../../src/system/caspar-window-sync')

const BOX = {
	casparServer: {
		screen_1_system_id: 'DP-0',
		screen_3_system_id: 'DP-4',
		screen_3_operator_monitor: true,
		screen_3_nvidia_sync_to_display: true,
	},
}

test('a tick on the operator monitor is ignored → the PGM screen', () => {
	assert.equal(resolveGlSyncDisplay(BOX), 'DP-0')
	assert.equal(resolveNvidiaSyncToDisplayOutput(BOX), 'DP-0', 'the NVIDIA head follows the same display')
})

test('a tick on another screen still overrides the automatic PGM pick', () => {
	const cfg = { casparServer: { screen_1_system_id: 'DP-0', screen_2_system_id: 'DP-2', screen_2_nvidia_sync_to_display: true } }
	assert.equal(resolveGlSyncDisplay(cfg), 'DP-2')
	assert.equal(resolveNvidiaSyncToDisplayOutput(cfg), 'DP-2')
})

test('no tick: the NVIDIA policy follows the PGM screen too (before: no target at all)', () => {
	assert.equal(resolveNvidiaSyncToDisplayOutput({ casparServer: { screen_1_system_id: 'DP-0' } }), 'DP-0')
	assert.equal(resolveNvidiaSyncToDisplayOutput({ casparServer: { caspar_gl_sync_display: 'off', screen_1_system_id: 'DP-0' } }), null)
})

test('Openbox rule: matches the WM_CLASS instance, inserted once, idempotent', () => {
	const xml = '<openbox_config>\n<applications>\n<!-- example -->\n</applications>\n</openbox_config>\n'
	const out = withCasparRule(xml)
	assert.ok(out.includes(`${RULE_MARKER} type="normal">`), 'name= (instance), not class= — the class is the window title')
	assert.match(out, /<focus>no<\/focus>/)
	assert.match(out, /<skip_taskbar>yes<\/skip_taskbar>/, 'skip_taskbar keeps a normal window out of the alt-tab cycle')
	assert.equal(withCasparRule(out), null, 'already present')
	assert.equal(withCasparRule('<openbox_config/>'), null, 'no <applications> → untouched')

	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wo888-'))
	try {
		assert.equal(ensureOpenboxCasparRule({ home }), 'no_rc')
		fs.mkdirSync(path.join(home, '.config', 'openbox'), { recursive: true })
		fs.writeFileSync(path.join(home, '.config', 'openbox', 'rc.xml'), xml)
		let reconf = 0
		assert.equal(ensureOpenboxCasparRule({ home, reconfigure: () => reconf++ }), 'added')
		assert.equal(ensureOpenboxCasparRule({ home, reconfigure: () => reconf++ }), 'present')
		assert.equal(reconf, 1, 'reconfigure once')
		assert.equal(fs.readFileSync(path.join(home, '.config', 'openbox', 'rc.xml.pre-wo888'), 'utf8'), xml, 'backup kept')
	} finally {
		fs.rmSync(home, { recursive: true, force: true })
	}
})

test('wired: boot sync in index.js; GPU inspector without the Confine select', () => {
	const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
	assert.match(idx, /require\('\.\/src\/system\/caspar-window-sync'\)\.syncCasparWindowOnBoot\(config/)
	const ctl = fs.readFileSync(path.join(ROOT, 'godot/client/features/devices/gpu_output_controls.gd'), 'utf8')
	assert.ok(!ctl.includes('CONFINE_OPTIONS') && !ctl.includes('"confine"'), 'no confine control or save kind')
})
