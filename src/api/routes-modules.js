/**
 * GET /api/modules — report which optional feature modules are enabled on this server.
 * Used by the web client to decide which dynamic bundles to import (see
 * `web/lib/optional-modules.js`). Matches WO-30 T30.3.
 */

'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const moduleRegistry = require('../module-registry')

/**
 * @param {string} method
 * @param {string} p
 */
function handle(method, p) {
	if (method !== 'GET' || p !== '/api/modules') return null
	const info = moduleRegistry.describe()
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			enabled: info.modules,
			bundles: info.bundles,
			styles: info.styles,
			wsNamespaces: info.wsNamespaces,
		}),
	}
}

module.exports = { handle }
