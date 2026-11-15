/**
 * Scoreboard, weapon choice and minimap maths of Stage Skirmish (WO-1081 §6/§9) — pure.
 *  - order: score ↓, kills ↓, deaths ↑, then name / id (stable); `tdm` boards are grouped by team (red first unless
 *    blue leads), totals from `state.teams`;
 *  - rank: 1 + the number of players with a strictly higher score (ties share a place);
 *  - auto-switch: a weapon that just became usable (ammo 0 / missing → > 0) is taken when it ranks above the held one;
 *    the held one running dry falls back to the best weapon that still has ammo;
 *  - minimap: the arena rect fitted into a canvas with a margin, keeping its aspect (x right, z down = the camera's
 *    screen-up −Z).
 */
import { WEAPONS, WEAPON_ORDER } from './sk-const.js'

const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function comparePlayers(a, b) {
	return (
		n0(b.score) - n0(a.score) ||
		n0(b.kills) - n0(a.kills) ||
		n0(a.deaths) - n0(b.deaths) ||
		String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
		String(a.id).localeCompare(String(b.id))
	)
}

/** Sorted copy of the roster (dm), or grouped by team with the leading team first (tdm). */
export function orderPlayers(players, mode = 'dm', teams = null) {
	const list = (Array.isArray(players) ? players : []).filter(Boolean).slice().sort(comparePlayers)
	if (mode !== 'tdm') return list
	const t = Array.isArray(teams) ? teams.map(n0) : [0, 0]
	const first = (t[1] || 0) > (t[0] || 0) ? 1 : 0
	return [...list.filter((p) => (p.team | 0) === first), ...list.filter((p) => (p.team | 0) !== first)]
}

/** Place of a player (1-based; ties share), or 0 when not in the list. */
export function rankOf(players, id) {
	const list = Array.isArray(players) ? players : []
	const me = list.find((p) => p.id === id)
	if (!me) return 0
	return 1 + list.filter((p) => n0(p.score) > n0(me.score)).length
}

/** The leader (first of the dm order) or null. */
export function leaderOf(players) {
	return orderPlayers(players, 'dm')[0] || null
}

/** Usable = held with ammo left (−1 = infinite). */
export function usable(ammo, w) {
	const a = ammo?.[w]
	return typeof a === 'number' && (a === -1 || a > 0)
}

/** The best usable weapon (falls back to the Peashooter). */
export function bestWeapon(ammo) {
	let best = 'pea'
	for (const w of WEAPON_ORDER) if (usable(ammo, w) && WEAPONS[w].rank > WEAPONS[best].rank) best = w
	return best
}

/**
 * The weapon to hold after an ammo update: `held` unless a newly usable weapon outranks it, or `held` ran dry.
 * @param {object} prev ammo before @param {object} next ammo after @param {string} held
 */
export function autoSwitch(prev, next, held) {
	let pick = usable(next, held) ? held : bestWeapon(next)
	for (const w of WEAPON_ORDER) {
		if (usable(prev, w) || !usable(next, w)) continue
		if (WEAPONS[w].rank > WEAPONS[pick].rank) pick = w
	}
	return pick
}

/** Next / previous usable weapon in slot order (wheel, Q, the touch button); stays when nothing else is usable. */
export function cycleWeapon(ammo, held, dir = 1) {
	const i = Math.max(0, WEAPON_ORDER.indexOf(held))
	for (let k = 1; k <= WEAPON_ORDER.length; k++) {
		const w = WEAPON_ORDER[(i + dir * k + WEAPON_ORDER.length * 2) % WEAPON_ORDER.length]
		if (usable(ammo, w)) return w
	}
	return held
}

/** Weapon of slot key 1–5 when usable, else null. */
export function weaponForKey(ammo, key) {
	const w = WEAPON_ORDER[(key | 0) - 1]
	return w && usable(ammo, w) ? w : null
}

/**
 * Fit the arena rect [minX, minZ, maxX, maxZ] into a cw × ch canvas with `pad` pixels → { k, toPx(x, z) → [px, py] }.
 */
export function minimapFit(rect, cw, ch, pad = 6) {
	const [x0, z0, x1, z1] = rect
	const w = Math.max(1e-6, x1 - x0)
	const d = Math.max(1e-6, z1 - z0)
	const k = Math.min((cw - 2 * pad) / w, (ch - 2 * pad) / d)
	const ox = (cw - w * k) / 2
	const oy = (ch - d * k) / 2
	return {
		k,
		ox,
		oy,
		w: w * k,
		h: d * k,
		toPx: (x, z) => [ox + (x - x0) * k, oy + (z - z0) * k],
	}
}

/** "1st", "2nd", "3rd", "11th" … */
export function ordinal(n) {
	const v = n % 100
	const suf = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'
	return `${n}${suf}`
}

/** m:ss of a duration in ms (never negative). */
export function fmtClock(ms) {
	const t = Math.max(0, Math.ceil(n0(ms) / 1000))
	return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** Team of a player by id in a state roster (0 / 1) or null. */
export function teamOf(state, id) {
	const p = (state?.players || []).find((q) => q.id === id)
	return p && (p.team === 0 || p.team === 1) ? p.team : null
}

/** Is `other` an enemy of `me` (always in dm; another team in tdm)? */
export function isEnemy(state, me, other) {
	if (me === other) return false
	if (state?.mode !== 'tdm') return true
	const a = teamOf(state, me)
	const b = teamOf(state, other)
	return a == null || b == null || a !== b
}
