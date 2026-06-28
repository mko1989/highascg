'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { buildSupportBundleZip } = require('../support/build-support-bundle')

/**
 * @param {string} p
 * @param {Record<string, string>} [query]
 * @param {object} ctx
 */
async function handleGet(p, query = {}, ctx) {
	if (p !== '/api/support/bundle') return null
	try {
		const logLines = parseInt(String(query.logLines || '5000'), 10) || 5000
		const casparLines = parseInt(String(query.casparLines || '2000'), 10) || 2000
		const { buffer, filename } = await buildSupportBundleZip(ctx, { logLines, casparLines })
		return {
			status: 200,
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Content-Length': String(buffer.length),
			},
			body: buffer,
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

/**
 * @param {string} p
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(p, body, ctx) {
	if (p !== '/api/support/bundle') return null
	try {
		const b = parseBody(body) || {}
		const { buffer, filename } = await buildSupportBundleZip(ctx, {
			logLines: b.logLines,
			casparLines: b.casparLines,
			operatorNote: b.operatorNote,
		})
		return {
			status: 200,
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Content-Length': String(buffer.length),
			},
			body: buffer,
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

module.exports = { handleGet, handlePost }
