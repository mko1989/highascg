'use strict'

/**
 * WO-1081 — Stage Skirmish: the numbers both sides use (work/notes/skirmish-game-contract.md §3). Every length here is
 * in "u" (one unit = the scene's `scale` metres; 0.1 live, so a soldier is a 5.5 cm toy); times in ms or s as named;
 * angles in degrees in the tables. The wire and the scene JSON carry real metres: multiply by `scale`.
 * Also the shared helpers whose results must match the client bit for bit: `mulberry32` (pellet spread from a shot's
 * `seed`) and `dirOf` (yaw 0 faces −Z, three.js forward: direction (−sin yaw, −cos yaw)).
 */

/** Weapons (original names). ammo: −1 = infinite. pellets = hits one fire may claim. */
const WEAPONS = {
	pea: { name: 'Peashooter', kind: 'hitscan', dmg: 14, interval: 0.3, range: 40, spread: 1.5, pellets: 1, start: -1, pickup: 0, max: -1 },
	rattler: { name: 'Rattler', kind: 'hitscan', dmg: 9, interval: 0.085, range: 45, spread: 4, pellets: 1, start: 0, pickup: 60, max: 180 },
	scatter: { name: 'Scatter', kind: 'hitscan', dmg: 7, interval: 0.85, range: 16, spread: 14, pellets: 8, start: 0, pickup: 8, max: 32 },
	longshot: { name: 'Longshot', kind: 'hitscan', dmg: 85, interval: 1.4, range: 120, spread: 0, pellets: 1, start: 0, pickup: 5, max: 20 },
	thumper: { name: 'Thumper', kind: 'rocket', dmg: 90, interval: 1.0, range: 88, spread: 0, pellets: 1, start: 0, pickup: 4, max: 16 },
}
const WEAPON_IDS = Object.keys(WEAPONS)

/** Rocket (Thumper): speed u/s, life s, splash radius u (linear 90 → 0), owner factor, soldier contact radius. */
const ROCKET = { speed: 22, life: 4, splash: 4, self: 0.5, contact: 0.18 + 0.1, expireMs: 4500, rayTol: 1 }

/** Pickups: weapons give the weapon (or its pickup ammo); respawn in s. */
const PICKUPS = {
	rattler: { respawn: 15 },
	scatter: { respawn: 15 },
	longshot: { respawn: 15 },
	thumper: { respawn: 15 },
	health: { amount: 35, respawn: 20 },
	armour: { amount: 50, respawn: 30 },
	surge: { duration: 20, respawn: 90, minSide: 30 },
}
const PICKUP_KINDS = Object.keys(PICKUPS)

const SOLDIER = { radius: 0.18, height: 0.55, muzzle: 0.35, speed: 4.5, maxSpeed: 6 }

const RULES = {
	health: 100, maxHealth: 100, maxArmour: 100, absorb: 0.6,
	respawnMs: 3000, protectMs: 1500,
	pickRadius: 0.5, pickSlack: 0.5, // server tolerance on top of the 0.5 u radius: its position of the picker is ≤ 50 ms old
	hitSlack: 3, fireWindowMs: 1500, intervalTol: 0.1,
	posSlack: 2, // positions outside the arena rect + 2 u are ignored
	countdownMs: 3000, resultsMs: 15000,
	maxPlayers: 10, maxSpectators: 20, maxBots: 6,
	frags: { dm: 20, tdm: 40, spot: 60, min: 5, max: 100 }, minutes: { def: 5, min: 1, max: 30 },
}

/** Arena rules (§4), lengths in u. */
const ARENA = {
	minSide: 25, maxSide: 80, minArenas: 3, maxArenas: 8, blocked: [0.08, 0.4], minSpawns: 10, spawnGap: 6, spawnClear: 1,
	pickupGap: 4, pickupSpawnGap: 3, pickupClear: 0.6, health: [2, 4], armour: [1, 2], blockMinH: 0.6, colours: 6,
}

/** The same PRNG as the client (shot spread): mulberry32(seed) → () => [0, 1). */
function mulberry32(seed) {
	let a = seed | 0
	return () => {
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Pellet yaws of a shot: one draw per pellet, uniform in ± spread / 2 around `yaw`. */
function pelletYaws(w, yaw, seed) {
	const W = WEAPONS[w]
	const rnd = mulberry32(seed)
	const half = ((W?.spread || 0) * Math.PI) / 360
	const out = []
	for (let i = 0; i < (W?.pellets || 1); i++) out.push(yaw + (rnd() * 2 - 1) * half)
	return out
}

/** Unit direction of a yaw (0 faces −Z). */
const dirOf = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)]

/** The yaw that faces from (ax, az) towards (bx, bz). */
const yawTo = (ax, az, bx, bz) => Math.atan2(-(bx - ax), -(bz - az))

/** FNV-1a 32-bit of a string (deterministic seeds per scene rev). */
function hash32(s) {
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
	return h >>> 0
}

module.exports = { WEAPONS, WEAPON_IDS, ROCKET, PICKUPS, PICKUP_KINDS, SOLDIER, RULES, ARENA, mulberry32, pelletYaws, dirOf, yawTo, hash32 }
