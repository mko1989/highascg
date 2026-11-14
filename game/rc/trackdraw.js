/**
 * 2D top-down drawing of a track (minimap, lobby preview, host track list) — canvas 2D, X right, −Z (upstage) up.
 */
import { prepareTrack } from './track-math.js'

/** Transform fitting a prepared track into w × h with a margin. */
export function fitTransform(T, w, h, margin = 8) {
	const b = T.box
	const pad = T.half + 0.3
	const sx = (w - margin * 2) / Math.max(0.1, b.maxX - b.minX + pad * 2)
	const sz = (h - margin * 2) / Math.max(0.1, b.maxZ - b.minZ + pad * 2)
	const s = Math.min(sx, sz)
	const cx = (b.minX + b.maxX) / 2
	const cz = (b.minZ + b.maxZ) / 2
	return { s, map: (x, z) => [w / 2 + (x - cx) * s, h / 2 + (z - cz) * s] }
}

/** Draw the track ribbon + start line. Returns the transform. */
export function drawTrack(ctx, T, w, h, opts = {}) {
	const tf = fitTransform(T, w, h, opts.margin ?? 8)
	ctx.clearRect(0, 0, w, h)
	if (opts.bg) {
		ctx.fillStyle = opts.bg
		ctx.fillRect(0, 0, w, h)
	}
	const path = () => {
		ctx.beginPath()
		T.pts.forEach((p, i) => {
			const [x, y] = tf.map(p[0], p[1])
			if (i) ctx.lineTo(x, y)
			else ctx.moveTo(x, y)
		})
		if (T.closed) ctx.closePath()
	}
	ctx.lineJoin = 'round'
	ctx.lineCap = 'round'
	path()
	ctx.strokeStyle = opts.edge || 'rgba(255,255,255,0.85)'
	ctx.lineWidth = Math.max(3, T.width * tf.s + 3)
	ctx.stroke()
	path()
	ctx.strokeStyle = opts.road || '#34373f'
	ctx.lineWidth = Math.max(2, T.width * tf.s)
	ctx.stroke()
	const i0 = T.checkpoints[0]
	const p0 = T.pts[i0]
	const t0 = T.tangents[i0]
	const [ax, ay] = tf.map(p0[0] - t0[1] * T.half, p0[1] + t0[0] * T.half)
	const [bx, by] = tf.map(p0[0] + t0[1] * T.half, p0[1] - t0[0] * T.half)
	ctx.beginPath()
	ctx.moveTo(ax, ay)
	ctx.lineTo(bx, by)
	ctx.strokeStyle = '#ff7a1a'
	ctx.lineWidth = Math.max(2, 0.25 * tf.s)
	ctx.lineCap = 'butt'
	ctx.stroke()
	return tf
}

/** Small static preview of a raw contract Track into a canvas element. */
export function previewTrack(canvas, track) {
	const ctx = canvas.getContext('2d')
	if (!ctx || !track?.points?.length) return
	drawTrack(ctx, prepareTrack(track), canvas.width, canvas.height, { margin: 6 })
}

/** Minimap that caches the track layer and draws car dots on top each frame. */
export class Minimap {
	constructor(canvas) {
		this.canvas = canvas
		this.ctx = canvas.getContext('2d')
		this.layer = null
		this.tf = null
		this.T = null
	}

	setTrack(T) {
		this.T = T
		const c = this.canvas
		const off = c.ownerDocument.createElement('canvas')
		off.width = c.width
		off.height = c.height
		this.tf = drawTrack(off.getContext('2d'), T, off.width, off.height, { bg: 'rgba(10,12,18,0.55)' })
		this.layer = off
	}

	/** @param {{ x: number, z: number, color: string, me?: boolean }[]} dots */
	draw(dots) {
		const { ctx, canvas, tf } = this
		if (!ctx || !this.layer) return
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		ctx.drawImage(this.layer, 0, 0)
		for (const d of dots) {
			const [x, y] = tf.map(d.x, d.z)
			ctx.beginPath()
			ctx.arc(x, y, d.me ? 6 : 4.5, 0, Math.PI * 2)
			ctx.fillStyle = d.color
			ctx.fill()
			ctx.lineWidth = d.me ? 2.5 : 1.5
			ctx.strokeStyle = d.me ? '#ffffff' : 'rgba(0,0,0,0.8)'
			ctx.stroke()
		}
	}
}
