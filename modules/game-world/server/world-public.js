'use strict'

/**
 * WO-1101 — which Game World API paths skip the API password (src/server/auth.js → the module registry's publicPaths,
 * only under this module's prefix /api/game/world). Exact path, GET only, never a prefix, never the host route:
 *   GET /api/game/world/state   public while ≥ 1 registered game descriptor has a non-null room() (a session runs);
 *                               otherwise it answers `{ on: false, games }` with the normal auth
 * The socket /api/game/world/ws checks the same condition itself (world-ws.js). In memory only, nothing stored.
 */

const STATE_PATH = '/api/game/world/state'

/** Does any registered game run a session now? Every descriptor call in try/catch. */
function anyGameEnabled(reg) {
	if (!reg || !(reg.games instanceof Map)) return false
	for (const d of reg.games.values()) {
		try {
			if (d && typeof d.room === 'function' && d.room()) return true
		} catch {}
	}
	return false
}

/** @param {string} method @param {string} apiPath path without query @param {object} reg the registry */
function isWorldPublicPath(method, apiPath, reg) {
	if (String(method || '').toUpperCase() !== 'GET') return false
	return String(apiPath || '') === STATE_PATH && anyGameEnabled(reg)
}

module.exports = { isWorldPublicPath, anyGameEnabled, STATE_PATH }
