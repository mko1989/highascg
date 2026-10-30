'use strict'

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

module.exports = {
	handleProject,
	handleProjectGet,
	handleProjectFile,
	handleProjectList,
	handleProjectDelete,
	loadProjectMerged,
	flushProjectSyncBroadcast,
	scheduleProjectSyncBroadcast,
}
