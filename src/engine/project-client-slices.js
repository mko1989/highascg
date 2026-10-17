'use strict'

/**
 * WO-614 — top-level project slices owned by ONE client. The Godot previs stage lives in
 * `project.previs`; the web client rebuilds its save/autosave payload from a fixed key list
 * (client/lib/project-state.js exportProject) and never sends it, so without this rule one web
 * autosave erased the whole stage. A write that omits a client-owned key keeps the stored copy;
 * the owning client always sends the key (possibly empty), which is how it edits or clears it.
 */
const CLIENT_OWNED_SLICES = ['previs']

/**
 * @param {object} project incoming payload (mutated)
 * @param {object|null} existing stored project for the same slug
 * @returns {string[]} keys copied from the stored project
 */
function preserveClientOwnedSlices(project, existing) {
	if (!project || typeof project !== 'object' || !existing || typeof existing !== 'object') return []
	const kept = []
	for (const key of CLIENT_OWNED_SLICES) {
		if (project[key] === undefined && existing[key] !== undefined) {
			project[key] = existing[key]
			kept.push(key)
		}
	}
	return kept
}

module.exports = { CLIENT_OWNED_SLICES, preserveClientOwnedSlices }
