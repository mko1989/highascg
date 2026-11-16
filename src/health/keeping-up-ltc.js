'use strict'

/**
 * WO-1092 — the "LTC out" keeping-up check (pure). Input: s.ltc = the LTC service's health() (ltc-output.js status), null
 * while LTC out is off — then no result at all (off is not an alarm). Never FAILING: program video and audio are fine,
 * only the timecode feed is in trouble, so it is amber (BEHIND) with plain words:
 *   device missing / in use / encoder error        → BEHIND
 *   ≥ 1 under-run in the last minute                → BEHIND (the receiver saw a dropout)
 *   ≥ 2 drift re-aligns in the last minute          → BEHIND "not locked" (a healthy output slews; jumps mean the
 *                                                     card's clock or the box cannot keep the timecode steady)
 */

const { OK, BEHIND } = require('./keeping-up-model')

const WORDS = { missing: 'device not connected', busy: 'device in use by another program', error: 'not running' }

function ltcChecks(s) {
	const l = s.ltc
	if (!l || l.state === 'off') return []
	const base = { key: 'ltc-out', group: 'output', name: 'LTC out', rise: 2, fall: 2, target: 'running, locked' }
	if (WORDS[l.state]) {
		return [{ ...base, level: BEHIND, measured: l.state, text: l.error ? `${WORDS[l.state]} — ${l.error}` : WORDS[l.state], severity: 10,
			label: `LTC out: ${WORDS[l.state]}`, hint: 'No timecode reaches the LTC receivers (lighting, sound, recorders): check the cable / card, or pick another device in Audio ▸ LTC out.' }]
	}
	const under = Number(l.underrunsRecent) || 0
	const drift = Number(l.driftRelocatesRecent) || 0
	if (under > 0) {
		return [{ ...base, level: BEHIND, measured: `${under} under-runs`, text: `${under} under-run${under > 1 ? 's' : ''} in the last minute`, severity: under,
			label: `LTC out dropping out (${under}× in a minute)`, hint: 'The LTC sound card ran dry: receivers saw a gap in the timecode. The box was too busy to feed it.' }]
	}
	if (drift >= 2) {
		return [{ ...base, level: BEHIND, measured: `${drift} re-aligns`, text: `${drift} re-aligns in the last minute`, severity: drift,
			label: 'LTC out not locked', hint: 'The timecode had to jump back into place repeatedly: receivers chasing it may stutter.' }]
	}
	return [{ ...base, level: OK, measured: l.state, text: l.state === 'running' ? `${l.tc || ''} · ${l.driftMs ?? 0} ms`.trim() : l.state, severity: 0, label: 'LTC out' }]
}

module.exports = { ltcChecks }
