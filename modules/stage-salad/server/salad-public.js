'use strict'

/**
 * WO-1089 — which Stage Salad API paths skip the API password (src/server/auth.js asks the module's `publicPaths` for
 * paths under /api/game/salad only). In memory only: the game starts disabled after every restart. Exact paths, GET
 * only — never the host route, never a prefix.
 *   enabled:  GET /api/game/salad/state, /api/game/salad/scene, /api/game/salad/scene.glb (+ the game socket)
 *   disabled: GET /api/game/salad/state only (the page can say "not running")
 */

let enabled = false

const ALWAYS = new Set(['/api/game/salad/state'])
const WHILE_ENABLED = new Set(['/api/game/salad/state', '/api/game/salad/scene', '/api/game/salad/scene.glb'])

function setSaladEnabled(on) {
	enabled = on === true
}

/** @param {string} method @param {string} apiPath path without query */
function isSaladPublicPath(method, apiPath) {
	if (String(method || '').toUpperCase() !== 'GET') return false
	const p = String(apiPath || '')
	return enabled ? WHILE_ENABLED.has(p) : ALWAYS.has(p)
}

module.exports = { setSaladEnabled, isSaladPublicPath }
