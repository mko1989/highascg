/**
 * Template Editor (CG Studio) module registration.
 * Loaded by `src/module-registry.tryLoad('cg-studio')` when the module is enabled.
 */

'use strict'

const { handleHealth, handleSave } = require('./routes')

module.exports = {
	name: 'cg-studio',

	onBoot(ctx) {
		if (ctx && typeof ctx.log === 'function') {
			ctx.log('info', '[cg-studio] Template Editor module initialized')
		}
	},

	apiPathPrefixes: ['/api/cg-studio'],

	async handleApi({ method, path, body, ctx, req, query }) {
		if (method === 'GET' && path === '/api/cg-studio/health') {
			return handleHealth(ctx)
		}
		if (method === 'POST' && path === '/api/cg-studio/save') {
			return handleSave(ctx, body)
		}
		return null
	},

	webBundles: ['/assets/modules/cg-studio/entry.js'],
}
