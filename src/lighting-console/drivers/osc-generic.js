'use strict'

/**
 * WO-837 — generic OSC console: the operator types an address template per action in the console record
 * (`templates`), e.g. { go: { address: "/pb/{list}/go", args: [1] }, fader: { address: "/fader/{fader}", args: ["{level01}"] } }.
 * Keys: go, goCue (used instead of go when the flag has a cue), fader, release, command, test.
 * Placeholders, in the address and in string args: {list} {cue} {fader} {level} (0–100) {level01} (0–1) {command}.
 * An arg that is exactly one placeholder keeps its type (numbers stay numbers); a number arg is sent as float when it
 * has a fraction, else int; a string arg is sent as text. No vendor document: the user supplies the console's own.
 */

const { I, F, S } = require('../actions')

const KEYS = ['go', 'goCue', 'fader', 'release', 'command', 'test']
const PH_ALL = /\{(list|cue|fader|level|level01|command)\}/g
const PH_ONE = /^\{(list|cue|fader|level|level01|command)\}$/

function values(a) {
	return { list: a.list, cue: a.cue, fader: a.fader, level: a.level, level01: a.level != null ? a.level / 100 : undefined, command: a.command }
}

function arg(v) {
	if (typeof v === 'number') return Number.isInteger(v) ? I(v) : F(v)
	return S(v)
}

function fill(tpl, vals, label) {
	const need = (k) => {
		if (vals[k] == null) throw new Error(`OSC console: "${label}" uses {${k}} which this flag does not carry`)
		return vals[k]
	}
	const sub = (s) => String(s).replace(PH_ALL, (_, k) => String(need(k)))
	const args = (Array.isArray(tpl.args) ? tpl.args : []).map((x) => {
		const one = typeof x === 'string' ? PH_ONE.exec(x) : null
		if (one) return one[1] === 'command' ? S(need('command')) : arg(Number(need(one[1])))
		return arg(typeof x === 'string' ? sub(x) : x)
	})
	return [{ address: sub(tpl.address), args }]
}

module.exports = {
	kind: 'osc',
	label: 'Generic OSC',
	defaultPort: 0, // no default: the operator types the console's port
	KEYS,
	messages(con, a) {
		const t = con.templates || {}
		const key = a.action === 'go' && a.cue != null && t.goCue ? 'goCue' : a.action
		if (!t[key]) throw new Error(`OSC console "${con.name}" has no "${key}" address template (set it in Devices > Lighting consoles)`)
		return fill(t[key], values(a), key)
	},
	testMessages(con) {
		const t = con.templates?.test
		if (!t) throw new Error(`OSC console "${con.name}" has no "test" address template, nothing harmless to send`)
		return fill(t, values({}), 'test')
	},
}
