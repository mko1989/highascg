'use strict'

/**
 * WO-1106 B34 — Stage Skirmish seats (sk-room.js). A player whose socket went mid-match stays listed with its score
 * (a ghost) and keeps its seat, so it can resume with its token (rc-resume.js) even into a full room. A joiner to a
 * full room takes the longest-gone ghost's seat: that ghost's token is void, its line and score stay until the lobby.
 * At most MAX_GHOSTS ghosts stay listed: `players` stays ≤ maxPlayers (humans + bots) + 10 however many sockets join
 * and drop mid-match; the oldest goes first (its score with it), a join is never refused for it.
 *   createSeats({ players, maxPlayers, removePlayer, revoke }) → { free(), trimGhosts() }
 *     free()        → true when a newcomer may sit (a ghost's seat freed if needed); false = full
 */

const MAX_GHOSTS = 10

function createSeats({ players, maxPlayers, removePlayer, revoke }) {
	const ghosts = () => [...players.values()].filter((p) => !p.bot && !p.connected).sort((a, b) => a.goneAt - b.goneAt || a.id - b.id)

	function free() {
		const humans = [...players.values()].filter((p) => !p.bot && p.connected).length
		if (humans >= maxPlayers) return false
		const seated = ghosts().filter((p) => !p.seatless)
		if (humans + seated.length >= maxPlayers) {
			seated[0].seatless = true
			revoke(seated[0])
		}
		return true
	}

	function trimGhosts() {
		const g = ghosts()
		for (const p of g.slice(0, Math.max(0, g.length - MAX_GHOSTS))) removePlayer(p)
	}

	return { free, trimGhosts }
}

module.exports = { createSeats, MAX_GHOSTS }
