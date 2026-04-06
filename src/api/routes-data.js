/**
 * POST /api/project/save|load, /api/data/store|retrieve|list|remove
 * @see companion-module-casparcg-server/src/api-data.js
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

const PROJECT_STORE_NAME = 'casparcg_web_project'

async function handleProject(path, body, ctx) {
	const b = parseBody(body)
	const amcp = ctx.amcp
	if (path === '/api/project/save') {
		const project = b.project
		if (!project || typeof project !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Missing project' }) }
		}
		const data = typeof project === 'string' ? project : JSON.stringify(project)
		await amcp.data.dataStore(PROJECT_STORE_NAME, data)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	}
	if (path === '/api/project/load') {
		const r = await amcp.data.dataRetrieve(PROJECT_STORE_NAME)
		let project = null
		if (r?.data) {
			const raw = Array.isArray(r.data) ? r.data.join('\n') : String(r.data)
			try {
				project = JSON.parse(raw)
			} catch {
				project = null
			}
		}
		if (!project) {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'No project stored' }) }
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(project) }
	}
	return null
}

async function handleData(path, body, ctx) {
	const m = path.match(/^\/api\/data\/([^/]+)$/)
	if (!m) return null
	const b = parseBody(body)
	const cmd = m[1].toLowerCase()
	const amcp = ctx.amcp
	let r
	switch (cmd) {
		case 'store':
			r = await amcp.data.dataStore(b.name, b.data)
			break
		case 'retrieve':
			r = await amcp.data.dataRetrieve(b.name)
			break
		case 'list':
			r = await amcp.data.dataList()
			break
		case 'remove':
			r = await amcp.data.dataRemove(b.name)
			break
		default:
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Unknown data command: ${cmd}` }) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
}

async function handlePost(path, body, ctx) {
	if (!ctx.amcp) return null
	let result = await handleProject(path, body, ctx)
	if (result) return result
	result = await handleData(path, body, ctx)
	return result
}

module.exports = { handlePost, handleProject, handleData }
