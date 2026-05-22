'use strict'

const fs = require('fs')
const path = require('path')

const { REPO_ROOT } = require('../repo-paths')

/**
 * `project.scenes` deck (looks + globalBorders) from the newest project source.
 * Prefers in-memory persistence (`web_project`) when newer than autosave.json.
 */
function loadProjectScenes() {
	let fromAutosave = null
	let fromPersist = null

	try {
		const autosavePath = path.join(REPO_ROOT, 'autosave.json')
		if (fs.existsSync(autosavePath)) {
			const project = JSON.parse(fs.readFileSync(autosavePath, 'utf8'))
			if (project?.scenes && typeof project.scenes === 'object') {
				fromAutosave = { scenes: project.scenes, savedAt: project.savedAt || null }
			}
		}
	} catch (_) {}

	try {
		const persistence = require('../utils/persistence')
		const project = persistence.get('web_project')
		if (project?.scenes && typeof project.scenes === 'object') {
			fromPersist = { scenes: project.scenes, savedAt: project.savedAt || null }
		}
	} catch (_) {}

	if (fromPersist && fromAutosave) {
		const tP = Date.parse(fromPersist.savedAt || '') || 0
		const tA = Date.parse(fromAutosave.savedAt || '') || 0
		return tP >= tA ? fromPersist.scenes : fromAutosave.scenes
	}
	return fromPersist?.scenes || fromAutosave?.scenes || null
}

module.exports = { loadProjectScenes }
