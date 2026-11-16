'use strict'

/**
 * WO-1105 — what Settings ▸ Games may set on this game, in this game's own host-body shape (the descriptor's
 * `hosting`, rc-world.js). The core never names a game: src/games/games-hosting.js reads this and calls the game's
 * own host() with the body built here — the same validation as the web host page (rc-game.js host()).
 */

const { MAX_BOTS, LEVELS } = require('./rc-room-bots')
const { MAX_LAPS } = require('./rc-room')

module.exports = {
	main: { label: 'Laps', min: 1, max: MAX_LAPS, read: (st) => st.laps, body: (v) => [{ action: 'laps', laps: v }] },
	bots: { max: MAX_BOTS, levels: Object.keys(LEVELS), read: (st) => ({ n: st.bots, level: st.botLevel }),
		body: (n, level) => [{ action: 'bots', count: n, ...(level ? { level } : {}) }] },
	safe: (on) => ({ action: 'pause', on }),
	isSafe: (st) => st.paused === true,
}
