/**
 * WO-1081 / WO-1125 — the ONE place the Skirmish client reads the self-service state fields (rename a server field here only).
 *   state.self (bool)  .phase  .players[] + .maxPlayers  .bots  .botLevel  .arenaId  .mode  .limits.minutes (or .minutes)
 *   arena list: state.arenas [{ id, title|name }] when the server sends it, else the loaded scene's arenas
 */
export const selfOn = (st) => st?.self === true
export const phaseOf = (st) => (typeof st?.phase === 'string' ? st.phase : 'lobby')
export const seats = (st) => ({ n: Array.isArray(st?.players) ? st.players.length : 0, max: Number.isFinite(st?.maxPlayers) ? st.maxPlayers : 0 })
export const bots = (st) => st?.bots
export const botLevel = (st) => st?.botLevel

const arenasOf = (st, ctx) => {
	const list = Array.isArray(st?.arenas) ? st.arenas : ctx?.scene?.arenas
	return (Array.isArray(list) ? list : []).filter((a) => a && a.id != null).map((a) => ({ id: a.id, title: a.title ?? a.name ?? a.id }))
}
const MODES = [
	{ id: 'dm', title: 'Free for all' },
	{ id: 'tdm', title: 'Teams' },
	{ id: 'spot', title: 'Spotlight' },
]
const minutes = (st) => (Number.isFinite(st?.limits?.minutes) ? st.limits.minutes : Number.isFinite(st?.minutes) ? st.minutes : null)

export const FIELDS = [
	{ key: 'arena', label: 'Arena', kind: 'choice', get: (st) => st?.arenaId, options: arenasOf },
	{ key: 'mode', label: 'Mode', kind: 'choice', get: (st) => (MODES.some((m) => m.id === st?.mode) ? st.mode : null), options: () => MODES },
	{ key: 'minutes', label: 'Minutes', kind: 'step', get: (st) => minutes(st), min: 1, max: 30, step: 1 },
]
