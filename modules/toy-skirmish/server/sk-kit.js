'use strict'

/**
 * WO-1081 — Stage Skirmish reuses the RC game's world code instead of copying it (work/notes/skirmish-game-contract.md §1).
 * The RC module (`rc-game`) is a SIBLING that must be installed (not necessarily enabled): `<modules>/rc-game` next to
 * this module — in the checkout (`modules/rc-game`) and under `~/.highascg/modules/` alike. This file resolves it, hands
 * the sibling's `server/host.js` our module host when nobody did (the RC module not loaded: its files reach core files /
 * core packages through it), and re-exports what Skirmish uses:
 *   createSceneBaker            rc-scene.js — floors, `occ`, height field, GLB, `scale` (its `tracks` are dropped by sk-scene.js)
 *   createRcLights, rcLightsDeps, withLiveScene   rc-lights.js — the live rig in the game world (§2.6 of the RC contract)
 *   createRcVideo, rcVideoDeps  rc-video.js — the LED wall pictures
 *   serveRcStatic               rc-static.js — the static-file logic (decode once, traversal / symlink refused, MIME list)
 *   occFromJSON, distanceTransform   rc-scene-occ.js — the occupancy grid
 *   MAX_MESSAGE_BYTES, cleanName, cleanColor, PALETTE   rc-sanitize.js — the 2 KB cap and the name / colour rules
 *   core                        the sibling's host.core(id): `src/…` core files and core npm packages (`ws`)
 * Nothing under modules/rc-game/ is edited. Sibling missing → `Stage Skirmish needs the "rc-game" module installed`.
 */

const fs = require('fs')
const path = require('path')

const MISSING = 'Stage Skirmish needs the "rc-game" module installed'
const SIBLING = path.join(__dirname, '..', '..', 'rc-game')

let host = null
let loaded = null
let ownsSiblingHost = false

/** The sibling's directory (real path) or null. */
function siblingDir() {
	try {
		const dir = fs.realpathSync(SIBLING)
		return fs.existsSync(path.join(dir, 'module.json')) && fs.existsSync(path.join(dir, 'server', 'host.js')) ? dir : null
	} catch {
		return null
	}
}

/** register.js: our module host (frozen object from the module loader). Must run before kit() is first used. */
function init(h) {
	host = h || null
	if (!siblingDir()) throw new Error(MISSING)
}

/** The kit (loaded once). Throws MISSING when the sibling is not installed. */
function kit() {
	if (loaded) return loaded
	const dir = siblingDir()
	if (!dir) throw new Error(MISSING)
	const file = (f) => path.join(dir, 'server', f)
	const hostFile = require.resolve(file('host.js'))
	const fresh = !require.cache[hostFile]
	const sib = require(hostFile)
	// the RC module loaded through the module host has already set its own; a fresh copy gets ours (same core either way)
	if (fresh && host) {
		sib.set(host)
		ownsSiblingHost = true
	}
	const scene = require(file('rc-scene.js'))
	const lights = require(file('rc-lights.js'))
	const video = require(file('rc-video.js'))
	const stat = require(file('rc-static.js'))
	const occ = require(file('rc-scene-occ.js'))
	const san = require(file('rc-sanitize.js'))
	loaded = {
		dir,
		clientDir: path.join(dir, 'client'),
		core: sib.core,
		createSceneBaker: scene.createSceneBaker,
		createRcLights: lights.createRcLights,
		rcLightsDeps: lights.rcLightsDeps,
		withLiveScene: lights.withLiveScene,
		createRcVideo: video.createRcVideo,
		rcVideoDeps: video.rcVideoDeps,
		serveRcStatic: stat.serveRcStatic,
		occFromJSON: occ.fromJSON,
		distanceTransform: occ.distanceTransform,
		MAX_MESSAGE_BYTES: san.MAX_MESSAGE_BYTES,
		cleanName: san.cleanName,
		cleanColor: san.cleanColor,
		PALETTE: san.PALETTE,
	}
	return loaded
}

/**
 * Module disabled: when WE loaded the sibling's server files (the RC module is not running — its register.js is not
 * in the require cache), drop them from the cache so a disabled Skirmish holds nothing of them.
 */
function release() {
	const dir = loaded?.dir
	loaded = null
	if (!dir || !ownsSiblingHost) return
	ownsSiblingHost = false
	if (require.cache[path.join(dir, 'register.js')]) return
	const pre = path.join(dir, 'server') + path.sep
	for (const k of Object.keys(require.cache)) if (k.startsWith(pre)) delete require.cache[k]
}

module.exports = { init, kit, release, MISSING }
