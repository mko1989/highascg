'use strict'

/**
 * WO-1101 — the shared wire codec (client/world-wire.js, an ES module the browser imports) loaded into the server with
 * require() (Node ≥ 22 loads a synchronous ES module with require; CI and the box run Node 24). One place, so the hub,
 * the interest builder and the smokes all encode with the exact code the clients decode with.
 */

let wire = null

function requireWire() {
	if (!wire) wire = require('../client/world-wire.js')
	return wire
}

module.exports = { requireWire }
