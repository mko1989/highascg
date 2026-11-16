'use strict'

/**
 * WO-1105 — what Settings ▸ Games may set on this game, in this game's own host-body shape (the descriptor's
 * `hosting`, salad-world.js). The core never names a game: src/games/games-hosting.js reads this and calls the game's
 * own host() with the body built here — the same validation as the web host page (salad-room.js host()).
 */

const { RULES } = require('./salad-room')
const { MAX_BOTS, LEVELS } = require('./salad-bots')

module.exports = {
	main: { label: 'Round (s)', min: RULES.secs.min, max: RULES.secs.max, read: (st) => st.secs, body: (v) => [{ action: 'round', secs: v }] },
	bots: { max: MAX_BOTS, levels: Array.isArray(LEVELS) ? LEVELS : Object.keys(LEVELS), read: (st) => ({ n: st.bots, level: st.botLevel }),
		body: (n, level) => [{ action: 'bots', n }, ...(level ? [{ action: 'botlevel', level }] : [])] },
	safe: (on) => ({ action: 'safe', on }),
	isSafe: (st) => st.safe === true,
}
