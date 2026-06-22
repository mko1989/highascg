'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { shouldApplyStraightAlphaKeyer } = require('../../src/engine/scene-take-lbg-helpers')

describe('shouldApplyStraightAlphaKeyer', () => {
	it('enables KEYER for alpha stills', () => {
		assert.equal(shouldApplyStraightAlphaKeyer('testowe/foo.png', true), true)
	})

	it('enables KEYER for alpha video containers when straightAlpha is set', () => {
		assert.equal(shouldApplyStraightAlphaKeyer('PAL_HD_1080p25_QT_Anim_100_48kHz.mov', true), true)
		assert.equal(shouldApplyStraightAlphaKeyer('media/clip.webm', true), true)
	})

	it('does not enable KEYER for regular video without straightAlpha flag', () => {
		assert.equal(shouldApplyStraightAlphaKeyer('clip.mov', false), false)
	})

	it('does not enable KEYER for routes or HTML placeholders', () => {
		assert.equal(shouldApplyStraightAlphaKeyer('route://1', true), false)
		assert.equal(shouldApplyStraightAlphaKeyer('[HTML] black', true), false)
	})
})
