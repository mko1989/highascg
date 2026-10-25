'use strict'

/**
 * WO-769 — multiview PRV cells read the look staged on THAT preview channel (owner 25.10: "no timers on preview
 * screen for prv channels, the layers are displayed but not running time"). They used to list the PGM look's layers
 * against the PRV channel's OSC. Also: the playlist drop hint hides once the list has items.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '../..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

/** The template's getActiveScenes, run against a channel map + scene.live. */
function activeScenesFrom(file, channelMap, sceneLive) {
	const src = read(file)
	const m = src.match(/function getActiveScenes\(isPgm, chNum\) \{[\s\S]*?\n\t\t\}\n/)
	assert.ok(m, `${file}: getActiveScenes(isPgm, chNum)`)
	return new Function('channelMap', 'sceneLive', `${m[0]}; return getActiveScenes`)(channelMap, sceneLive)
}

const channelMap = { programChannels: [1], previewChannels: [2] }
const sceneLive = { 1: { sceneId: 'look-4', scene: { id: 'look-4' } }, 2: { sceneId: 'look-3', scene: { id: 'look-3' } } }

for (const file of ['template/multiview_master.js', 'template/multiview_overlay.js']) {
	test(`${file}: PGM cells read program looks, PRV cells the preview channel's own look`, () => {
		const get = activeScenesFrom(file, channelMap, sceneLive)
		assert.deepEqual(get(true, 1).map((s) => s.id), ['look-4'])
		assert.deepEqual(get(false, 2).map((s) => s.id), ['look-3'])
		assert.deepEqual(activeScenesFrom(file, channelMap, { 1: sceneLive[1] })(false, 2), [], 'nothing staged on PRV → no rows')
	})
}

test('callers pass the cell kind, and only PGM cells filter by screen', () => {
	const labels = read('template/multiview_master-labels.js')
	const overlay = read('template/multiview_overlay.js')
	for (const src of [labels, overlay]) {
		assert.match(src, /const activeScenes = getActiveScenes\(isPgm, chNum\);/)
		assert.match(src, /if \(isPgm && lookScreenIdx !== screenIdx\) (continue|return);/)
	}
})

test('playlist section: the drop hint hides once there are items', () => {
	assert.match(read('godot/client/features/live/playlist_section.gd'), /_drop\.visible = rows\.is_empty\(\)/)
})
