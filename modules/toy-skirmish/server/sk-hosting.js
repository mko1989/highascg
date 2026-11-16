'use strict'

/**
 * WO-1105 — what Settings ▸ Games may set on this game, in this game's own host-body shape (the descriptor's
 * `hosting`, sk-world.js). The core never names a game: src/games/games-hosting.js reads this and calls the game's
 * own host() with the body built here — the same validation as the web host page (sk-room.js host()).
 */

const { RULES } = require('./sk-rules')

module.exports = {
	main: { label: 'Minutes', min: RULES.minutes.min, max: RULES.minutes.max, read: (st) => st.limits?.minutes, body: (v) => [{ action: 'limits', minutes: v }] },
	bots: { max: RULES.maxBots, levels: ['easy', 'normal', 'hard'], read: (st) => ({ n: st.bots, level: st.botLevel }),
		body: (n, level) => [{ action: 'bots', n }, ...(level ? [{ action: 'botlevel', level }] : [])] },
	safe: (on) => ({ action: 'pause', on }),
	isSafe: (st) => st.paused === true,
}
