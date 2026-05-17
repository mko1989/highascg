/**
 * POST /api/project/save|load, GET /api/project, /api/data/store|retrieve|list|remove
 * Project JSON is stored locally on disk (.highascg-state.json).
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const persistence = require('../utils/persistence')

/** Full project object — same shape as POST /api/project/save body `project`. */
const PROJECT_DISK_KEY = 'web_project'

async function loadProjectMerged(ctx) {
	const project = persistence.get(PROJECT_DISK_KEY)
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
	if (path === '/api/project/autosave') {
		const project = b.project
		if (!project || typeof project !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Missing project' }) }
		}
		const fs = require('fs')
		const pathObj = require('path')
		try {
			const autosavePath = pathObj.join(__dirname, '..', '..', 'autosave.json')
			fs.writeFileSync(autosavePath, JSON.stringify(project, null, 2), 'utf8')
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
		} catch (e) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e.message }) }
		}
	}
	return null
}

async function handleProjectGet(ctx) {
	const project = await loadProjectMerged(ctx)
	if (!project) {
		// Startup-safe default: frontend probes /api/project before any save exists.
		// Returning 200 avoids boot warnings/noise and mirrors legacy behavior.
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({}) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(project) }
}

async function handleData(path, body, ctx) {
	const m = path.match(/^\/api\/data\/([^/]+)$/)
	if (!m) return null
	return { status: 410, headers: JSON_HEADERS, body: jsonBody({ error: 'AMCP DATA API removed. Use /api/project/save and local persistence.' }) }
}

async function handlePost(path, body, ctx) {
	let result = await handleData(path, body, ctx)
	return result
}

module.exports = { handlePost, handleProject, handleProjectGet, handleData, loadProjectMerged }
