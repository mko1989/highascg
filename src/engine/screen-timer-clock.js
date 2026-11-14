/**
 * Screen-timer clock — what a timer record says the countdown shows right now. One place for the server (pause,
 * start, re-ADD, bus move, restyle) so the template on screen is always told the same number the panels compute
 * from `lastCmd` / `cmdAt` / `remainingSec`, instead of keeping its own count that can drift away from the record.
 */

'use strict'

/** Duration mode is the only one with a server-side count (clock mode derives from the wall clock in the template). */
function isDurationMode(record) {
	return ((record && record.config && record.config.mode) || 'duration') === 'duration'
}

/** `config.overrun === false` = stop at 00:00; anything else counts on below zero (the behaviour before the option). */
function allowsOverrun(record) {
	return !(record && record.config && record.config.overrun === false)
}

/**
 * Remaining seconds of a duration timer at `now` — negative once it has run past zero (clamped when overrun is off).
 * Stopped / reset = the configured duration.
 * @param {object} record
 * @param {number} [now]
 * @returns {number}
 */
function remainingNow(record, now = Date.now()) {
	const configured = Number(record?.config?.durationSec) || 0
	const basis = Number.isFinite(record?.remainingSec) ? record.remainingSec : configured
	let out = configured
	if (record?.lastCmd === 'pause') out = basis
	else if (record?.lastCmd === 'start' && Number.isFinite(record.cmdAt)) out = basis - (now - record.cmdAt) / 1000
	return allowsOverrun(record) ? out : Math.max(0, out)
}

/**
 * Extra CG payload fields that put a template instance on the record's count: a fresh instance (CG ADD after a
 * restart, a cleared preview channel, a move between PGM and PRV) starts stopped at the full duration otherwise.
 * @param {object} record
 * @param {number} [now]
 * @returns {object}
 */
function resumeFields(record, now = Date.now()) {
	if (!isDurationMode(record)) return record?.lastCmd === 'start' ? { cmd: 'start' } : {}
	if (record?.lastCmd === 'start') return { cmd: 'start', remainingSec: remainingNow(record, now) }
	if (record?.lastCmd === 'pause') return { syncRemainingSec: remainingNow(record, now) }
	return {}
}

module.exports = { isDurationMode, remainingNow, resumeFields }
