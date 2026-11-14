/* global window, setTimeout, clearTimeout */
/**
 * Arcade HUD pieces of the RC game (WO-1074 v2 §2.5): the big ordinal position ("3rd"), the lap banner
 * ("LAP 2" / "FINAL LAP"), the item slot with its 1 s roulette, the start-boost hint, speed lines, comic pop words
 * ("POW!") and results confetti. Procedural DOM + canvas only; text via textContent.
 */
import { h, setText, show } from './dom.js'
import { drawItemIcon, ICON_KINDS } from './icons.js'
import { ITEM_NAMES } from './items.js'

export function ordinal(n) {
	const k = n % 100
	if (k >= 11 && k <= 13) return 'th'
	return ['th', 'st', 'nd', 'rd'][n % 10] || 'th'
}

const ICON_PX = 96

export function createHudExtra(root, { spectator = false, itemButton = null } = {}) {
	const posNum = h('span.pos-num')
	const posSuf = h('span.pos-suf')
	const posOf = h('span.pos-of')
	const pos = h('div.hud-bigpos', posNum, posSuf, posOf)
	const slotCanvas = h('canvas.slot-icon', { width: ICON_PX, height: ICON_PX })
	const slotName = h('div.slot-name')
	const slot = h('div.hud-slot', h('div.slot-box', slotCanvas), slotName)
	const banner = h('div.hud-banner')
	const hint = h('div.hud-hint')
	const pop = h('div.hud-pop')
	const lines = h('div.speed-lines')
	const confetti = h('canvas.confetti')
	root.prepend(lines)
	root.append(pos, slot, banner, hint, pop, confetti)
	show(slot, !spectator)
	show(confetti, false)

	const sctx = slotCanvas.getContext('2d')
	const btnCanvas = itemButton ? h('canvas.tbtn-icon', { width: 64, height: 64 }) : null
	if (btnCanvas) itemButton.prepend(btnCanvas)
	const bctx = btnCanvas?.getContext('2d')
	let slotKey = ''
	let bannerTimer = null
	let popTimer = null

	function drawSlot(kind, rolling) {
		const key = kind + (rolling ? '~' : '')
		if (key === slotKey) return
		slotKey = key
		if (sctx) drawItemIcon(sctx, kind, ICON_PX)
		if (bctx) drawItemIcon(bctx, kind, 64)
		slot.classList.toggle('rolling', rolling)
		slot.classList.toggle('full', !!kind && !rolling)
		itemButton?.classList.toggle('full', !!kind && !rolling)
		setText(slotName, rolling ? '' : ITEM_NAMES[kind] || '')
	}

	/* ---- confetti ---- */
	let bits = []
	let confettiRaf = 0
	function confettiFrame() {
		const ctx = confetti.getContext('2d')
		const W = (confetti.width = confetti.clientWidth || window.innerWidth)
		const H = (confetti.height = confetti.clientHeight || window.innerHeight)
		ctx.clearRect(0, 0, W, H)
		for (const b of bits) {
			b.vy += 0.12
			b.x += b.vx
			b.y += b.vy
			b.a += b.va
			ctx.save()
			ctx.translate(b.x * W, b.y)
			ctx.rotate(b.a)
			ctx.fillStyle = b.c
			ctx.fillRect(-5, -3, 10, 6 * Math.abs(Math.cos(b.a * 1.7)) + 1)
			ctx.restore()
		}
		bits = bits.filter((b) => b.y < H + 20)
		if (bits.length) confettiRaf = window.requestAnimationFrame(confettiFrame)
		else show(confetti, false)
	}

	return {
		/** Position as "3rd / 8" (0 hides). */
		position(p, total) {
			show(pos, p > 0)
			if (p <= 0) return
			setText(posNum, String(p))
			setText(posSuf, ordinal(p))
			setText(posOf, total > 1 ? `/${total}` : '')
			pos.classList.toggle('lead', p === 1)
		},
		/** A big banner sliding in for `ms` (e.g. "LAP 2", "FINAL LAP", "BOOST START!"). */
		banner(text, kind = '', ms = 1700) {
			setText(banner, text)
			banner.className = 'hud-banner show ' + kind
			clearTimeout(bannerTimer)
			bannerTimer = setTimeout(() => (banner.className = 'hud-banner ' + kind), ms) // keeps its colour while fading
		},
		hint(text) {
			setText(hint, text || '')
			show(hint, !!text)
		},
		/** Comic pop word over the view. */
		pop(text, ms = 900) {
			setText(pop, text)
			pop.classList.remove('show')
			void pop.offsetWidth
			pop.classList.add('show')
			clearTimeout(popTimer)
			popTimer = setTimeout(() => pop.classList.remove('show'), ms)
		},
		/** @param {{ held: string|null, rolling: boolean }} it @param {number} now ms (drives the roulette) */
		item(it, now) {
			if (spectator) return
			if (it.rolling) drawSlot(ICON_KINDS[Math.floor(now / 80) % ICON_KINDS.length], true)
			else drawSlot(it.held || '', false)
		},
		/** 0…1 speed-line strength (boost / top speed). */
		speedLines(k) {
			const v = Math.max(0, Math.min(1, k))
			lines.style.opacity = v.toFixed(2)
			if (v > 0)
				lines.style.transform = `scale(${(1 + ((Math.floor(window.performance.now() / 50) % 3) - 1) * 0.015).toFixed(3)})`
		},
		confetti(on = true) {
			window.cancelAnimationFrame(confettiRaf)
			if (!on) {
				bits = []
				show(confetti, false)
				return
			}
			const cols = ['#ff7a1a', '#ffd23a', '#40e68c', '#3ee6ff', '#8a3dff', '#ff3b8b', '#ffffff']
			bits = Array.from({ length: 160 }, (_, i) => ({
				x: Math.random(),
				y: -20 - Math.random() * 400,
				vx: (Math.random() - 0.5) * 0.002,
				vy: 1 + Math.random() * 2,
				a: Math.random() * 6,
				va: (Math.random() - 0.5) * 0.3,
				c: cols[i % cols.length],
			}))
			show(confetti, true)
			confettiRaf = window.requestAnimationFrame(confettiFrame)
		},
	}
}
