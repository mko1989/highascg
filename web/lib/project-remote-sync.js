/**
 * Skip one incoming WebSocket `project_sync` after a successful local Save (same payload echoed back).
 */
let skipNextRemoteProjectSync = false

export function markLocalProjectSaved() {
	skipNextRemoteProjectSync = true
}

/** @returns {boolean} true if this sync should be ignored (already applied locally) */
export function consumeSkipRemoteProjectSync() {
	if (!skipNextRemoteProjectSync) return false
	skipNextRemoteProjectSync = false
	return true
}
