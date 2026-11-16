'use strict'

/**
 * WO-1101 — the Game World registry ("the link", work/notes/game-world-contract.md §0.1). A process-global object under a
 * versioned Symbol.for key, so the world module and the games meet without requiring each other (a Symbol.for key is
 * one per process even when a module is loaded from the repo and from ~/.highascg/modules, or re-required after a
 * disable). Each game keeps its own tiny copy of this accessor (a copy, not a require).
 *   reg.games: Map(id → descriptor)   set by each game's register.js, deleted in its onShutdown
 *   reg.hub:   the world hub or null  set by this module while it is loaded
 */

const KEY = Symbol.for('highascg.game-world/1')

/** The registry (created on first use). */
function registry() {
	const g = globalThis
	if (!g[KEY]) g[KEY] = { v: 1, games: new Map(), hub: null }
	return g[KEY]
}

module.exports = { registry, KEY }
