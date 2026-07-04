'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

describe('hasPreviewLookForMain', () => {
	it('returns true when PRV channel has a look in scene.live', async () => {
		const { hasPreviewLookForMain } = await import('../../client/lib/scene-live-main-sync.js')
		const cm = { programChannels: [1], previewChannels: [2] }
		const sceneLive = { '1': { sceneId: 'pgm' }, '2': { sceneId: 'prv' } }
		const exists = (id) => id === 'pgm' || id === 'prv'
		assert.equal(hasPreviewLookForMain(0, sceneLive, cm, exists, null), true)
	})

	it('returns false when PRV is empty', async () => {
		const { hasPreviewLookForMain } = await import('../../client/lib/scene-live-main-sync.js')
		const cm = { programChannels: [1], previewChannels: [2] }
		const sceneLive = { '1': { sceneId: 'pgm' } }
		const exists = (id) => id === 'pgm'
		assert.equal(hasPreviewLookForMain(0, sceneLive, cm, exists, null), false)
	})

	it('falls back to client preview slot', async () => {
		const { hasPreviewLookForMain } = await import('../../client/lib/scene-live-main-sync.js')
		const cm = { programChannels: [1], previewChannels: [2] }
		const fallback = { getPreviewSceneIdForMain: () => 'prv' }
		const exists = (id) => id === 'prv'
		assert.equal(hasPreviewLookForMain(0, {}, cm, exists, fallback), true)
	})

	it('detects PRV when same look is on PGM and PRV', async () => {
		const { hasPreviewLookForMain } = await import('../../client/lib/scene-live-main-sync.js')
		const cm = { programChannels: [1], previewChannels: [2] }
		const sceneLive = { '1': { sceneId: 'look-a' }, '2': { sceneId: 'look-a' } }
		const exists = (id) => id === 'look-a'
		assert.equal(hasPreviewLookForMain(0, sceneLive, cm, exists, null), true)
	})
})
