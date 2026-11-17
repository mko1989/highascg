/**
 * Snapshot interpolation + server clock offset (WO-1074) — pure (time is always passed in).
 *
 * Other cars arrive in `w` messages (15 Hz, server ms timestamps). They are drawn INTERP_DELAY ms in the past
 * (between two known snapshots), extrapolated at most MAX_EXTRAP ms when the stream stalls, and snapped (not
 * smoothed) when the target is far away (respawn, reconnect).
 */

export const INTERP_DELAY = 100
export const MAX_EXTRAP = 200
export const SNAP_DIST = 4.5

function lerp(a, b, t) {
	return a + (b - a) * t
}

/** Shortest-arc angle interpolation. */
export function lerpAngle(a, b, t) {
	let d = b - a
	while (d > Math.PI) d -= 2 * Math.PI
	while (d < -Math.PI) d += 2 * Math.PI
	return a + d * t
}

export class SnapshotBuffer {
	/** @param {{ delay?: number, maxExtrap?: number, snapDist?: number, max?: number }} [o] */
	constructor(o = {}) {
		this.delay = o.delay ?? INTERP_DELAY
		this.maxExtrap = o.maxExtrap ?? MAX_EXTRAP
		this.snapDist = o.snapDist ?? SNAP_DIST
		this.max = o.max ?? 40
		/** @type {{ ts: number, x: number, y: number, z: number, yaw: number, v: number, st: number, fx: number }[]} */
		this.snaps = []
		this.out = null
		this.lastOutAt = null
	}

	/** Add a snapshot (older-or-equal timestamps are ignored). */
	push(ts, s) {
		const last = this.snaps[this.snaps.length - 1]
		if (last && ts <= last.ts) return false
		this.snaps.push({ ts, x: s.x, y: s.y, z: s.z, yaw: s.yaw, v: s.v || 0, st: s.st || 0, fx: s.fx | 0 })
		if (this.snaps.length > this.max) this.snaps.shift()
		return true
	}

	get lastTs() {
		return this.snaps.length ? this.snaps[this.snaps.length - 1].ts : -Infinity
	}

	/** Raw interpolated / extrapolated state at server time `serverNow` (render time = serverNow − delay). */
	sample(serverNow) {
		const n = this.snaps.length
		if (!n) return null
		const rt = serverNow - this.delay
		const first = this.snaps[0]
		if (rt <= first.ts || n === 1) {
			if (n === 1 && rt > first.ts) return this._extrapolate(first, null, rt)
			return { ...first, extrap: false }
		}
		const last = this.snaps[n - 1]
		if (rt >= last.ts) return this._extrapolate(last, this.snaps[n - 2], rt)
		let i = n - 2
		while (i > 0 && this.snaps[i].ts > rt) i--
		const a = this.snaps[i]
		const b = this.snaps[i + 1]
		const t = (rt - a.ts) / (b.ts - a.ts || 1)
		return {
			ts: rt,
			x: lerp(a.x, b.x, t),
			y: lerp(a.y, b.y, t),
			z: lerp(a.z, b.z, t),
			yaw: lerpAngle(a.yaw, b.yaw, t),
			v: lerp(a.v, b.v, t),
			st: lerp(a.st, b.st, t),
			fx: t < 0.5 ? a.fx : b.fx,
			extrap: false,
		}
	}

	_extrapolate(last, prev, rt) {
		const ahead = Math.min(rt - last.ts, this.maxExtrap) / 1000
		let vx
		let vz
		const dts = prev ? (last.ts - prev.ts) / 1000 : 0
		if (prev && dts > 0.02 && dts < 0.5) {
			vx = (last.x - prev.x) / dts
			vz = (last.z - prev.z) / dts
		} else {
			vx = -Math.sin(last.yaw) * last.v
			vz = -Math.cos(last.yaw) * last.v
		}
		/* airborne (fx 16): keep falling / rising with the last vertical speed */
		let y = last.y
		if (prev && dts > 0.02 && dts < 0.5 && last.fx & 16) y = last.y + ((last.y - prev.y) / dts) * ahead
		return { ...last, ts: last.ts + ahead * 1000, x: last.x + vx * ahead, y, z: last.z + vz * ahead, extrap: true }
	}

	/**
	 * Render state: the sample, with small corrections (after an extrapolation guess) eased out over ~80 ms and far
	 * jumps snapped.
	 */
	render(serverNow, clientNowMs) {
		const s = this.sample(serverNow)
		if (!s) return null
		const dt = this.lastOutAt == null ? 1000 : Math.max(0, clientNowMs - this.lastOutAt)
		this.lastOutAt = clientNowMs
		const o = this.out
		if (!o || Math.hypot(s.x - o.x, s.z - o.z) > this.snapDist) {
			this.out = { ...s }
			return this.out
		}
		const k = 1 - Math.exp(-dt / 80)
		this.out = {
			...s,
			x: lerp(o.x, s.x, k),
			y: s.y,
			z: lerp(o.z, s.z, k),
			yaw: lerpAngle(o.yaw, s.yaw, k),
		}
		return this.out
	}
}

/**
 * Server clock offset from ping/pong: offset = server − client at the same instant, taken from the lowest-RTT sample
 * of the last few (the least queued one is the most accurate).
 */
export class ClockSync {
	constructor(keep = 8) {
		this.keep = keep
		/** @type {{ rtt: number, offset: number }[]} */
		this.samples = []
		this.offset = 0
	}

	/** @param {number} sentMs client time the ping left @param {number} serverMs pong.s @param {number} recvMs client time of the pong */
	sample(sentMs, serverMs, recvMs) {
		const rtt = recvMs - sentMs
		if (!(rtt >= 0) || !Number.isFinite(serverMs)) return
		this.samples.push({ rtt, offset: serverMs + rtt / 2 - recvMs })
		if (this.samples.length > this.keep) this.samples.shift()
		let best = this.samples[0]
		for (const s of this.samples) if (s.rtt < best.rtt) best = s
		this.offset = best.offset
	}

	get synced() {
		return this.samples.length > 0
	}

	/**
	 * WO-1106 B43: a new socket (after a phone slept) — forget the old samples, whose offsets were taken before the
	 * sleep and would win the lowest-RTT pick for a while; the offset stays as the best guess until the first pong.
	 */
	reset() {
		this.samples = []
	}

	get rtt() {
		return this.samples.length ? this.samples[this.samples.length - 1].rtt : null
	}

	now(clientNowMs) {
		return clientNowMs + this.offset
	}
}
