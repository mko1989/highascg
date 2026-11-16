'use strict'

/**
 * WO-1101 — the Game World as a module: how its server files reach the core (docs/MODULES.md "External modules"). An
 * installed copy (~/.highascg/modules/game-world) cannot `require('../../src/…')`, so every core file and core npm
 * package goes through `core(id)`: the module host's `requireCore` once register.js handed it over, else (smokes that
 * load a server file directly from the checkout) the repo this folder sits in. A copy of the RC game's pattern — the
 * world module never requires a game module's file.
 */

const path = require('path')

let host = null
const CHECKOUT_ROOT = path.join(__dirname, '..', '..', '..')

function set(h) {
	host = h || null
}

/** @param {string} id `src/<file>` or a core npm package name (`ws`) */
function core(id) {
	if (host && typeof host.requireCore === 'function') return host.requireCore(id)
	return require(id.startsWith('src/') ? path.join(CHECKOUT_ROOT, id) : id)
}

/** The module host's logger (no-op without one). */
function log(level, msg) {
	try {
		if (host && typeof host.log === 'function') host.log(level, msg)
	} catch {}
}

module.exports = { set, core, log }
