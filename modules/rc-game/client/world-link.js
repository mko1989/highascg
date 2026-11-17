/* global document */
/**
 * WO-1125 — the small "World" link of a game page (work/notes/game-self-service-contract.md §4). A game alone shows
 * nothing: the link stays hidden until the world module's own helper (/game/world/game-link.js, which asks the
 * world module's state) says the world answers. The helper is a computed import, so a missing world module is a
 * 404 that is caught here. Kit file: no game API, no game-specific import.
 */
const HELPER = '/game/world/game-link.js'
let asked = null

/** Resolves true when the world module answers its state; never rejects. */
export function worldAvailable() {
	if (!asked) {
		const u = HELPER
		asked = import(u).then((m) => m.worldAvailable()).catch(() => false)
	}
	return asked
}

/** An <a> to the world page, hidden until the world is there. `cls` e.g. 'tool' (HUD toolbar) or 'ghost world-link'. */
export function worldLinkEl(cls = 'tool', text = 'World') {
	const a = document.createElement('a')
	a.className = cls
	a.href = '/game/world/'
	a.textContent = text
	a.title = 'The room, all games live'
	a.hidden = true
	worldAvailable().then((ok) => {
		if (ok) a.hidden = false
	})
	return a
}
