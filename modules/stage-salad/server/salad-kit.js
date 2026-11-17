'use strict'

/**
 * WO-1089 — Stage Salad reuses the RC game's world code instead of copying it (work/notes/stage-salad-contract.md §1),
 * exactly as Stage Skirmish does (toy-skirmish/server/sk-kit.js). The RC module (`rc-game`) is a SIBLING that must be
 * installed (not necessarily enabled): `<modules>/rc-game` next to this module, in the checkout and under
 * ~/.highascg/modules alike. This file resolves it, hands the sibling's `server/host.js` our module host when nobody
 * did, and re-exports what the game uses:
 *   createSceneBaker            rc-scene.js — the venue GLB + floors (same rev and cache as the other games)
 *   createRcLights, rcLightsDeps, withLiveScene   rc-lights.js — the live rig (RC contract §2.6)
 *   createRcVideo, rcVideoDeps  rc-video.js — the LED wall pictures
 *   serveRcStatic               rc-static.js — the static-file logic
 *   MAX_MESSAGE_BYTES, cleanName, cleanColor   rc-sanitize.js
 *   resume                     rc-resume.js — the resume token after a reconnect (WO-1106 B34)
 *   createGameCtl, intIn       rc-ctl.js — players run the session themselves (WO-1125 self-service)
 *   core                        the sibling's host.core(id): core files / core npm packages (`ws`)
 * and `shared()`: this module's own pure ES modules in client/ (veggies, flight, venue, avatar-body, aim), loaded with
 * require() of an ES module — the server referee runs the very code the browser runs.
 * Nothing under modules/rc-game/ is edited. Sibling missing → `Stage Salad needs the "rc-game" module installed`.
 */

const fs = require('fs')
const path = require('path')

const MISSING = 'Stage Salad needs the "rc-game" module installed'
const SIBLING = path.join(__dirname, '..', '..', 'rc-game')
const CLIENT = path.join(__dirname, '..', 'client')

let host = null
let loaded = null
let ownsSiblingHost = false
let sharedMods = null

function siblingDir() {
	try {
		const dir = fs.realpathSync(SIBLING)
		return fs.existsSync(path.join(dir, 'module.json')) && fs.existsSync(path.join(dir, 'server', 'host.js')) ? dir : null
	} catch {
		return null
	}
}

/** register.js: our module host. Must run before kit() is first used. */
function init(h) {
	host = h || null
	if (!siblingDir()) throw new Error(MISSING)
}

function kit() {
	if (loaded) return loaded
	const dir = siblingDir()
	if (!dir) throw new Error(MISSING)
	const file = (f) => path.join(dir, 'server', f)
	const hostFile = require.resolve(file('host.js'))
	const fresh = !require.cache[hostFile]
	const sib = require(hostFile)
	if (fresh && host) {
		sib.set(host)
		ownsSiblingHost = true
	}
	const scene = require(file('rc-scene.js'))
	const lights = require(file('rc-lights.js'))
	const video = require(file('rc-video.js'))
	const stat = require(file('rc-static.js'))
	const san = require(file('rc-sanitize.js'))
	const resume = require(file('rc-resume.js'))
	const ctl = require(file('rc-ctl.js'))
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
		MAX_MESSAGE_BYTES: san.MAX_MESSAGE_BYTES,
		cleanName: san.cleanName,
		cleanColor: san.cleanColor,
		resume, // WO-1106 B34: the one resume-token design of the three games (rc-resume.js)
		createGameCtl: ctl.createGameCtl, // WO-1125: the one player-control rule set of the three games (rc-ctl.js)
		intIn: ctl.intIn,
	}
	return loaded
}

/** The shared pure ES modules of client/ (no sibling needed). */
function shared() {
	if (sharedMods) return sharedMods
	const m = (f) => require(path.join(CLIENT, f))
	sharedMods = { veggies: m('veggies.js'), flight: m('flight.js'), venue: m('venue.js'), body: m('avatar-body.js'), aim: m('aim.js') }
	return sharedMods
}

/** Module disabled: drop the sibling's server files we loaded (the RC module not running) from the require cache. */
function release() {
	const dir = loaded?.dir
	loaded = null
	sharedMods = null
	if (!dir || !ownsSiblingHost) return
	ownsSiblingHost = false
	if (require.cache[path.join(dir, 'register.js')]) return
	const pre = path.join(dir, 'server') + path.sep
	for (const k of Object.keys(require.cache)) if (k.startsWith(pre)) delete require.cache[k]
}

module.exports = { init, kit, shared, release, MISSING }
