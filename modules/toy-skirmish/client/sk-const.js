/**
 * Stage Skirmish numbers (WO-1081, work/notes/skirmish-game-contract.md §3) — pure. Every length here is in "u"
 * (one unit = the scene's `scale` in metres, 0.1 live: a soldier is a 5.5 cm toy); times in seconds, angles in degrees
 * in the tables. `toM(v, s)` turns u into metres; nothing else in the client multiplies by the scale.
 * The weapon names, looks and sounds are this game's own.
 */

export const SOLDIER = Object.freeze({
	R: 0.18, // radius (u)
	H: 0.55, // height (u)
	MUZZLE_H: 0.35, // muzzle and hit height above the floor (u)
	SPEED: 4.5, // run speed (u/s), no sprint, no jump
	ACCEL_T: 0.12, // seconds to full speed
	SPEED_CAP: 6, // the server clamps anything above
})

export const HP_MAX = 100
export const AR_MAX = 100
export const ARMOUR_ABSORB = 0.6
export const RESPAWN_S = 3
export const PROTECT_S = 1.5
export const PICK_R = 0.5 // pick-up radius, centre to centre (u)
export const MAX_PLAYERS = 10
/** A cut through the room this high above the arena floor (u) — everything of the scene above it vanishes (§9). */
export const CUT_H = 1.2

/**
 * Weapons (§3). `ammo` start / pickup / max: −1 = infinite. `pellets` rays per shot; `spread` full cone (deg);
 * `rank` = how good it is for the auto-switch (higher = better).
 */
export const WEAPONS = Object.freeze({
	pea: Object.freeze({
		id: 'pea',
		name: 'Peashooter',
		kind: 'hitscan',
		dmg: 14,
		interval: 0.3,
		range: 40,
		spread: 1.5,
		pellets: 1,
		ammo: Object.freeze({ start: -1, pickup: 0, max: -1 }),
		rank: 0,
		key: 1,
	}),
	rattler: Object.freeze({
		id: 'rattler',
		name: 'Rattler',
		kind: 'hitscan',
		dmg: 9,
		interval: 0.085,
		range: 45,
		spread: 4,
		pellets: 1,
		ammo: Object.freeze({ start: 0, pickup: 60, max: 180 }),
		rank: 1,
		key: 2,
	}),
	scatter: Object.freeze({
		id: 'scatter',
		name: 'Scatter',
		kind: 'hitscan',
		dmg: 7,
		interval: 0.85,
		range: 16,
		spread: 14,
		pellets: 8,
		ammo: Object.freeze({ start: 0, pickup: 8, max: 32 }),
		rank: 2,
		key: 3,
	}),
	longshot: Object.freeze({
		id: 'longshot',
		name: 'Longshot',
		kind: 'hitscan',
		dmg: 85,
		interval: 1.4,
		range: 120,
		spread: 0,
		pellets: 1,
		ammo: Object.freeze({ start: 0, pickup: 5, max: 20 }),
		rank: 3,
		key: 4,
	}),
	thumper: Object.freeze({
		id: 'thumper',
		name: 'Thumper',
		kind: 'rocket',
		dmg: 90, // at the centre, linear to 0 at SPLASH_R
		interval: 1.0,
		range: 88, // ROCKET_SPEED × ROCKET_LIFE
		spread: 0,
		pellets: 1,
		ammo: Object.freeze({ start: 0, pickup: 4, max: 16 }),
		rank: 4,
		key: 5,
	}),
})

/** Slot order (keys 1–5, wheel, Q). */
export const WEAPON_ORDER = Object.freeze(['pea', 'rattler', 'scatter', 'longshot', 'thumper'])

export const ROCKET = Object.freeze({
	SPEED: 22, // u/s
	LIFE: 4, // s
	HIT_R: 0.28, // soldier radius + 0.1 u
	SPLASH_R: 4, // u
	SELF_K: 0.5,
	EXPIRE: 4.5, // s — a rocket whose owner never reports
})

/** Pick-ups (§3): what each kind is and when it comes back (s). */
export const PICKUPS = Object.freeze({
	rattler: Object.freeze({ name: 'Rattler', respawn: 15, weapon: true }),
	scatter: Object.freeze({ name: 'Scatter', respawn: 15, weapon: true }),
	longshot: Object.freeze({ name: 'Longshot', respawn: 15, weapon: true }),
	thumper: Object.freeze({ name: 'Thumper', respawn: 15, weapon: true }),
	health: Object.freeze({ name: 'Health', respawn: 20, weapon: false }),
	armour: Object.freeze({ name: 'Armour', respawn: 30, weapon: false }),
	surge: Object.freeze({ name: 'Surge', respawn: 90, weapon: false }),
})

/** `w` flags (§7). */
export const FLAG = Object.freeze({ MOVING: 1, DEAD: 2, PROTECTED: 4, SURGE: 8 })

export const PHASES = Object.freeze(['lobby', 'countdown', 'match', 'results'])
export const MODES = Object.freeze(['dm', 'tdm'])
/** Team colours in `tdm` (red 0 / blue 1). */
export const TEAM_COLORS = Object.freeze(['#ff4d3d', '#3aa0ff'])
export const TEAM_NAMES = Object.freeze(['Red', 'Blue'])

/** Toy building block colours (`blocks[].c` 0–5). */
export const BLOCK_COLORS = Object.freeze(['#e8463a', '#f2b632', '#3a8ee8', '#46b85a', '#f2f0e6', '#9a5ad8'])

/** u → metres at scale s. */
export function toM(v, s) {
	return v * s
}

/** Is a weapon id known? */
export function isWeapon(w) {
	return typeof w === 'string' && Object.prototype.hasOwnProperty.call(WEAPONS, w)
}

/** Degrees → radians. */
export function rad(deg) {
	return (deg * Math.PI) / 180
}

/** Unit forward vector of a yaw (yaw 0 faces −Z, rotation about +Y, as in the RC game). */
export function fwd(yaw) {
	return [-Math.sin(yaw), -Math.cos(yaw)]
}

/** Yaw that faces the plan direction (dx, dz). */
export function yawOf(dx, dz) {
	return Math.atan2(-dx, -dz)
}
