/**
 * Every player's slingshot in the room (WO-1089 §3 / §11): one slingshot-model.js per player with a slot, at
 * `venue.slots[slot]`, grips in the player's colour, a name tag over the others'. The others' fork and band follow
 * their `w.sl` [yaw, pitch, pull] (eased); the own one is driven by the local aim every frame (setOwn).
 */
import { createSlingshot } from './slingshot-model.js'
import { safeColor } from './dom.js'
import { blend } from './avatar-spec.js'

export function createSlings(THREE, scene) {
	const map = new Map() // pid → { s, slot, color, name, aim, want }
	let meId = null

	function drop(id) {
		const e = map.get(id)
		if (!e) return
		e.s.dispose()
		map.delete(id)
	}

	return {
		/** Roster / venue changed. */
		sync(state, venue, myId) {
			meId = myId
			const players = (state?.players || []).filter((p) => p && p.slot != null && venue?.slots?.[p.slot])
			const ids = new Set(players.map((p) => p.id))
			for (const id of [...map.keys()]) if (!ids.has(id)) drop(id)
			for (const p of players) {
				const slot = venue.slots[p.slot]
				const color = safeColor(p.color, '#dddddd')
				const name = p.id === meId ? '' : String(p.name ?? '') + (p.bot ? ' (bot)' : '')
				const e = map.get(p.id)
				if (e && e.slot === slot && e.color === color && e.name === name) continue
				if (e) drop(p.id)
				const s = createSlingshot(THREE, { color, name, slotYaw: slot.yaw })
				s.group.position.set(slot.p[0], slot.p[1], slot.p[2])
				scene.add(s.group)
				s.setVeg(p.id === meId ? null : 'tomato')
				const aim = { yaw: slot.yaw, pitch: 0.35, pull: 0 }
				map.set(p.id, { s, slot, color, name, aim, want: { ...aim } })
			}
		},
		/** `w.sl` rows. */
		onAims(rows) {
			for (const r of rows || []) {
				const e = map.get(r.id)
				if (e && r.id !== meId) e.want = { yaw: r.yaw, pitch: r.pitch, pull: r.pull }
			}
		},
		/** The own slingshot: the local aim and the vegetable in the pouch (null while reloading). */
		setOwn(yaw, pitch, pull, veg) {
			const e = map.get(meId)
			if (!e) return
			e.aim = { yaw, pitch, pull }
			e.s.setAim(yaw, pitch, pull)
			e.s.setVeg(veg)
		},
		/** Another player's release: the band snaps back. */
		released(id) {
			const e = map.get(id)
			if (e && id !== meId) e.want = { ...e.want, pull: 0 }
		},
		update(dt) {
			const k = blend(dt, 12)
			for (const [id, e] of map) {
				if (id !== meId) {
					const d = Math.atan2(Math.sin(e.want.yaw - e.aim.yaw), Math.cos(e.want.yaw - e.aim.yaw))
					e.aim.yaw += d * k
					e.aim.pitch += (e.want.pitch - e.aim.pitch) * k
					e.aim.pull += (e.want.pull - e.aim.pull) * (e.want.pull < e.aim.pull ? blend(dt, 30) : k)
					e.s.setAim(e.aim.yaw, e.aim.pitch, e.aim.pull)
				}
				e.s.update(dt)
			}
		},
		own: () => map.get(meId) || null,
		clear() {
			for (const id of [...map.keys()]) drop(id)
		},
	}
}
