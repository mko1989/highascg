'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { urlMatchesNeedle, cefMatchTokens } = require('../../src/system/cef-interactive-cdp')

describe('cef URL needle matching', () => {
	it('matches template filename needle', () => {
		assert.equal(urlMatchesNeedle('file:///template/interactive_click_test.html', 'interactive_click_test'), true)
	})

	it('matches live URL via playArg when slug needle fails', () => {
		const playArg = 'https://highascg.dpdns.org/'
		const slugNeedle = 'https_highascg_dpdns_org'
		assert.equal(urlMatchesNeedle('https://highascg.dpdns.org/', slugNeedle, playArg), true)
	})

	it('cefMatchTokens derives hostname from slug', () => {
		const tokens = cefMatchTokens('https_highascg_dpdns_org', 'https://highascg.dpdns.org/')
		assert.ok(tokens.includes('highascg.dpdns.org'))
	})
})
