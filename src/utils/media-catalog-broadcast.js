'use strict'

const { getTemplateCatalog, getRawMediaCatalog } = require('../api/media-catalog')

/**
 * Push template (and optional media counts) to all WS clients after CLS/TLS refresh.
 * Slim-bootstrap / deferred-catalog clients rely on catalog_chunk; others use change paths.
 * @param {object} ctx
 */
function broadcastTemplateCatalog(ctx) {
	if (!ctx || typeof ctx._wsBroadcast !== 'function') return
	const templates = getTemplateCatalog(ctx)
	const templateCount = templates.length
	ctx._wsBroadcast('change', { path: 'templates', value: templates })
	ctx._wsBroadcast('change', { path: 'templateCount', value: templateCount })
	ctx._wsBroadcast('catalog_chunk', {
		slice: 'templates',
		offset: 0,
		total: templateCount,
		items: templates,
		done: true,
	})
}

/**
 * @param {object} ctx
 */
function broadcastMediaCatalogCounts(ctx) {
	if (!ctx || typeof ctx._wsBroadcast !== 'function') return
	const mediaCount = getRawMediaCatalog(ctx).length
	ctx._wsBroadcast('change', { path: 'mediaCount', value: mediaCount })
}

module.exports = {
	broadcastTemplateCatalog,
	broadcastMediaCatalogCounts,
}
