'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { patchWebpageHostUrl } = require('../../src/api/host-live-webpage')

describe('host-live-webpage', () => {
	it('patchWebpageHostUrl updates URL fields but preserves host channel and route', () => {
		const existing = {
			type: 'browser',
			routeType: 'webpage_host',
			sourceId: 'webpage_abc',
			value: 'route://6-1',
			hostChannel: 6,
			hostLayer: 1,
			templateOrUrl: 'https://old.example/',
			cefNeedle: 'old_example',
			playArg: 'https://old.example/',
			label: 'Old site',
			interactiveCapable: true,
			hostRole: 'webpage_host',
		}
		const updated = patchWebpageHostUrl(existing, 'https://highascg.dpdns.org/', 'HighASCG')
		assert.equal(updated.hostChannel, 6)
		assert.equal(updated.hostLayer, 1)
		assert.equal(updated.sourceId, 'webpage_abc')
		assert.equal(updated.value, 'route://6-1')
		assert.equal(updated.playArg, 'https://highascg.dpdns.org/')
		assert.equal(updated.label, 'HighASCG')
		assert.match(updated.cefNeedle, /highascg/i)
	})

	it('patchWebpageHostUrl rejects empty URL', () => {
		assert.throws(() => patchWebpageHostUrl({ hostChannel: 6 }, '  '), /required/i)
	})
})
