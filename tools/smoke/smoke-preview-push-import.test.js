'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

test('scenes-preview-push-scene imports syncPreviewLiveToServer', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../client/lib/scenes-preview-push-scene.js'), 'utf8')
	assert.match(src, /import\s+\{\s*syncPreviewLiveToServer\s*\}\s+from\s+'\.\/scene-live-sync\.js'/)
	assert.match(src, /return\s+\{\s*\n\s*lastPreviewLayers:/)
	const syncIdx = src.indexOf('await syncPreviewLiveToServer')
	const returnIdx = src.indexOf('return {\n\t\t\tlastPreviewLayers:')
	assert.ok(syncIdx >= 0 && returnIdx > syncIdx, 'snapshot return should follow live sync (AMCP snapshot must persist even if sync fails)')
})
