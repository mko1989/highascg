/* global window, document, URLSearchParams */
/**
 * Test hook of Stage Salad (WO-1089): ONLY when the page runs on 127.0.0.1 with `?dev=1` (the private headless check)
 * it exposes `window.__saladDev` — the session object, a state summary and a scripted shot. With `&auto=1` it also
 * joins as "Dev", closes the lobby panel and every ~2.5 s pulls the band for a moment and fires at the first avatar
 * through the shared aim.js solver plus a small random error, cycling the vegetables. Never active on the box's own
 * address or without the flag.
 */
import { solveAim } from './aim.js'
import { mySlot } from './session.js'
import { pouch } from './venue.js'
import { VEGGIES, VEG_IDS, POWER_MIN } from './veggies.js'
import { clampYaw } from './aim-input.js'

const EVERY_MS = 2500
const PULL_MS = 600
const DEG = Math.PI / 180

export function devHookAllowed(loc) {
	try {
		return loc.hostname === '127.0.0.1' && new URLSearchParams(loc.search).get('dev') === '1'
	} catch {
		return false
	}
}

/** The scripted aim at the first drawn avatar's body centre (pure apart from `rnd`). → { yaw, pitch, power } | null */
export function devAim(G, rnd = Math.random) {
	const slot = mySlot(G)
	const av = G.avatars?.list()[0]
	if (!slot || !av) return null
	const veg = VEGGIES[VEG_IDS[G.sel]]
	const p = av.pose
	const target = [p.x, p.y + (p.height || 1.75) * 0.55, p.z]
	const a = solveAim(veg, pouch(slot), target)
	if (!a) return null
	const yaw = clampYaw(a.yaw + (rnd() - 0.5) * 2 * DEG, slot.yaw)
	const power = Math.max(POWER_MIN, Math.min(1, a.power + (rnd() - 0.5) * 0.06))
	return { yaw, pitch: Math.max(-10 * DEG, Math.min(70 * DEG, a.pitch)), power }
}

export function installDevHook(G) {
	if (!devHookAllowed(window.location)) return false
	G.dev = { pull: null, fired: 0, refused: 0, errors: [] }
	window.addEventListener('error', (e) => {
		G.dev.errors.push(String(e.message || e.error || 'error'))
		G.hud?.toast(`JS error: ${G.dev.errors[G.dev.errors.length - 1]}`, 8000)
	})
	const shoot = () => {
		const a = devAim(G)
		if (!a || !G.ctl.canPull() || G.dev.pull) return false
		const pull = (a.power - POWER_MIN) / (1 - POWER_MIN)
		const t0 = window.performance.now()
		const grow = () => {
			const k = Math.min(1, (window.performance.now() - t0) / PULL_MS)
			G.dev.pull = { yaw: a.yaw, pitch: a.pitch, pull: Math.max(0.01, pull * k) }
			if (k < 1) return void window.setTimeout(grow, 30)
			G.dev.pull = null
			if (G.ctl.fire(a)) G.dev.fired++
			else G.dev.refused++
		}
		grow()
		return true
	}
	window.__saladDev = {
		G,
		shoot,
		me: () => ({ id: G.meId, slot: mySlot(G)?.i ?? null, phase: G.phase, me: G.me, sel: VEG_IDS[G.sel], fired: G.dev.fired, refused: G.dev.refused }),
		avatars: () => G.avatars?.list().map((a) => ({ tid: a.tid, x: a.pose.x, y: a.pose.y, z: a.pose.z, h: a.pose.height })),
		live: () => G.book.live.length,
		errors: () => G.dev.errors.slice(),
	}
	if (new URLSearchParams(window.location.search).get('auto') === '1') {
		window.setInterval(() => {
			if (G.meId == null && G.lobby?.joinVisible) return void G.ctl.join('Dev', '#ff5ec4')
			if (G.lobby?.panelOpen) document.querySelector('#lobby .panel.lobby .go')?.click()
			if (shoot()) window.setTimeout(() => G.ctl.pick(G.sel + 1), PULL_MS + 200)
		}, EVERY_MS)
	}
	return true
}
