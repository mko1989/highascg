'use strict'

/**
 * WO-1074 — which RC game API paths skip the API password (src/server/auth.js isPublicApiPath). In memory only: the
 * game starts disabled after every restart. Exact paths, GET only — never the host route, never a prefix.
 *   enabled:  GET /api/game/rc/state, /api/game/rc/scene, /api/game/rc/scene.glb (+ the game socket, rc-ws.js)
 *   disabled: GET /api/game/rc/state only (the page can say "not running")
 */

let enabled = false

const ALWAYS = new Set(['/api/game/rc/state'])
const WHILE_ENABLED = new Set(['/api/game/rc/state', '/api/game/rc/scene', '/api/game/rc/scene.glb'])

function setRcGameEnabled(on) {
	enabled = on === true
}

const isRcGameEnabled = () => enabled

/** @param {string} method @param {string} apiPath path without query */
function isRcPublicPath(method, apiPath) {
	if (String(method || '').toUpperCase() !== 'GET') return false
	const p = String(apiPath || '')
	return enabled ? WHILE_ENABLED.has(p) : ALWAYS.has(p)
}

module.exports = { setRcGameEnabled, isRcGameEnabled, isRcPublicPath }
