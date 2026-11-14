'use strict'

/**
 * WO-1076 — the RC game as a module: how its server files reach the core. An installed copy
 * (~/.highascg/modules/rc-game) cannot `require('../../src/…')`, so every core file and core npm package goes
 * through `core(id)`: the module host's `requireCore` once register.js handed it over, else (smokes and scripts that
 * load a server file directly from the checkout) the repo this folder sits in.
 */

const path = require('path')

let host = null
const CHECKOUT_ROOT = path.join(__dirname, '..', '..', '..')

function set(h) {
	host = h || null
}

/** @param {string} id `src/<file>` or a core npm package name (`ws`) */
function core(id) {
	if (host) return host.requireCore(id)
	return require(id.startsWith('src/') ? path.join(CHECKOUT_ROOT, id) : id)
}

/** The core's root (its node_modules holds three). */
function coreRoot() {
	return host ? host.coreRoot : CHECKOUT_ROOT
}

module.exports = { set, core, coreRoot }
