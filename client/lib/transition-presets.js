/**
 * Transition type constants + pure helpers (no scene-state dependency — safe to import anywhere).
 */

export const DEFAULT_TRANSITION = { type: 'CUT', duration: 0, tween: 'linear' }
/** Values persisted on scenes / timeline. Labels for the UI are in {@link TRANSITION_TYPE_LABELS}. */
export const TRANSITION_TYPES = ['CUT', 'MIX', 'PUSH', 'WIPE', 'SLIDE', 'MIX + ANIMATE', 'WIPE + ANIMATE', 'SLIDE + ANIMATE', 'PUSH + ANIMATE']
export const TRANSITION_TWEENS = ['linear', 'easein', 'easeout', 'easeboth']

/** UI label for each transition type value (legacy `+ MERGE` is migrated to `+ ANIMATE` on load). */
export const TRANSITION_TYPE_LABELS = {
	CUT: 'CUT',
	MIX: 'MIX',
	PUSH: 'PUSH',
	WIPE: 'WIPE',
	SLIDE: 'SLIDE',
	'MIX + ANIMATE': 'MIX + Animate',
	'WIPE + ANIMATE': 'Wipe + Animate',
	'SLIDE + ANIMATE': 'Slide + Animate',
	'PUSH + ANIMATE': 'Push + Animate',
}

/** PGM-only outputs: no PRV bus — plain MIX/WIPE/SLIDE/PUSH are not supported on take. */
export const PGM_ONLY_TRANSITION_TYPES = [
	'CUT',
	'MIX + ANIMATE',
	'WIPE + ANIMATE',
	'SLIDE + ANIMATE',
	'PUSH + ANIMATE',
]

const PLAIN_TO_ANIMATE_TRANSITION = {
	MIX: 'MIX + ANIMATE',
	PUSH: 'PUSH + ANIMATE',
	WIPE: 'WIPE + ANIMATE',
	SLIDE: 'SLIDE + ANIMATE',
}

/** Map persisted transition type to current dropdown value (same-layer animate path). */
export function migrateTransitionTypeToAnimate(t) {
	return String(t || '')
		.replace(/\s*\+\s*MERGE\b/gi, '+ ANIMATE')
		.trim()
}

/**
 * Map a transition for PGM-only direct-program take (e.g. global MIX → MIX + Animate).
 * @param {{ type?: string, duration?: number, tween?: string } | null | undefined} t
 * @returns {{ type: string, duration: number, tween: string }}
 */
export function normalizeTransitionForPgmOnly(t) {
	const base = { ...DEFAULT_TRANSITION, ...(t && typeof t === 'object' ? t : {}) }
	const type = migrateTransitionTypeToAnimate(base.type)
	if (type === 'CUT') {
		return { type: 'CUT', duration: 0, tween: base.tween || 'linear' }
	}
	if (PGM_ONLY_TRANSITION_TYPES.includes(type)) {
		return {
			type,
			duration: Math.max(0, Math.round(Number(base.duration) || 0)),
			tween: base.tween || 'linear',
		}
	}
	const mapped = PLAIN_TO_ANIMATE_TRANSITION[type]
	if (mapped) {
		const dur = Math.max(0, Math.round(Number(base.duration) || 0))
		return {
			type: mapped,
			duration: dur > 0 ? dur : 12,
			tween: base.tween || 'linear',
		}
	}
	return { type: 'CUT', duration: 0, tween: 'linear' }
}
