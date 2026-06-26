'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	resolveTemplateCgHostLayer,
	resolveCgRequestChannel,
	normalizeCgRequest,
} = require('../../src/engine/cg-routing')

test('resolveTemplateCgHostLayer maps logical look layers to 700+ overlay stack', () => {
	assert.equal(resolveTemplateCgHostLayer(10, 'lower-thirds/lt-tag-badge'), 700)
	assert.equal(resolveTemplateCgHostLayer(20, 'lower-thirds/lt-tag-badge'), 710)
	assert.equal(resolveTemplateCgHostLayer(30, 'lower-thirds/lt-tag-badge'), 720)
	assert.equal(resolveTemplateCgHostLayer(720, 'lower-thirds/lt-tag-badge'), 720)
})

test('resolveCgRequestChannel uses mainScreenIndex when channel omitted', () => {
	const ctx = {
		getState: () => ({ channelMap: { programChannels: [1, 2, 3] } }),
	}
	assert.equal(resolveCgRequestChannel({ mainScreenIndex: 2 }, ctx), 3)
	assert.equal(resolveCgRequestChannel({ channel: 3 }, ctx), 3)
})

test('normalizeCgRequest remaps logical layer and resolves channel', () => {
	const ctx = {
		getState: () => ({ channelMap: { programChannels: [1, 2, 3] } }),
	}
	const out = normalizeCgRequest(
		{ mainScreenIndex: 2, layer: 30, template: 'lower-thirds/lt-tag-badge' },
		ctx,
	)
	assert.equal(out.channel, 3)
	assert.equal(out.layer, 720)
})
