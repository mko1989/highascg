/**
 * WO-1125 — a game page's "World" link asks this helper whether the world module answers (the games' own client files
 * may not name the world API, so the one request lives here). true only on a 200 from GET /api/game/world/state.
 */
import { getState } from './world-dom.js'

export async function worldAvailable() {
	try {
		const r = await getState()
		return r.ok === true
	} catch {
		return false
	}
}
