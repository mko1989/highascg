'use strict'
/**
 * WO-907: the Godot client renders the Visuals that Caspar plays (shm ring), so its main loop must not be paced by the
 * operator monitor's vsync — a missed 20 ms vblank made 40 ms frames (~44 fps into a 50 fps channel) and every alt-tab
 * blocked the swap 90–100 ms. Vsync off (ForceCompositionPipeline keeps the X screen tear-free) + a 100 fps cap.
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
	it('the box keeps the tear-free composition pipeline that makes vsync-off safe', () => {
		const setup = fs.readFileSync(path.join(root, 'scripts', 'setup', '09-openbox-autostart.sh'), 'utf8')
		assert.match(setup, /ForceCompositionPipeline/)
	})
})
