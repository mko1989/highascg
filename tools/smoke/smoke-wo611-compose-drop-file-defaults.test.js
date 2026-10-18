'use strict'

/**
 * WO-611 #5: WO-592's owner decision is "file trim/mute defaults are copied into looks on drop", but the
 * compose-frame drop (scenes-compose.js addLayerFromMedia) set the source with setLayerSource, which skips
 * patchLayer's withMediaFileDefaults hook — a clip dropped on the frame arrived without its defaults.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

test('fileDefaultsPatchForNewSource returns the file defaults for a new source, {} otherwise', async () => {
	const m = await import('../../client/lib/media-file-defaults.js')
	m.setLocalMediaFileDefaults('clips/a.mov', { trimInMs: 1000, trimOutMs: 5000, muted: true })
	assert.deepEqual(m.fileDefaultsPatchForNewSource({ type: 'media', value: 'clips/a.mov' }), { trimInMs: 1000, trimOutMs: 5000, muted: true })
	assert.deepEqual(m.fileDefaultsPatchForNewSource({ type: 'media', value: 'clips/none.mov' }), {})
	assert.deepEqual(m.fileDefaultsPatchForNewSource({ type: 'template', value: 'clips/a.mov' }), {}, 'templates have no file defaults')
})

test('the compose drop applies them after setLayerSource (source)', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../client/components/scenes-compose.js'), 'utf8')
	const body = src.slice(src.indexOf('async function addLayerFromMedia'), src.indexOf('await applyNativeFillForSource(idx, sourcePayloadForFill(data))'))
	assert.match(body, /sceneState\.setLayerSource\(/)
	assert.match(body, /fileDefaultsPatchForNewSource\(\{ type: srcType, value: data\.value \}\)/)
})
