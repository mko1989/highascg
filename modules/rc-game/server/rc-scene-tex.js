'use strict'

/**
 * WO-1082 / WO-1098 — the venue's textures for a phone: the code lives in the core (src/stage/scene-tex.js, shared with
 * the OBJ venue importer); the game's files keep requiring it by this name.
 */

const { core } = require('./host')

module.exports = core('src/stage/scene-tex')
