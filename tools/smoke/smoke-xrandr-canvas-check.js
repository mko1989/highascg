const test = require('node:test')
const assert = require('node:assert/strict')

const {
	boundingBoxFromHeads,
	parseXrandrScreenCurrentCanvas,
	needsNodmRestartForLayout,
} = require('../../src/utils/xrandr-layout-verify')

test('parseXrandrScreenCurrentCanvas reads Screen line', () => {
	const raw = 'Screen 0: minimum 8 x 8, current 8960 x 1080, maximum 32767 x 32767\n'
	assert.deepEqual(parseXrandrScreenCurrentCanvas(raw), { width: 8960, height: 1080 })
})

test('needsNodmRestartForLayout when planned width exceeds current canvas', () => {
	const heads = [{ x: 0, y: 0, width: 5120, height: 1024 }, { x: 5120, y: 0, width: 1920, height: 1080 }, { x: 7040, y: 0, width: 1920, height: 1080 }]
	const planned = boundingBoxFromHeads(heads)
	assert.equal(planned.width, 8960)
	const check = needsNodmRestartForLayout({
		screen_count: 2,
		deviceGraph: require('../../config/device_graph.json'),
		screenDestinations: require('../../config/screen_destinations.json'),
	})
	assert.ok(check.plannedCanvas)
	assert.ok(['canvas_fits', 'canvas_expansion', 'no_live_canvas'].includes(check.reason))
})
