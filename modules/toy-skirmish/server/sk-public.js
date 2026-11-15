'use strict'

/**
 * WO-1081 — which Stage Skirmish API paths skip the API password (src/server/auth.js asks the module's `publicPaths`
 * for paths under /api/game/sk only). In memory only: the game starts disabled after every restart. Exact paths, GET
 * only — never the host route, never a prefix.
 *   enabled:  GET /api/game/sk/state, /api/game/sk/scene, /api/game/sk/scene.glb (+ the game socket, sk-ws.js)
 *   disabled: GET /api/game/sk/state only (the page can say "not running")
 */

let enabled = false

const ALWAYS = new Set(['/api/game/sk/state'])
const WHILE_ENABLED = new Set(['/api/game/sk/state', '/api/game/sk/scene', '/api/game/sk/scene.glb'])

function setSkGameEnabled(on) {
	enabled = on === true
}

const isSkGameEnabled = () => enabled

/** @param {string} method @param {string} apiPath path without query */
function isSkPublicPath(method, apiPath) {
	if (String(method || '').toUpperCase() !== 'GET') return false
	const p = String(apiPath || '')
	return enabled ? WHILE_ENABLED.has(p) : ALWAYS.has(p)
}

module.exports = { setSkGameEnabled, isSkGameEnabled, isSkPublicPath }
