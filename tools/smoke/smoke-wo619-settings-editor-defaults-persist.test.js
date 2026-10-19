'use strict'

/**
 * WO-619: POST /api/settings must persist editorDefaults. The handler normalised them onto ctx.config but left
 * them out of the config it saves, and the config-change handler then synced ctx.config back from the manager —
 * every Settings → Defaults save (web or Godot) silently reverted.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { handlePost } = require('../../src/api/settings-post')

function ctxWith(saved) {
	const config = { streaming: {}, ...JSON.parse(JSON.stringify(defaults)) }
	return {
		config,
		configManager: {
			get: () => JSON.parse(JSON.stringify(defaults)),
			save: (c) => {
				saved.push(c)
				return true
			},
		},
		log: () => {},
	}
}

describe('WO-619: settings POST persists editorDefaults', () => {
	it('a Defaults patch reaches the saved config, merged with the stored values', async () => {
		const saved = []
		const ctx = ctxWith(saved)
		const body = JSON.stringify({ editorDefaults: { timeline: { loopAlways: true }, transition: { duration: 20 } } })
		const res = await handlePost('/api/settings', body, ctx)
		assert.equal(res.status, 200)
		assert.equal(saved.length, 1)
		const ed = saved[0].editorDefaults
		assert.ok(ed, 'editorDefaults is in the saved config')
		assert.equal(ed.timeline.loopAlways, true)
		assert.equal(ed.transition.duration, 20)
		assert.equal(ed.transition.type, 'MIX', 'untouched fields keep their stored / default values')
		assert.equal(ed.scene.startBehaviour, 'beginning')
	})

	it('a save without editorDefaults keeps the stored ones', async () => {
		const saved = []
		const ctx = ctxWith(saved)
		ctx.config.editorDefaults = { ...ctx.config.editorDefaults, coordinateOrigin: 'center' }
		await handlePost('/api/settings', JSON.stringify({ usbIngest: { enabled: true } }), ctx)
		assert.equal(saved[0].editorDefaults.coordinateOrigin, 'center')
	})
})

describe('WO-619: the server content-fit enum matches the client', () => {
	it('every client content-fit value survives normalizeEditorDefaults', async () => {
		const { normalizeEditorDefaults } = require('../../src/config/editor-defaults')
		const { SCENE_CONTENT_FIT_OPTIONS } = await import('../../client/lib/scene-content-fit.js')
		for (const { value } of SCENE_CONTENT_FIT_OPTIONS) {
			const ed = normalizeEditorDefaults({ scene: { contentFit: value }, timeline: { contentFit: value } })
			assert.equal(ed.scene.contentFit, value)
			assert.equal(ed.timeline.contentFit, value)
		}
		assert.equal(normalizeEditorDefaults({ scene: { contentFit: 'bogus' } }).scene.contentFit, 'native')
	})
})
