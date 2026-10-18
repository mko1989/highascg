'use strict'

/**
 * WO-618 — the one place a tween name becomes a Caspar tween token.
 *
 * Caspar's tweener (`src/common/tweener.cpp` get_tweens) knows only the Penner names below; anything else
 * makes the whole command fail (`403 PLAY FAILED`, `403 MIXER OPACITY FAILED` — probed on build v2 and the v1
 * prod binary). The UI has always offered the shorthand `easein` / `easeout` / `easeboth` (transitions) and
 * `ease-in` / `ease-out` / `ease-in-out` (timeline keyframes), so every non-linear choice either failed the take
 * or silently played linear. The shorthands map to the quad family; Caspar names (with an optional `:p0:p1`
 * parameter suffix) pass through; unknown names fall back to linear rather than failing a take.
 */

const CASPAR_TWEENS = new Set([
	'linear',
	'easenone',
	...['quad', 'cubic', 'quart', 'quint', 'sine', 'expo', 'circ', 'elastic', 'back', 'bounce'].flatMap((f) => [
		`easein${f}`,
		`easeout${f}`,
		`easeinout${f}`,
		f === 'back' ? 'easeoutintback' : `easeoutin${f}`, // sic, tweener.cpp
	]),
])

const ALIASES = {
	easein: 'easeinquad',
	easeout: 'easeoutquad',
	easeinout: 'easeinoutquad',
	easeboth: 'easeinoutquad',
}

/**
 * @param {unknown} name UI / API tween or easing name
 * @returns {string} a token Caspar accepts
 */
function toCasparTween(name) {
	const raw = String(name ?? '')
		.trim()
		.toLowerCase()
	const [base, ...params] = raw.split(':')
	const key = base.replace(/[-_\s]/g, '')
	if (!key) return 'linear'
	if (ALIASES[key]) return ALIASES[key]
	if (!CASPAR_TWEENS.has(key)) return 'linear'
	return params.length && params.every((p) => /^\d+\.?\d?$/.test(p)) ? [key, ...params].join(':') : key
}

module.exports = { toCasparTween, CASPAR_TWEENS }
