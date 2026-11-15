/* global document */
/**
 * The HUD minimap of Stage Skirmish (WO-1081 §9): the arena from above (x right, z down — the camera's frame), its
 * solid cells pre-rendered once per arena, the pick-ups (a dot in the kind's colour while there), team-mates, and the
 * own soldier as an arrow along its aim, and the Spotlight pool (`spot` mode, WO-1083) as a ring. Enemies are not
 * shown to players (the spectator map shows everyone).
 * Canvas 2D only; positions go through score.js minimapFit.
 */
import { minimapFit } from './score.js'
import { pickupColor } from './weapon-model.js'

const hex = (n) => '#' + n.toString(16).padStart(6, '0')

export function createMinimap(canvas) {
	const ctx = canvas.getContext('2d')
	let fit = null
	let base = null

	function setArena(grid) {
		fit = null
		base = null
		if (!grid || !ctx) return
		fit = minimapFit(grid.rect, canvas.width, canvas.height, 6)
		base = document.createElement('canvas')
		base.width = canvas.width
		base.height = canvas.height
		const b = base.getContext('2d')
		b.fillStyle = 'rgba(12,15,22,0.72)'
		b.beginPath()
		b.roundRect(0, 0, base.width, base.height, 10)
		b.fill()
		b.fillStyle = 'rgba(70,78,92,0.9)'
		const [x0, y0] = fit.toPx(grid.rect[0], grid.rect[1])
		b.fillRect(x0, y0, fit.w, fit.h)
		b.fillStyle = '#c9ced8'
		const px = Math.max(1, grid.cell * fit.k)
		for (let j = 0; j < grid.h; j++) {
			for (let i = 0; i < grid.w; i++) {
				if (grid.bits[j * grid.w + i] !== 1) continue
				const cx = grid.x0 + i * grid.cell
				const cz = grid.z0 + j * grid.cell
				if (cx + grid.cell <= grid.rect[0] || cx >= grid.rect[2] || cz + grid.cell <= grid.rect[1] || cz >= grid.rect[3])
					continue
				const [x, y] = fit.toPx(cx, cz)
				b.fillRect(x, y, px + 0.5, px + 0.5)
			}
		}
		b.strokeStyle = '#ff7a1a'
		b.lineWidth = 1.5
		b.strokeRect(x0, y0, fit.w, fit.h)
	}

	/**
	 * @param {{ pickups: { x, z, kind, here: boolean }[], dots: { x, z, color: string }[],
	 *   me?: { x, z, yaw } | null, spot?: { x, z, r, color: string } | null }} d
	 */
	function draw(d) {
		if (!ctx) return
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		if (!fit || !base) return
		ctx.drawImage(base, 0, 0)
		if (d.spot) {
			const [x, y] = fit.toPx(d.spot.x, d.spot.z)
			ctx.fillStyle = 'rgba(255,236,170,0.28)'
			ctx.strokeStyle = d.spot.color
			ctx.lineWidth = 2
			ctx.beginPath()
			ctx.arc(x, y, Math.max(4, d.spot.r * fit.k), 0, Math.PI * 2)
			ctx.fill()
			ctx.stroke()
		}
		for (const p of d.pickups || []) {
			const [x, y] = fit.toPx(p.x, p.z)
			ctx.fillStyle = p.here ? hex(pickupColor(p.kind)) : 'rgba(255,255,255,0.18)'
			ctx.beginPath()
			ctx.arc(x, y, p.here ? 3 : 2, 0, Math.PI * 2)
			ctx.fill()
		}
		for (const s of d.dots || []) {
			const [x, y] = fit.toPx(s.x, s.z)
			ctx.fillStyle = s.color
			ctx.strokeStyle = '#000'
			ctx.lineWidth = 1
			ctx.beginPath()
			ctx.arc(x, y, 3.5, 0, Math.PI * 2)
			ctx.fill()
			ctx.stroke()
		}
		if (d.me) {
			const [x, y] = fit.toPx(d.me.x, d.me.z)
			/* yaw 0 faces −Z = up on the map */
			const a = -d.me.yaw
			ctx.save()
			ctx.translate(x, y)
			ctx.rotate(a)
			ctx.fillStyle = '#ffffff'
			ctx.strokeStyle = '#000'
			ctx.beginPath()
			ctx.moveTo(0, -7)
			ctx.lineTo(5, 5)
			ctx.lineTo(0, 2)
			ctx.lineTo(-5, 5)
			ctx.closePath()
			ctx.fill()
			ctx.stroke()
			ctx.restore()
		}
	}

	return { setArena, draw }
}
