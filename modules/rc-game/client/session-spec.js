/**
 * WO-1125 — the ONE place the RC client reads the self-service state fields (rename a server field here, nowhere else).
 * Pure data + accessors (node smokes import it).
 *   state.self (bool)  .phase  .players[] + .maxPlayers  .bots  .botLevel  .trackId  .laps
 *   track list: state.tracks [{ id, title|name }] when the server sends it, else the loaded scene's tracks
 */
export const selfOn = (st) => st?.self === true
export const phaseOf = (st) => (typeof st?.phase === 'string' ? st.phase : 'lobby')
export const seats = (st) => ({ n: Array.isArray(st?.players) ? st.players.length : 0, max: Number.isFinite(st?.maxPlayers) ? st.maxPlayers : 0 })
export const bots = (st) => st?.bots
export const botLevel = (st) => st?.botLevel

const tracksOf = (st, ctx) => {
	const list = Array.isArray(st?.tracks) ? st.tracks : ctx?.scene?.tracks
	return (Array.isArray(list) ? list : []).filter((t) => t && t.id != null).map((t) => ({ id: t.id, title: t.title ?? t.name ?? t.id }))
}

export const FIELDS = [
	{ key: 'track', label: 'Track', kind: 'choice', get: (st) => st?.trackId, options: tracksOf },
	{ key: 'laps', label: 'Laps', kind: 'step', get: (st) => st?.laps, min: 1, max: 20, step: 1 },
]
