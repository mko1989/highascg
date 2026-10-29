'use strict'

/**
 * WO-614 — top-level project slices owned by ONE client. The Godot previs stage lives in
 * `project.previs`; the web client rebuilds its save/autosave payload from a fixed key list
 * (client/lib/project-state.js exportProject) and never sends it, so without this rule one web
 * autosave erased the whole stage. A write that omits a client-owned key keeps the stored copy;
 * the owning client always sends the key (possibly empty), which is how it edits or clears it.
 * WO-616 T11: `fixtures` (the follow → Art-Net patch, src/fixtures/follow-patch.js) is Godot-owned too.
 */
const CLIENT_OWNED_SLICES = ['previs', 'fixtures']
/**
 * WO-807 — slices only the SERVER writes (`pixelMappings`: POST /api/fixtures/pixelmap). A client save / autosave never
 * changes them: the stored copy always wins (a Godot autosave posts its whole, possibly stale, project and retries a
 * stale rev with the same content). With no stored copy (Save As to a new name) the client's copy is kept.
 */
const SERVER_OWNED_SLICES = ['pixelMappings']

/**
 * @param {object} project incoming payload (mutated)
 * @param {object|null} existing stored project for the same slug
 * @returns {string[]} keys copied from the stored project
 */
function preserveClientOwnedSlices(project, existing) {
	if (!project || typeof project !== 'object' || !existing || typeof existing !== 'object') return []
	for (const key of SERVER_OWNED_SLICES) if (existing[key] !== undefined) project[key] = existing[key]
	const kept = []
	for (const key of CLIENT_OWNED_SLICES) {
		if (project[key] === undefined && existing[key] !== undefined) {
			project[key] = existing[key]
			kept.push(key)
		}
	}
	return kept
}

module.exports = { CLIENT_OWNED_SLICES, SERVER_OWNED_SLICES, preserveClientOwnedSlices }
