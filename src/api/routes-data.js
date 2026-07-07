'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { handleProject } = require('./routes-data-project-handlers')
const {
	handleProjectGet,
	handleProjectFile,
	handleProjectList,
	handleProjectDelete,
	loadProjectMerged,
} = require('./routes-data-project-read')
const {
	flushProjectSyncBroadcast,
	scheduleProjectSyncBroadcast,
} = require('./routes-data-project-sync')

async function handleData(path, _body, _ctx) {
	const m = path.match(/^\/api\/data\/([^/]+)$/)
	if (!m) return null
	return {
		status: 410,
		headers: JSON_HEADERS,
		body: jsonBody({ error: 'AMCP DATA API removed. Use /api/project/save and local persistence.' }),
	}
}

async function handlePost(path, body, ctx) {
	return handleData(path, body, ctx)
}

module.exports = {
	handlePost,
	handleProject,
	handleProjectGet,
	handleProjectFile,
	handleProjectList,
	handleProjectDelete,
	handleData,
	loadProjectMerged,
	flushProjectSyncBroadcast,
	scheduleProjectSyncBroadcast,
}
