/**
 * POST /api/project/save|load, GET /api/project, /api/data/store|retrieve|list|remove
 * Project JSON is mirrored to disk (.highascg-state.json) so load works when Caspar DATA returns 404
 * or the bridge is used without a successful Caspar DATA store.
 * @see companion-module-casparcg-server/src/api-data.js
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const persistence = require('../utils/persistence')

const PROJECT_STORE_NAME = 'casparcg_web_project'
/** Full project object — same shape as POST /api/project/save body `project`. */
const PROJECT_DISK_KEY = 'web_project'

function parseProjectFromAmcpData(data) {
	if (data == null) return null
	const raw = Array.isArray(data) ? data.join('\n') : String(data)
	try {
		const project = JSON.parse(raw)
		return project && typeof project === 'object' ? project : null
	} catch {
		return null
	}
}

/**
 * Caspar DATA store first (if AMCP up), then local mirror from last Save in web UI.
 * @param {object} ctx
 * @returns {Promise<object | null>}
 */
async function loadProjectMerged(ctx) {
	let project = null
	const amcp = ctx.amcp
	if (amcp?.data) {
		try {
			const r = await amcp.data.dataRetrieve(PROJECT_STORE_NAME)
			project = parseProjectFromAmcpData(r?.data)
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('debug', '[project] Caspar DATA retrieve: ' + (e.message || e))
			}
		}
	}
	if (!project) {
		project = persistence.get(PROJECT_DISK_KEY)
	}
	return project && typeof project === 'object' ? project : null
}

async function handleProject(path, body, ctx) {
	const b = parseBody(body)
	if (path === '/api/project/save') {
		const project = b.project
		if (!project || typeof project !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Missing project' }) }
		}
		persistence.set(PROJECT_DISK_KEY, project)
		const amcp = ctx.amcp
		if (amcp?.data) {
			try {
				const data = typeof project === 'string' ? project : JSON.stringify(project)
				await amcp.data.dataStore(PROJECT_STORE_NAME, data)
			} catch (e) {
				if (typeof ctx.log === 'function') {
					ctx.log(
						'warn',
						'[project] Caspar DATA store failed — project still saved on server disk: ' + (e.message || e),
					)
				}
			}
		}
		if (typeof ctx._wsBroadcast === 'function') {
			try {
				ctx._wsBroadcast('project_sync', project)
			} catch (e) {
				if (typeof ctx.log === 'function') {
					ctx.log('warn', '[project] WebSocket broadcast failed: ' + (e?.message || e))
				}
			}
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	}
	if (path === '/api/project/load') {
		const project = await loadProjectMerged(ctx)
		if (!project) {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'No project stored' }) }
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(project) }
	}
	return null
}

async function handleProjectGet(ctx) {
	const project = await loadProjectMerged(ctx)
	if (!project) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'No project stored' }) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(project) }
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
	let result = await handleData(path, body, ctx)
	return result
}

module.exports = { handlePost, handleProject, handleProjectGet, handleData, loadProjectMerged }
