/**
 * Numbers of the RC car physics (WO-1074, contract v2 §2.2) — pure. Speeds in m/s, times in s, angles in rad.
 */
export const PHYS = Object.freeze({
	DT: 1 / 60,
	/* top speeds (contract §2.2) */
	TOP_ON: 13, // on the ribbon
	TOP_OFF: 7, // off it
	TOP_BOOST: 18, // while boosting (anywhere)
	CAP: 24, // hard cap, never exceeded
	REV_TOP: 5,
	/* longitudinal: a = ACCEL · (1 − ACCEL_FALL · f / top) → 0 → 13 m/s in ≈ 1.6 s, punchy off the line */
	ACCEL: 11.5,
	ACCEL_FALL: 0.55,
	BOOST_ACCEL: 30,
	ACCEL_REV: 9,
	BRAKE: 28,
	COAST: 3,
	OVER_DECEL: 12, // above the current top (left the ribbon at speed, boost ended)
	/* steering: yaw rate = steer · min(|f| / TURN_R, TURN_MAX) — wide lock at speed (13 m/s → r ≈ 3.9 m) */
	STEER_RATE: 7, // input units per second
	TURN_R: 1.4,
	TURN_MAX: 3.3,
	AIR_STEER: 0.3,
	GRIP: 16,
	GRIP_OFF: 10,
	GRIP_DRIFT: 13,
	GRIP_AIR: 0.4,
	/* drift (hop + held slide angle + two charge stages → mini-boost) */
	DRIFT_MIN_V: 6,
	DRIFT_KEEP_V: 4,
	DRIFT_SLIP: 0.38, // held slide angle between the nose and the direction of travel
	SLIP_RATE: 7,
	TURN_DRIFT: 3.7,
	HOP_V: 2.4,
	DRIFT_T1: 0.7,
	DRIFT_T2: 1.6,
	MINI_1: 0.6,
	MINI_2: 1.3,
	/* boosts */
	PAD_BOOST: 1.0,
	TURBO: 1.5,
	START_BOOST: 1.0,
	START_WINDOW: 0.35,
	STALL: 1.0,
	/* items hitting the car */
	SPIN: 1.2,
	SPIN_KEEP: 0.3,
	IMMUNE: 2.0,
	SHIELD: 8,
	CATCHUP_MAX: 0.08,
	/* 3D */
	GRAVITY: 20,
	STICK: 0.04, // a grounded car follows ground up to this far below its ballistic path (no micro-hops)
	RESTITUTION: 0.4,
	SCRAPE: 0.92, // tangential speed kept on a wall hit
	/* body */
	RADIUS: 0.3, // collision circle (car drawn ≈ 0.63 × 0.35 m — the 0.45 m buggy at 1.4×, readable on a phone)
	CAR_GAP: 0.62, // centre distance where two cars touch
	CAR_H: 0.5, // obstacles collide when [min.y, max.y] overlaps [y, y + CAR_H]
	PROBE: 0.45, // wall-normal probe radius
	/* pads (size is ours: the contract gives only the centre and yaw) */
	PAD_LEN: 2.2,
	PAD_HALF_W: 1.2,
	/* auto-unstick: throttle held, slower than UNSTICK_V for UNSTICK_T → nudged back towards the ribbon */
	UNSTICK_T: 1.5,
	UNSTICK_V: 1.0,
	UNSTICK_STEP: 1.2,
})
