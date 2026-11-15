/* global document, window, URLSearchParams */
/**
 * Entry of the Stage Salad page (WO-1089). Mode by query: player (default), `?spectate=1`, `?host=1`.
 * The 3D part is imported dynamically so a missing /vendor/three mount shows a message instead of a blank page.
 */
import { $, h } from './dom.js'

const q = new URLSearchParams(window.location.search)
const mode = q.has('host') ? 'host' : q.has('spectate') ? 'spectate' : 'player'
document.body.classList.add('mode-' + mode)

function fatal(title, text) {
	const el = $('#screen')
	el.textContent = ''
	el.append(h('div.panel.screen-card', h('h1', { text: title }), h('p', { text })))
	el.hidden = false
}

async function boot() {
	if (mode === 'host') {
		const { startHost } = await import('./host.js')
		startHost($('#host'))
		return
	}
	let game
	try {
		game = await import('./game.js')
	} catch (e) {
		fatal('Could not start the game', 'The 3D engine did not load (' + (e?.message || e) + '). Reload the page in a moment.')
		return
	}
	try {
		await game.startGame({ spectator: mode === 'spectate' })
	} catch (e) {
		fatal('Something went wrong', String(e?.message || e))
	}
}

boot()
