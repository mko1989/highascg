'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	resolveCgTemplateName,
	buildSceneTemplateCgAmcpLines,
	buildSceneTemplateCgSpec,
	isSceneTemplateLayer,
} = require('../../src/engine/scene-template-cg')

describe('scene-template-cg', () => {
	it('resolveCgTemplateName maps TLS ids to Caspar CG names', () => {
		assert.equal(
			resolveCgTemplateName('CASPARCG-GUIDE-HTML-TEMPLATE-MASTER/HTML/LOWER-THIRD.1'),
			'casparcg-guide-html-template-master/html/lower-third.1',
		)
		assert.equal(resolveCgTemplateName('COLOR_BG'), 'color_bg')
		assert.equal(
			resolveCgTemplateName('CASPARCG-TEMPLATES-MAIN/LOOP-IO/ONE-LINER'),
			'casparcg-templates-main/loop-io/one-liner',
		)
	})

	it('buildSceneTemplateCgSpec detects template layers', () => {
		const layer = {
			source: {
				type: 'template',
				value: 'CASPARCG-GUIDE-HTML-TEMPLATE-MASTER/HTML/LOWER-THIRD.1',
			},
		}
		const spec = buildSceneTemplateCgSpec(layer, layer.source.value, {})
		assert.ok(spec)
		assert.equal(spec.cgName, 'casparcg-guide-html-template-master/html/lower-third.1')
		assert.equal(isSceneTemplateLayer(layer, layer.source.value, {}), true)
	})

	it('buildSceneTemplateCgAmcpLines emits CG not LOADBG', () => {
		const lines = buildSceneTemplateCgAmcpLines(3, 20, {
			cgName: 'casparcg-guide-html-template-master/html/lower-third.1',
			data: '{}',
		})
		assert.ok(lines.some((l) => l.startsWith('CG 3-20 ADD')))
		assert.ok(lines.some((l) => l.startsWith('CG 3-20 PLAY')))
		assert.equal(lines.some((l) => l.startsWith('LOADBG')), false)
		assert.equal(lines.some((l) => l.startsWith('PLAY 3-20')), false)
	})
})
