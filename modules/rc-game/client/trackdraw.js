/**
 * 2D top-down drawing of a track (minimap, lobby preview, host track list) — canvas 2D, X right, −Z (upstage) up.
 * v2: parts above the lowest floor (stage crossings) in a second colour, drawn on top so an overpass reads; ramps
 * amber; each drop's ledge gets a small orange tick. §2.7: elevated decks in a third colour (cyan); the raised parts are
 * drawn in height order, so the upper ribbon of a bridge lies over the lower one. §3.1: tunnel stretches dashed.
 * §3 toy scale: margins, tick widths and the height bands are × T.scale; a 2500-point track is drawn once into the
 * minimap's cached layer (per frame only the dots).
 */
import { prepareTrack } from './track-math.js'

/** Transform fitting a prepared track into w × h with a margin. */
export function fitTransform(T, w, h, margin = 8) {
	const b = T.box
	const pad = T.half + 0.3 * (T.scale ?? 1)
	const sx = (w - margin * 2) / Math.max(0.1, b.maxX - b.minX + pad * 2)
	const sz = (h - margin * 2) / Math.max(0.1, b.maxZ - b.minZ + pad * 2)
	const s = Math.min(sx, sz)
	const cx = (b.minX + b.maxX) / 2
	const cz = (b.minZ + b.maxZ) / 2
	return { s, map: (x, z) => [w / 2 + (x - cx) * s, h / 2 + (z - cz) * s] }
}

/** §3.1: each tunnel stretch drawn dashed (the solid ribbon there erased first, the background put back). */
function drawTunnels(ctx, T, tf, opts) {
	for (const q of T.tunnels || []) {
		const xy = T.pts.slice(q.from, q.to + 1).map((p) => tf.map(p[0], p[1]))
		let px = 0
		for (let i = 1; i < xy.length; i++) px += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1])
		const line = () => {
			ctx.beginPath()
			xy.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
		}
		const wide = Math.max(3, T.width * tf.s + 3) + 2
		ctx.save()
		ctx.lineCap = 'butt'
		ctx.globalCompositeOperation = 'destination-out'
		line()
		ctx.lineWidth = wide
		ctx.stroke()
		ctx.globalCompositeOperation = 'source-over'
		if (opts.bg) {
			line()
			ctx.strokeStyle = opts.bg
			ctx.stroke()
		}
		const dash = Math.max(2, px / 7)
		ctx.setLineDash?.([dash, dash])
		line()
		ctx.strokeStyle = opts.edge || 'rgba(255,255,255,0.85)'
		ctx.lineWidth = Math.max(2, T.width * tf.s)
		ctx.stroke()
		ctx.restore()
	}
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
	drawRaised(ctx, T, tf, opts)
	drawTunnels(ctx, T, tf, opts)
	const i0 = T.checkpoints[0]
	const p0 = T.pts[i0]
	const t0 = T.tangents[i0]
	const [ax, ay] = tf.map(p0[0] - t0[1] * T.half, p0[1] + t0[0] * T.half)
	const [bx, by] = tf.map(p0[0] + t0[1] * T.half, p0[1] - t0[0] * T.half)
	ctx.beginPath()
	ctx.moveTo(ax, ay)
	ctx.lineTo(bx, by)
	ctx.strokeStyle = '#ff7a1a'
	ctx.lineWidth = Math.max(2, 0.25 * (T.scale ?? 1) * tf.s)
	ctx.lineCap = 'butt'
	ctx.stroke()
	return tf
}

export const RAISED_COLOR = '#7a5cff'
export const RAMP_COLOR = '#e0a21a'
export const DECK_COLOR = '#2fd4ff'

/** Kind of segment i for the 2D map: '' (base road), 'ramp', 'deck' or 'up' (a raised floor: the stage). */
export function segKind(T, i) {
	if (T.segStep?.[i]) return ''
	if (T.segRamp?.[i]) return 'ramp'
	if (T.segDeck?.[i]) return 'deck'
	return Math.min(T.ys[i], T.ys[(i + 1) % T.n]) > T.box.minY + 0.3 * (T.scale ?? 1) ? 'up' : ''
}

/** Raised (stage-level), deck and ramp segments over the base ribbon, lowest first; then drop ticks. */
function drawRaised(ctx, T, tf, opts) {
	const segs = T.closed ? T.n : T.n - 1
	const bands = new Map() // height band (10 cm · scale) → segment indices: each band's edges, then its fills
	const k = T.scale ?? 1
	for (let i = 0; i < segs; i++) {
		if (!segKind(T, i)) continue
		const key = Math.round((Math.min(T.ys[i], T.ys[(i + 1) % T.n]) * 10) / k)
		if (!bands.has(key)) bands.set(key, [])
		bands.get(key).push(i)
	}
	for (const key of [...bands.keys()].sort((a, b) => a - b)) {
		for (const pass of ['edge', 'fill']) {
			for (const i of bands.get(key)) {
				const kind = segKind(T, i)
				const a = T.pts[i]
				const b = T.pts[(i + 1) % T.n]
				const [ax, ay] = tf.map(a[0], a[1])
				const [bx, by] = tf.map(b[0], b[1])
				ctx.beginPath()
				ctx.moveTo(ax, ay)
				ctx.lineTo(bx, by)
				ctx.lineCap = 'round'
				if (pass === 'edge') {
					ctx.strokeStyle = opts.edge || 'rgba(255,255,255,0.85)'
					ctx.lineWidth = Math.max(3, T.width * tf.s + 3)
				} else {
					ctx.strokeStyle = kind === 'ramp' ? RAMP_COLOR : kind === 'deck' ? DECK_COLOR : RAISED_COLOR
					ctx.lineWidth = Math.max(2, T.width * tf.s)
				}
				ctx.stroke()
			}
		}
	}
	for (const d of T.drops || []) {
		const p = T.pts[d.at]
		const t = T.tangents[d.at]
		if (!p || !t) continue
		const [ax, ay] = tf.map(p[0] - t[1] * T.half * 1.3, p[1] + t[0] * T.half * 1.3)
		const [bx, by] = tf.map(p[0] + t[1] * T.half * 1.3, p[1] - t[0] * T.half * 1.3)
		ctx.beginPath()
		ctx.moveTo(ax, ay)
		ctx.lineTo(bx, by)
		ctx.strokeStyle = '#ffc81a'
		ctx.lineWidth = Math.max(2, 0.3 * k * tf.s)
		ctx.lineCap = 'butt'
		ctx.stroke()
	}
}

/** Small static preview of a raw contract Track into a canvas element (scale: the scene's §3 toy scale). */
export function previewTrack(canvas, track, scale) {
	const ctx = canvas.getContext('2d')
	if (!ctx || !track?.points?.length) return
	drawTrack(ctx, prepareTrack(track, scale), canvas.width, canvas.height, { margin: 6 })
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
