/**
 * Stage Skirmish (WO-1081; WO-1083 follow-up): which LED wall pictures the room's cut must take. The kit's stage effects
 * (kit/stage-fx-wall.js) add each scene `screens` entry as a picture quad to the scene root, not to world.statics, so
 * the cut-away plane (sk-world.js) never reached them — and a wall standing IN an arena (live room: `led_wall_2`, 5 × 4 m
 * in the middle of the `stage` arena) hid the soldiers from the top-down camera (black when programme 1 is black).
 * A picture is cut like the room when its plan footprint overlaps the arena rect grown by MARGIN_U on the sides and
 * towards the camera (+Z, screen-down), but NOT a strip BACK_U deep along the far edge (−Z): a wall standing there is
 * the arena's backdrop — the camera looks at it from the front and it hides no floor. Pictures elsewhere stay uncut.
 * Pure (plain arrays), so the smoke checks it without three.js.
 *
 *   screenOverArena({ min: [x, y, z], max: [x, y, z] }, rect [x0, z0, x1, z1], s) → boolean   (metres; s = scene scale)
 */
export const MARGIN_U = 10
export const BACK_U = 5

export function screenOverArena(box, rect, s = 1) {
	if (!box || !Array.isArray(rect) || rect.length < 4 || ![...box.min, ...box.max, ...rect].every(Number.isFinite)) return false
	const m = MARGIN_U * s
	const [x0, z0, x1, z1] = [rect[0] - m, rect[1] + BACK_U * s, rect[2] + m, rect[3] + m]
	return box.max[0] > x0 && box.min[0] < x1 && box.max[2] > z0 && box.min[2] < z1
}
