'use strict'

/**
 * WO-1105 — the box's game-hosting defaults, config section `games` (src/config/defaults-core.js; saved through
 * POST /api/settings {games} — the hand-listed `newConfig` in src/api/settings-post.js carries it).
 *   joinAddress: ''           '' = automatic, else an IPv4 or an interface name (games-join.js pickAddress)
 *   autoOpen: false           open the enabled games' sessions (lobby only, never a round) when the server starts
 *   defaults: { <gameId>: { bots: 0–32, botLevel: 'easy'|'normal'|'hard', main: number|null, affect: 'on'|'soft'|'off' } }
 *                             applied when a session is opened from Settings ▸ Games (or by autoOpen); `main` is the
 *                             game's one main number (RC laps, Skirmish minutes, Salad round seconds), null = the game's own
 * Which modules are enabled is not here: that is ~/.highascg/modules.json (WO-1076). Sessions are never stored.
 */

const GAME_ID = /^[a-z][a-z0-9-]{0,15}$/
const LEVELS = ['easy', 'normal', 'hard']
const MODES = ['on', 'soft', 'off']
const MAX_BOTS = 32

const DEFAULT_GAMES_SETTINGS = Object.freeze({ joinAddress: '', autoOpen: false, defaults: Object.freeze({}) })

function normalizeOne(raw) {
	const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
	const out = {}
	const n = Number(o.bots)
	if (Number.isInteger(n) && n >= 0) out.bots = Math.min(MAX_BOTS, n)
	if (LEVELS.includes(o.botLevel)) out.botLevel = o.botLevel
	const m = Number(o.main)
	if (o.main !== null && o.main !== undefined && o.main !== '' && Number.isFinite(m)) out.main = Math.round(m)
	if (MODES.includes(o.affect)) out.affect = o.affect
	return out
}

/** Any stored / posted value → a complete, valid section (unknown keys dropped). */
function normalizeGamesSettings(raw) {
	const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
	const ja = typeof o.joinAddress === 'string' ? o.joinAddress.trim() : ''
	const defaults = {}
	const d = o.defaults && typeof o.defaults === 'object' && !Array.isArray(o.defaults) ? o.defaults : {}
	for (const id of Object.keys(d).slice(0, 16)) if (GAME_ID.test(id)) defaults[id] = normalizeOne(d[id])
	return {
		joinAddress: /^[A-Za-z0-9.:_-]{0,64}$/.test(ja) ? ja : '',
		autoOpen: o.autoOpen === true,
		defaults,
	}
}

/** POST /api/settings {games: partial} merged onto the current section (defaults merge per game and key; null removes). */
function mergeGamesSettings(cur, patch) {
	const c = normalizeGamesSettings(cur)
	const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
	const defaults = { ...c.defaults }
	if (p.defaults && typeof p.defaults === 'object') {
		for (const id of Object.keys(p.defaults)) {
			if (p.defaults[id] === null) {
				delete defaults[id] // null = this game back to its own defaults
				continue
			}
			const d = { ...(defaults[id] || {}), ...(p.defaults[id] || {}) }
			for (const k of Object.keys(d)) if (d[k] === null) delete d[k] // a null key = that one back to the game's own
			defaults[id] = d
		}
	}
	return normalizeGamesSettings({ ...c, ...p, defaults })
}

module.exports = { normalizeGamesSettings, mergeGamesSettings, LEVELS, MODES, GAME_ID }
