'use strict'
/**
 * WO-907: the Godot client renders the Visuals that Caspar plays (shm ring), so its main loop must not be paced by the
 * operator monitor's vsync — a missed 20 ms vblank made 40 ms frames (~44 fps into a 50 fps channel) and every alt-tab
 * blocked the swap 90–100 ms. Vsync off (ForceCompositionPipeline keeps the X screen tear-free) + a 100 fps cap.
 * WO-1088: the 100 is now the boot value; app/render_pacer.gd holds 2× the fed channel's rate while a publisher writes a
 * ring (raised in start(), before the first frame) and the monitor rate only once nothing has published for a hold.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const project = fs.readFileSync(path.join(root, 'godot', 'client', 'project.godot'), 'utf8')

describe('WO-907 client render loop is not vsync-paced', () => {
	it('vsync is off and the loop is capped at 100 fps', () => {
		assert.match(project, /^window\/vsync\/vsync_mode=0$/m)
		assert.match(project, /^run\/max_fps=100$/m)
	})
	it('WO-1088: while publishing the cap is at least 2× the channel it feeds, raised before the first published frame', () => {
		const pacer = fs.readFileSync(path.join(root, 'godot', 'client', 'app', 'render_pacer.gd'), 'utf8')
		const pub = fs.readFileSync(path.join(root, 'godot', 'client', 'features', 'shm_out', 'viewport_publisher.gd'), 'utf8')
		assert.match(pacer, /return idle if top <= 0\.0 else maxi\(idle, roundi\(2\.0 \* top\)\)/)
		assert.doesNotMatch(pacer, /window_set_vsync_mode|VSYNC_/, 'the pacer never touches vsync')
		const start = pub.slice(pub.indexOf('func start('), pub.indexOf('func stop('))
		assert.match(start, /Pacer\.publish_started\(get_instance_id\(\), fps\)\s+# before the first published frame/)
		assert.match(pub, /sink\.close\(\)\n\t\tPacer\.publish_stopped\(get_instance_id\(\)\)/)
		assert.match(pacer, /static func publish_stopped[\s\S]*?_schedule_apply\(\)/, 'lowering waits for the hold')
		assert.match(pacer, /const HOLD_S := 5\.0/)
	})
	it('the box keeps the tear-free composition pipeline that makes vsync-off safe', () => {
		const setup = fs.readFileSync(path.join(root, 'scripts', 'setup', '09-openbox-autostart.sh'), 'utf8')
		assert.match(setup, /ForceCompositionPipeline/)
	})
})
