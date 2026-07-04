'use strict'

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody } = require('./response')
const { resolveLicensesDir } = require('../system/licenses-path')

/**
 * @param {string} p
 * @param {Record<string, string>} [query]
 */
function handleGet(p, query = {}) {
	if (p !== '/api/system/licenses') return null
	const dir = resolveLicensesDir()
	const manifestPath = path.join(dir, 'manifest.json')
	if (!fs.existsSync(manifestPath)) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'licenses manifest not found', dir }),
		}
	}
	let manifest
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
	const componentId = String(query.component || query.id || '').trim()
	if (componentId) {
		const row = (manifest.components || []).find((c) => c.id === componentId)
		if (!row) {
			return {
				status: 404,
				headers: JSON_HEADERS,
				body: jsonBody({ error: `unknown component: ${componentId}` }),
			}
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(row) }
	}
	const indexPath = path.join(dir, 'INDEX.md')
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			...manifest,
			indexUrl: '/licenses/INDEX.md',
			indexExists: fs.existsSync(indexPath),
			licensesDir: dir,
		}),
	}
}

module.exports = { handleGet }
