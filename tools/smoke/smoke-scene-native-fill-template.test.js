'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { fetchCinfResolutionFromAmcp } = require('../../src/engine/scene-native-fill')

describe('scene-native-fill template CINF skip', () => {
	it('fetchCinfResolutionFromAmcp returns null for template paths', async () => {
		let called = false
		const self = {
			amcp: {
				query: {
					cinf: async () => {
						called = true
						return { data: '' }
					},
				},
			},
		}
		const r = await fetchCinfResolutionFromAmcp(self, 'CASPARCG-GUIDE-HTML-TEMPLATE-MASTER/HTML/LOWER-THIRD.1')
		assert.equal(r, null)
		assert.equal(called, false)
	})
})
