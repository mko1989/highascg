/**
 * The presenter avatars of the Stage Salad client (WO-1089 §6): one avatar-model.js twin per tracked id in `w.av`
 * (drawn 100 ms back from the kit's SnapshotBuffer), its look from `state.targets` (the Godot NEUTRAL clay for the
 * stand-in, flag 4, labelled "Stand-in"), a lost person (flag 2) faded a little, the server's dodges applied at their
 * server times (duck: head and body sink; step: the whole figure slides along `dx`), the umbrella (flag 8 or an
 * `umbrella` window) and the reactions (avatar-react.js). It also gives the projectile book a hit test against the
 * avatars AS DRAWN, so a vegetable never visibly passes through the figure while the server's verdict travels.
 */
import { SnapshotBuffer } from './kit/interp.js'
import { createAvatarModel } from './avatar-model.js'
import { createReactions } from './avatar-react.js'
import { lookFrom, worldParts, sweepParts, dodgeAmount } from './avatar-body.js'
import { standInSpot } from './venue.js'
import { blend } from './avatar-spec.js'
import { AV } from './protocol.js'

const GONE_MS = 600
const LOST_ALPHA = 0.55

export function createAvatars(THREE, scene, { quality = 'high' } = {}) {
	const map = new Map()
	let targets = []
	let lastIds = null // tids of the last `w.av` (null: none seen yet)
	let q = quality

	function targetOf(tid) {
		return targets.find((t) => t && t.tid === tid) || null
	}

	function lookKey(t, standIn) {
		return standIn ? 'stand-in' : JSON.stringify(t?.look || null)
	}

	function ensure(tid, flags) {
		let a = map.get(tid)
		if (a) return a
		const t = targetOf(tid)
		const standIn = !!(flags & AV.STANDIN) || !!t?.dummy
		const model = createAvatarModel(THREE, { look: lookFrom(standIn ? null : t?.look), height: t?.height || 1.75, label: standIn ? 'Stand-in' : String(t?.name ?? ''), quality: q })
		scene.add(model.group)
		model.group.visible = false
		a = { tid, buf: new SnapshotBuffer({ snapDist: 2.5 }), model, react: createReactions(THREE, model), pose: null, disp: null, speed: 0, flags, dodges: [], umb: null, key: lookKey(t, standIn), standIn, gone: 0, fade: 1 }
		map.set(tid, a)
		return a
	}

	function restyle(a) {
		const t = targetOf(a.tid)
		const standIn = !!(a.flags & AV.STANDIN) || !!t?.dummy
		const key = lookKey(t, standIn)
		if (key !== a.key) {
			a.key = key
			a.model.setLook(lookFrom(standIn ? null : t?.look))
		}
		a.standIn = standIn
		a.model.setLabel(standIn ? 'Stand-in' : String(t?.name ?? ''), standIn ? '#e8dcc6' : '#ffd24a')
	}

	function drop(a) {
		a.react.dispose()
		a.model.dispose()
		map.delete(a.tid)
	}

	return {
		map,
		/** state.targets changed (names, looks, lost). */
		sync(state, venue) {
			targets = Array.isArray(state?.targets) ? state.targets.filter((t) => t && typeof t === 'object') : []
			for (const a of map.values()) restyle(a)
			/* a still stand-in may send no `w` for a while: until one comes, draw it where the server puts it */
			if (venue?.front && venue.stage)
				for (const t of targets) {
					if (!t.dummy || map.has(t.tid)) continue
					const at = standInSpot(venue)
					ensure(t.tid, AV.STANDIN).buf.push(1, { x: at[0], y: at[1], z: at[2], yaw: Math.atan2(venue.front.f[0], venue.front.f[1]), v: 0, st: t.height || 1.75, fx: AV.STANDIN })
				}
		},
		/** A decoded `w`. */
		onW(m) {
			if (!m.av) return
			lastIds = new Set()
			for (const v of m.av) {
				lastIds.add(v.tid)
				const a = ensure(v.tid, v.f)
				a.flags = v.f
				a.gone = 0
				a.buf.push(m.ts, { x: v.x, y: v.y, z: v.z, yaw: v.yaw, v: 0, st: v.height, fx: v.f })
				restyle(a)
			}
		},
		onDodge(m) {
			const a = map.get(m.tid)
			if (!a) return
			a.dodges.push(m)
			if (a.dodges.length > 6) a.dodges.shift()
		},
		onUmbrella(m) {
			const a = map.get(m.tid)
			if (a) a.umb = { from: m.from, until: m.until }
		},
		/** A finished projectile (shots.js event) — reactions on the avatar it touched. */
		onEnd(ev, sNow) {
			const a = ev.tid != null ? map.get(ev.tid) : null
			if (!a || !a.disp) return false
			if (ev.k === 'hit') a.react.onHit(ev, a.disp, sNow)
			else if (ev.tag === 'umbrella') a.react.onUmbrella()
			return true
		},
		update(sNow, now, dt, t) {
			for (const a of [...map.values()]) {
				const known = (lastIds && lastIds.has(a.tid)) || !!targetOf(a.tid)
				if (!known) a.gone = a.gone || now
				if (a.gone && now - a.gone > GONE_MS) {
					drop(a)
					continue
				}
				const s = a.buf.render(sNow, now)
				if (!s) continue
				const prev = a.pose
				const pose = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, height: s.st || 1.75 }
				if (prev && dt > 0) {
					const v = Math.hypot(pose.x - prev.x, pose.z - prev.z) / dt
					a.speed += (Math.min(4, v) - a.speed) * blend(dt, 6)
				}
				if (!(a.flags & AV.WALK)) a.speed *= 1 - blend(dt, 4)
				a.pose = pose
				let duck = 0
				const off = [0, 0]
				for (const d of a.dodges) {
					const k = dodgeAmount(d, sNow)
					if (d.kind === 'duck') duck = Math.max(duck, k)
					else (off[0] += d.dx[0] * k), (off[1] += d.dx[1] * k)
				}
				a.dodges = a.dodges.filter((d) => sNow < d.until + 1000)
				const umbrella = !!(a.flags & AV.UMBRELLA) || (a.umb && sNow >= a.umb.from && sNow <= a.umb.until)
				const lost = !!(a.flags & AV.LOST) || !!targetOf(a.tid)?.lost
				a.fade += ((a.gone ? 0 : lost ? LOST_ALPHA : 1) - a.fade) * blend(dt, 5)
				a.disp = { ...pose, duck, off, umbrella, facing: [Math.sin(pose.yaw), Math.cos(pose.yaw)] }
				const tilt = a.react.update(dt, sNow, umbrella)
				a.model.update({ ...a.disp, speed: a.speed, tilt, alpha: a.fade }, dt, t)
				a.model.group.visible = true
			}
		},
		/** flight.js hitTest over the drawn avatars (for the client's own hold-at-contact). */
		hitTest() {
			const list = []
			for (const a of map.values()) if (a.disp && !a.gone) list.push({ tid: a.tid, parts: worldParts(a.disp) })
			if (!list.length) return null
			return (p0, p1, r) => {
				let best = null
				for (const tg of list) {
					const h = sweepParts(tg.parts, p0, p1, r)
					if (h && (!best || h.u < best.u)) best = { ...h, tid: tg.tid }
				}
				return best
			}
		},
		/** The drawn avatars: [{ tid, pose (with duck / off), standIn, height }] */
		list() {
			return [...map.values()].filter((a) => a.disp && !a.gone).map((a) => ({ tid: a.tid, pose: a.disp, standIn: a.standIn, flags: a.flags }))
		},
		setQuality(nq) {
			q = nq
			for (const a of map.values()) a.model.setQuality(nq)
		},
		clear() {
			for (const a of [...map.values()]) drop(a)
			lastIds = null
		},
	}
}
