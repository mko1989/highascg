'use strict'

/**
 * Resolve a look/scene by id from a project JSON envelope.
 * @param {object|null|undefined} project
 * @param {string} sceneId
 * @returns {object|null}
 */
function findSceneInProject(project, sceneId) {
	if (!project || !sceneId) return null
	const id = String(sceneId).trim()
	if (!id) return null
	const envelope = project.scenes
	if (!envelope || typeof envelope !== 'object') return null
	if (Array.isArray(envelope.scenes)) {
		return envelope.scenes.find((s) => s && String(s.id) === id) || null
	}
	const direct = envelope[id]
	return direct && typeof direct === 'object' ? direct : null
}

module.exports = { findSceneInProject }
