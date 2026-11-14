/**
 * Procedural item icons (WO-1074 v2) — canvas 2D, no image files. Our own looks: Turbo = twin orange chevrons,
 * Slick = a violet goo splat, Rocket = a red dart with a flame, Pulse = cyan rings round a spark, Shield = a green hex.
 */

const TAU = Math.PI * 2

function chevron(ctx, x, y, s) {
	ctx.beginPath()
	ctx.moveTo(x - s, y + s * 0.55)
	ctx.lineTo(x, y - s * 0.45)
	ctx.lineTo(x + s, y + s * 0.55)
	ctx.lineTo(x + s * 0.62, y + s * 0.85)
	ctx.lineTo(x, y + s * 0.1)
	ctx.lineTo(x - s * 0.62, y + s * 0.85)
	ctx.closePath()
	ctx.fill()
}

const DRAW = {
	turbo(ctx, c, r) {
		ctx.fillStyle = '#ff9a1f'
		chevron(ctx, c, c - r * 0.18, r * 0.62)
		ctx.fillStyle = '#ffd23a'
		chevron(ctx, c, c + r * 0.32, r * 0.62)
	},
	slick(ctx, c, r) {
		ctx.fillStyle = '#8a3dff'
		ctx.beginPath()
		for (let i = 0; i <= 14; i++) {
			const a = (i / 14) * TAU
			const k = i % 2 ? 0.62 : 0.86
			const x = c + Math.cos(a) * r * k
			const y = c + Math.sin(a) * r * k * 0.78 + r * 0.08
			if (i) ctx.lineTo(x, y)
			else ctx.moveTo(x, y)
		}
		ctx.fill()
		ctx.fillStyle = 'rgba(255,255,255,0.55)'
		ctx.beginPath()
		ctx.ellipse(c - r * 0.25, c - r * 0.12, r * 0.2, r * 0.1, -0.4, 0, TAU)
		ctx.fill()
	},
	rocket(ctx, c, r) {
		ctx.save()
		ctx.translate(c, c)
		ctx.rotate(-Math.PI / 4)
		ctx.fillStyle = '#ffb21f'
		ctx.beginPath()
		ctx.moveTo(-r * 0.2, r * 0.45)
		ctx.lineTo(0, r * 0.95)
		ctx.lineTo(r * 0.2, r * 0.45)
		ctx.fill()
		ctx.fillStyle = '#ff3b30'
		ctx.beginPath()
		ctx.moveTo(0, -r * 0.9)
		ctx.quadraticCurveTo(r * 0.32, -r * 0.4, r * 0.24, r * 0.5)
		ctx.lineTo(-r * 0.24, r * 0.5)
		ctx.quadraticCurveTo(-r * 0.32, -r * 0.4, 0, -r * 0.9)
		ctx.fill()
		ctx.fillStyle = '#e9edf5'
		ctx.beginPath()
		ctx.arc(0, -r * 0.2, r * 0.12, 0, TAU)
		ctx.fill()
		ctx.restore()
	},
	pulse(ctx, c, r) {
		ctx.strokeStyle = '#3ee6ff'
		for (const [k, w] of [
			[0.85, 0.09],
			[0.58, 0.11],
		]) {
			ctx.lineWidth = r * w
			ctx.beginPath()
			ctx.arc(c, c, r * k, 0, TAU)
			ctx.stroke()
		}
		ctx.fillStyle = '#ffffff'
		ctx.beginPath()
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * TAU
			const k = i % 2 ? 0.14 : 0.36
			ctx.lineTo(c + Math.cos(a) * r * k, c + Math.sin(a) * r * k)
		}
		ctx.fill()
	},
	shield(ctx, c, r) {
		ctx.fillStyle = 'rgba(64, 230, 140, 0.35)'
		ctx.strokeStyle = '#40e68c'
		ctx.lineWidth = r * 0.12
		ctx.beginPath()
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * TAU + Math.PI / 6
			ctx.lineTo(c + Math.cos(a) * r * 0.82, c + Math.sin(a) * r * 0.82)
		}
		ctx.closePath()
		ctx.fill()
		ctx.stroke()
		ctx.fillStyle = 'rgba(255,255,255,0.7)'
		ctx.beginPath()
		ctx.arc(c - r * 0.22, c - r * 0.25, r * 0.14, 0, TAU)
		ctx.fill()
	},
}

export const ICON_KINDS = Object.keys(DRAW)

/** Draw item `kind` centred into a square canvas context of size `size` (clears it first). */
export function drawItemIcon(ctx, kind, size) {
	ctx.clearRect(0, 0, size, size)
	const f = DRAW[kind]
	if (!f) return false
	ctx.save()
	f(ctx, size / 2, size * 0.4)
	ctx.restore()
	return true
}
