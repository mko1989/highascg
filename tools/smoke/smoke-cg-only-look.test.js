'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { isCgOnlyLook, isCgTemplateLayer } = require('../../src/engine/scene-look-kind')

describe('scene-look-kind', () => {
	it('isCgOnlyLook is false for empty looks', () => {
		assert.equal(isCgOnlyLook(null), false)
		assert.equal(isCgOnlyLook({ layers: [] }), false)
	})

	it('isCgOnlyLook is true for lower-third only look', () => {
		const scene = {
			layers: [
				{
					layerNumber: 20,
					source: { type: 'template', value: 'LOWER-THIRDS/LT-CLASSIC-BOX' },
					cgData: { data: { title: 'A', subtitle: 'B' }, style: {} },
				},
			],
		}
		assert.equal(isCgOnlyLook(scene), true)
	})

	it('isCgOnlyLook is false when mixed with media', () => {
		const scene = {
			layers: [
				{ layerNumber: 10, source: { type: 'media', value: 'clip.mp4' } },
				{ layerNumber: 20, source: { type: 'template', value: 'LOWER-THIRDS/LT-CLASSIC-BOX' } },
			],
		}
		assert.equal(isCgOnlyLook(scene), false)
	})

	it('isCgOnlyLook is false for placeholder color grid', () => {
		const scene = {
			layers: [
				{
					layerNumber: 10,
					source: { type: 'placeholder', template: 'color_grid', isPlaceholder: true },
				},
			],
		}
		assert.equal(isCgOnlyLook(scene), false)
	})

	it('isCgOnlyLook is false for timeline layer', () => {
		const scene = {
			layers: [{ layerNumber: 10, source: { type: 'timeline', value: 'tl-1' } }],
		}
		assert.equal(isCgOnlyLook(scene), false)
	})

	it('isCgOnlyLook is false for playlist with media item', () => {
		const scene = {
			layers: [
				{
					layerNumber: 10,
					sourceMode: 'list',
					source: { type: 'template', value: 'LOWER-THIRDS/LT-CLASSIC-BOX' },
					playlist: [{ source: { type: 'media', value: 'a.mp4' } }],
				},
			],
		}
		assert.equal(isCgOnlyLook(scene), false)
	})

	it('isCgTemplateLayer accepts html type', () => {
		assert.equal(
			isCgTemplateLayer({ source: { type: 'html', value: 'playback_timers.html' } }),
			true,
		)
	})

	it('isCgOnlyLook accepts multi-layer CG stack', () => {
		const scene = {
			layers: [
				{ layerNumber: 20, source: { type: 'template', value: 'LOWER-THIRDS/LT-CLASSIC-BOX' } },
				{ layerNumber: 30, source: { type: 'template', value: 'LOWER-THIRDS/LT-SLIDE-BAR' } },
			],
		}
		assert.equal(isCgOnlyLook(scene), true)
	})
})
