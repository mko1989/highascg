/* global window, document, URLSearchParams, setTimeout */
/**
 * WO-1101 — entry of the Game World pages (work/notes/game-world-contract.md §3). Mode by query: the landing "pick your
 * game" (default), `?host=1` the world host, `?spectate=1` the world spectator. The spectator's 3D part is imported
 * dynamically so a missing /vendor/three mount shows a message instead of a blank page. Nothing here ever puts anything
 * on a screen: these are ordinary web pages. WO-1106 A37: a failed start is retried with a back-off, then the page
 * reloads itself (the spectator is an unattended wall page).
 */
import { h } from './world-dom.js'
import { retryBoot } from './world-logic.js'

const RELOAD_MS = 30000

const q = new URLSearchParams(window.location.search)
const mode = q.has('host') ? 'host' : q.has('spectate') ? 'spectate' : 'landing'
document.body.classList.add('mode-' + mode)
const root = document.getElementById('app')

function fatal(title, text) {
	root.textContent = ''
	root.append(h('div.card.fatal', h('h1', { text: title }), h('p', { text })))
}

async function start() {
	if (mode === 'host') (await import('./world-host.js')).startHost(root)
	else if (mode === 'spectate') await (await import('./world-spectate.js')).startSpectate(root) // its failures count too
	else (await import('./world-landing.js')).startLanding(root)
}

const why = (e) => String(e?.message || e).slice(0, 120)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function boot() {
	const ok = await retryBoot(start, {
		sleep,
		onFail(e, n, ms) {
			if (ms == null) fatal('Could not start this page', `This page reloads itself in ${RELOAD_MS / 1000} s (${why(e)}).`)
			else fatal('Could not start this page', `Trying again in ${Math.round(ms / 1000)} s (${why(e)}).`)
		},
	}).catch(() => false)
	if (!ok) setTimeout(() => window.location.reload(), RELOAD_MS)
}

boot()
