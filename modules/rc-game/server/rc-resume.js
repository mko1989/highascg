'use strict'

/**
 * WO-1106 B34 — resume after a reconnect: one design for the three games' rooms (RC here; Stage Skirmish and Stage
 * Salad through their kits). A player's `welcome` carries `resume`: `<id>.<secret>` (128 random bits per player entry,
 * the same for the entry's life; only ever sent to that player's own socket — never in a state, a broadcast or a world
 * entity). The page keeps it in memory and in sessionStorage (a reload of the same tab resumes; a new tab is a new
 * player) and sends it back in its next `join`.
 *   claim(players, raw)        → { p } (the token is this entry's: constant-time compare, bound to the id);
 *                                { stale: true } (its entry is gone: lobby reset, kicked, evicted ghost — a normal
 *                                join); { bad: true } (malformed, or the wrong secret for a live entry — a normal join
 *                                that the service counts on the socket's bad-message counter); null (no token)
 *   resumeJoin(room, c, m)     the join's resume for a room { players, conns, close, now }: a claimed entry is taken
 *                                back on socket c (its old socket — gone, or open but silent / half-open — is forgotten
 *                                and closed with REPLACED_CODE, so its later close event drops nothing) → { p, goneMs }
 *   issue(p)                   the entry's token (made on first use); bots never get one
 * A kicked player's entry is deleted (its secret wiped first), so its token is void.
 */

const crypto = require('crypto')

const REPLACED_CODE = 4410 // the seat went on on another connection: the page does not reconnect by itself
const TOKEN_RE = /^([1-9]\d{0,8})\.([A-Za-z0-9_-]{22})$/
const DUMMY = Buffer.alloc(22)

/** The player's resume token (a new 128-bit secret on first use); null for a bot. */
function issue(p) {
	if (!p || p.bot) return null
	if (typeof p.resume !== 'string') p.resume = crypto.randomBytes(16).toString('base64url')
	return `${p.id}.${p.resume}`
}

/** A join's `resume` value → { p } | { bad: true } | null (absent). */
function claim(players, raw) {
	if (raw == null) return null
	const m = typeof raw === 'string' && raw.length <= 40 ? TOKEN_RE.exec(raw) : null
	if (!m) return { bad: true }
	const p = players.get(Number(m[1]))
	const want = p && !p.bot && typeof p.resume === 'string' && p.resume.length === 22 ? Buffer.from(p.resume) : null
	const same = crypto.timingSafeEqual(want || DUMMY, Buffer.from(m[2])) && !!want
	if (same) return { p }
	return want ? { bad: true } : { stale: true }
}

/**
 * @param {{ players: Map, conns: Map, close: (conn, code, reason) => void, now: () => number }} room
 * @param {object} c the joining socket's record (not joined yet)  @param {object} m the `join` message
 * @returns {{ p: object, goneMs: number } | { stale: true } | { bad: true } | null}
 */
function resumeJoin(room, c, m) {
	if (c.joined || m?.spectator === true) return null
	const r = claim(room.players, m?.resume)
	if (!r || !r.p) return r // null / stale / bad: the caller joins a new player
	const p = r.p
	if (p.conn != null && p.conn !== c.conn) {
		const old = p.conn
		room.conns.delete(old)
		room.close(old, REPLACED_CODE, 'resumed elsewhere')
	}
	const goneMs = Number.isFinite(p.goneAt) ? Math.max(0, room.now() - p.goneAt) : 0
	c.pid = p.id
	c.joined = true
	c.spectator = false
	Object.assign(p, { conn: c.conn, connected: true, goneAt: undefined })
	return { p, goneMs }
}

/** Kicked: the secret is wiped before the entry goes (nothing can hand it back). */
function revoke(p) {
	if (p) p.resume = null
}

module.exports = { issue, claim, resumeJoin, revoke, REPLACED_CODE }
