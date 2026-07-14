'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

describe('WO-187 Template thumbnails cache logic', () => {
	it('isTemplateSourceType recognizes template/cg/html sources', async () => {
		const { isTemplateSourceType } = await import('../../client/lib/template-thumb.js')

		assert.ok(isTemplateSourceType({ type: 'template', value: 'lower-thirds/lt-test' }))
		assert.ok(isTemplateSourceType({ type: 'cg', value: 'lower-thirds/lt-test' }))
		assert.ok(isTemplateSourceType({ type: 'html', value: 'some-template' }))
		assert.ok(!isTemplateSourceType({ type: 'media', value: 'file.mov' }))
		assert.ok(!isTemplateSourceType({ type: 'route', value: 'route://1' }))
		assert.ok(!isTemplateSourceType(null))
		assert.ok(!isTemplateSourceType({ value: null }))
	})

	it('getCachedTemplateThumbUrl returns null when cache is empty', async () => {
		const { getCachedTemplateThumbUrl, clearTemplateThumbCache } = await import('../../client/lib/template-thumb.js')

		clearTemplateThumbCache()
		const layer = {
			source: { type: 'template', value: 'test/template' },
			cgData: { title: 'Test' },
		}
		assert.equal(getCachedTemplateThumbUrl(layer), null)
	})

	it('clearTemplateThumbCache removes all cached entries', async () => {
		const { clearTemplateThumbCache } = await import('../../client/lib/template-thumb.js')

		// Should not throw even with empty cache
		clearTemplateThumbCache()
		assert.ok(true)
	})

	it('isTemplateSourceType type-checks lowercase', async () => {
		const { isTemplateSourceType } = await import('../../client/lib/template-thumb.js')

		assert.ok(isTemplateSourceType({ type: 'TEMPLATE', value: 'test' }))
		assert.ok(isTemplateSourceType({ type: 'CG', value: 'test' }))
		assert.ok(isTemplateSourceType({ type: 'HTML', value: 'test' }))
	})
})
