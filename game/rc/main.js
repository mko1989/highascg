/* global document, window, URLSearchParams */
/**
 * Entry of the RC game page (WO-1074). Mode by query: player (default), `?spectate=1`, `?host=1`.
 * The 3D part is imported dynamically so a missing /vendor/three mount shows a message instead of a blank page.
 */
import { $ } from './dom.js'

const q = new URLSearchParams(window.location.search)
const mode = q.has('host') ? 'host' : q.has('spectate') ? 'spectate' : 'player'
document.body.classList.add('mode-' + mode)

function fatal(title, text) {
	const el = $('#screen')
	el.textContent = ''
	const card = document.createElement('div')
	card.className = 'panel screen-card'
	const h1 = document.createElement('h1')
	h1.textContent = title
	const p = document.createElement('p')
	p.textContent = text
	card.append(h1, p)
	el.append(card)
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
		fatal(
			'Could not start the game',
			'The 3D engine did not load (' + (e?.message || e) + '). Reload the page in a moment.'
		)
		return
	}
	try {
		await game.startGame({ spectator: mode === 'spectate' })
	} catch (e) {
		fatal('Something went wrong', String(e?.message || e))
	}
}

boot()
