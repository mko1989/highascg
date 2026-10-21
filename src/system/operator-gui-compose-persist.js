'use strict'

/**
 * Operator-GUI compose layout → active project file (split out of operator-gui-channel.js, which owns the AMCP side).
 */

/* Owner request 2026-07-26 (compose placement is project state): debounced merge of the applied
 * cell set into the active project file. bumpRev:false + pushVolumes:false like deck-sync merges —
 * this must never outrun a client's rev echo or spam the volume push. Content-equal merges no-op
 * both here and in persistProject. */
const COMPOSE_PROJECT_PERSIST_DEBOUNCE_MS = 2000
let _composeProjectPersistTimer = null
let _composeProjectPersistPending = null
function scheduleComposeLayoutProjectPersist(ctx, cells) {
	_composeProjectPersistPending = { ctx, cells }
	if (_composeProjectPersistTimer) clearTimeout(_composeProjectPersistTimer)
	_composeProjectPersistTimer = setTimeout(() => {
		_composeProjectPersistTimer = null
		const pending = _composeProjectPersistPending
		_composeProjectPersistPending = null
		if (!pending?.ctx || !Array.isArray(pending.cells) || !pending.cells.length) return
		try {
			const { loadFullProject } = require('../engine/project-scenes-load')
			const { persistProject } = require('../engine/project-scenes')
			const existing = loadFullProject()
			if (!existing) return
			if (JSON.stringify(existing.operatorCompose?.cells || []) === JSON.stringify(pending.cells)) return
			const project = {
				...existing,
				operatorCompose: { cells: pending.cells, savedAt: new Date().toISOString() },
			}
			void persistProject(pending.ctx, project, { writeAutosave: true, pushVolumes: false, bumpRev: false })
		} catch (e) {
			pending.ctx.log?.('warn', `[operator-gui] compose layout project persist: ${e?.message || e}`)
		}
	}, COMPOSE_PROJECT_PERSIST_DEBOUNCE_MS)
	if (_composeProjectPersistTimer.unref) _composeProjectPersistTimer.unref()
}

module.exports = { scheduleComposeLayoutProjectPersist }
