/**
 * WO-1089 / WO-1125 — the ONE place the Salad client reads the self-service state fields (rename a server field here only).
 *   state.self (bool)  .phase  .players[] + .maxPlayers  .bots  .botLevel  .secs (round seconds, or .round)  .teams (bool)
 */
export const selfOn = (st) => st?.self === true
export const phaseOf = (st) => (typeof st?.phase === 'string' ? st.phase : 'lobby')
export const seats = (st) => ({ n: Array.isArray(st?.players) ? st.players.length : 0, max: Number.isFinite(st?.maxPlayers) ? st.maxPlayers : 0 })
export const bots = (st) => st?.bots
export const botLevel = (st) => st?.botLevel

const secs = (st) => (Number.isFinite(st?.secs) ? st.secs : Number.isFinite(st?.round) ? st.round : null)
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const TEAMS = [
	{ id: false, title: 'Everyone for themselves' },
	{ id: true, title: 'Teams: left vs right' },
]

export const FIELDS = [
	{ key: 'round', label: 'Round', kind: 'step', get: secs, min: 30, max: 600, step: 30, fmt: clock },
	{ key: 'teams', label: 'Teams', kind: 'choice', get: (st) => (typeof st?.teams === 'boolean' ? st.teams : null), options: () => TEAMS },
]
