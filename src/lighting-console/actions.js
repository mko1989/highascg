'use strict'

/**
 * WO-837 — the actions a timeline `light` flag (and the Devices-tab test) can ask a lighting console for, validated
 * once here so no driver ever builds an OSC address from unchecked text:
 *   go       { list, cue? }        go (or go to cue `cue`) in cue list / playback `list`
 *   fader    { fader, level }      level 0–100 %
 *   release  { list }
 *   command  { command }           a command-line string (grandMA3, Eos, MagicQ /rpc)
 * `list`, `cue` and `fader` are numbers or numeric strings ("2", "2.5"; a fader may be "page.fader", "2.201").
 * Anything else throws an Error whose message the operator can act on.
 */

const NUM_RE = /^\d{1,5}(\.\d{1,3})?$/
const FADER_RE = /^\d{1,4}(\.\d{1,4})?$/
const ACTIONS = ['go', 'fader', 'release', 'command']
const MAX_COMMAND = 400

function num(v, re, what) {
	const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : ''
	if (!re.test(s)) throw new Error(`light action: ${what} must be a number (got ${JSON.stringify(v)})`)
	return s
}

/** @param {any} src → { action, list?, cue?, fader?, level?, command? } with strings for list/cue/fader */
function normalizeAction(src) {
	const a = src && typeof src === 'object' ? src : {}
	const action = a.action
	if (!ACTIONS.includes(action)) throw new Error(`light action: unknown action ${JSON.stringify(action)} (go, fader, release, command)`)
	if (action === 'go') {
		const out = { action, list: num(a.list, NUM_RE, 'list') }
		if (a.cue != null && a.cue !== '') out.cue = num(a.cue, NUM_RE, 'cue')
		return out
	}
	if (action === 'release') return { action, list: num(a.list, NUM_RE, 'list') }
	if (action === 'fader') {
		const level = Number(a.level)
		if (a.level === '' || a.level == null || !Number.isFinite(level) || level < 0 || level > 100) {
			throw new Error(`light action: fader level must be 0–100 (got ${JSON.stringify(a.level)})`)
		}
		return { action, fader: num(a.fader, FADER_RE, 'fader'), level }
	}
	const command = typeof a.command === 'string' ? a.command.trim() : ''
	// eslint-disable-next-line no-control-regex
	if (!command || command.length > MAX_COMMAND || /[\x00-\x1f]/.test(command)) {
		throw new Error(`light action: command must be 1–${MAX_COMMAND} characters on one line`)
	}
	return { action, command }
}

/** OSC argument helpers (explicit types: osc.js writes a bare JS number as a float). */
const I = (value) => ({ type: 'i', value: Math.round(value) })
const F = (value) => ({ type: 'f', value })
const S = (value) => ({ type: 's', value: String(value) })

module.exports = { normalizeAction, ACTIONS, NUM_RE, I, F, S }
