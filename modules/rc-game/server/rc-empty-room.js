'use strict'

/**
 * WO-1125 — the empty room rule of self-service (WO-1125 "Browser + two-box pass", job B): a player who
 * starts a round with bots and leaves must not leave a bot round the next visitor cannot stop. While self-service is on:
 *   - a round (any phase but the lobby; results too) with NO connected human player for EMPTY_STOP_MS goes back to the
 *     lobby — the operator's own `{ action: 'stop' }` through the game's host() (a host page's Stop; from the results it is
 *     the players' "Back to lobby"), so the next visitor finds a lobby;
 *   - after EMPTY_BOTS_MS with no connected human at all, the bot count returns to the session's default: the bots the
 *     operator last set through a host action (Settings ▸ Games default when the session was opened, a host page, the
 *     world host), else 0 — once per empty stretch, only when the last bot setting differs, only in the lobby.
 * Humans = seated players (`world().players`) that are not bots and not disconnected; spectators are not players.
 * A paused / presenter-safe game is left alone (the operator holds it). Self-service off: nothing runs (no timer).
 * Pure: clock, timers, the game's host(), the room view and the bot-body builder are injected (rc-ctl.js wires it; Stage
 * Skirmish and Stage Salad get it through createGameCtl from their kit).
 */

const EMPTY_STOP_MS = 20000
const EMPTY_BOTS_MS = 60000
const TICK_MS = 1000

/** Connected human players in a room view ({ players: Map }). */
function humansIn(w) {
	let n = 0
	if (w?.players && typeof w.players.values === 'function') for (const p of w.players.values()) if (p && !p.bot && p.connected !== false) n++
	return n
}

/** A bot setting after one host action: `bots` (RC `count` + `level`, Skirmish / Salad `n`), `botlevel` (`level`); `enable` = 0. */
function botStep(d, action, a) {
	if (action === 'enable') return { n: 0, level: undefined }
	if (action === 'bots') {
		const n = Number.isInteger(a?.count) ? a.count : Number.isInteger(a?.n) ? a.n : null
		return n != null && n >= 0 && n <= 64 ? { n, level: typeof a.level === 'string' ? a.level : d.level } : d
	}
	return action === 'botlevel' && typeof a?.level === 'string' ? { ...d, level: a.level } : d
}

/**
 * The bot settings as host actions made them: `dflt` = the operator's (host pages, Settings ▸ Games — the core applies
 * its default right after `enable`), `cur` = the last one from anybody (a player's ctl, the empty-room rule included).
 */
function createBotDefault() {
	let d = { n: 0, level: undefined }
	let cur = d
	return {
		/** @param {boolean} own the call came from a player's ctl or this rule, not from the operator */
		note(action, a, own = false) {
			cur = botStep(cur, action, a)
			if (!own) d = botStep(d, action, a)
		},
		get: () => ({ ...d }),
		same: () => cur.n === d.n && (d.level === undefined || cur.level === d.level),
	}
}

/**
 * @param {{ game: string, now: () => number, world: () => object|null, self: () => boolean, run: (bodies: object[]) => boolean,
 *   bots: (n: number, level?: string) => object[], dflt: { get: Function, same: Function }, log?: Function, timers?: object }} o
 *   dflt: createBotDefault() fed by every host action.
 *   run: the bodies through the game's host() as the operator would send them (→ true when every one was accepted).
 */
function createEmptyRoom(o) {
	const log = o.log || (() => {})
	const T = o.timers || { setInterval, clearInterval }
	let lastHuman = o.now()
	let stopped = false // this empty stretch already sent the round to the lobby
	let botsDone = false // … and the bots back to the default
	let iv = null

	const fresh = (t) => ((lastHuman = t), (stopped = false), (botsDone = false))

	/** One check (every TICK_MS while self-service is on; smokes call it directly). → what it did, for the smokes. */
	function tick() {
		const t = o.now()
		const w = o.self() ? o.world() : null
		if (!w || humansIn(w) > 0) return (fresh(t), null)
		if (w.paused === true || w.safe === true) return null
		const gone = t - lastHuman
		if (String(w.phase || 'lobby') !== 'lobby') {
			if (gone < EMPTY_STOP_MS || stopped) return null
			stopped = true
			const ok = o.run([{ action: 'stop' }])
			log('info', `[${o.game}] nobody connected for ${Math.round(gone / 1000)} s: back to the lobby${ok ? '' : ' (refused)'}`)
			return 'stop'
		}
		if (gone < EMPTY_BOTS_MS || botsDone) return null
		botsDone = true
		if (o.dflt.same()) return null
		const d = o.dflt.get()
		const ok = o.run(o.bots(d.n, d.level))
		log('info', `[${o.game}] nobody connected for ${Math.round(gone / 1000)} s: bots back to ${d.n}${ok ? '' : ' (refused)'}`)
		return 'bots'
	}

	/** Self-service switched: the check runs only while it is on. */
	function setOn(on) {
		if (on && !iv) {
			fresh(o.now())
			iv = T.setInterval(tick, TICK_MS)
			iv?.unref?.()
		} else if (!on && iv) {
			T.clearInterval(iv)
			iv = null
		}
	}

	return { tick, setOn, running: () => !!iv }
}

module.exports = { createEmptyRoom, createBotDefault, humansIn, EMPTY_STOP_MS, EMPTY_BOTS_MS, TICK_MS }
