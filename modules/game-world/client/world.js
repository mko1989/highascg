/* global window, document, URLSearchParams */
/**
 * WO-1101 — entry of the Game World pages (work/notes/game-world-contract.md §3). Mode by query: the landing "pick your
 * game" (default), `?host=1` the world host, `?spectate=1` the world spectator. The spectator's 3D part is imported
 * dynamically so a missing /vendor/three mount shows a message instead of a blank page. Nothing here ever puts anything
 * on a screen: these are ordinary web pages.
 */
import { h } from './world-dom.js'

const q = new URLSearchParams(window.location.search)
const mode = q.has('host') ? 'host' : q.has('spectate') ? 'spectate' : 'landing'
document.body.classList.add('mode-' + mode)
const root = document.getElementById('app')

function fatal(title, text) {
	root.textContent = ''
	root.append(h('div.card.fatal', h('h1', { text: title }), h('p', { text })))
}

async function boot() {
	try {
		if (mode === 'host') (await import('./world-host.js')).startHost(root)
		else if (mode === 'spectate') (await import('./world-spectate.js')).startSpectate(root)
		else (await import('./world-landing.js')).startLanding(root)
	} catch (e) {
		fatal('Could not start this page', 'Reload in a moment (' + String(e?.message || e).slice(0, 120) + ').')
	}
}

boot()
