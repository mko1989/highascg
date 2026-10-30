'use strict'

/**
 * WO-836 Part 3c — "ctrl+z", "space", "delete" → xdotool keysyms ("ctrl+z", "space", "Delete"). Pure.
 * Case-insensitive on the names an agent is likely to write; single characters pass through unchanged
 * (xdotool is case-sensitive for them: "A" means shift+a).
 */

const NAMES = {
	ctrl: 'ctrl', control: 'ctrl', alt: 'alt', shift: 'shift', super: 'super', meta: 'super', cmd: 'super',
	enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', space: 'space', spacebar: 'space', tab: 'Tab',
	backspace: 'BackSpace', delete: 'Delete', del: 'Delete', insert: 'Insert', home: 'Home', end: 'End',
	pageup: 'Prior', pgup: 'Prior', pagedown: 'Next', pgdn: 'Next',
	up: 'Up', down: 'Down', left: 'Left', right: 'Right',
	plus: 'plus', minus: 'minus', comma: 'comma', period: 'period', slash: 'slash', equal: 'equal',
}
const MODS = new Set(['ctrl', 'alt', 'shift', 'super'])

/** @param {string} spec e.g. "ctrl+shift+z" @returns {string} */
function normalizeKey(spec) {
	const raw = String(spec || '').trim()
	if (!raw) throw new Error('empty key spec (examples: ctrl+z, space, delete, Return, F5)')
	// "ctrl++" / "+" mean the plus key
	const parts = raw === '+' ? ['plus'] : raw.replace(/\+\+$/, '+plus').split('+')
	const out = parts.map((p, i) => {
		const t = p.trim()
		if (!t) throw new Error(`bad key spec '${spec}'`)
		const low = t.toLowerCase()
		if (NAMES[low]) return NAMES[low]
		if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(t)) return t.toUpperCase()
		if (t.length === 1) return i === parts.length - 1 && parts.length > 1 ? low : t
		throw new Error(`unknown key '${t}' in '${spec}' (use names like ctrl, shift, enter, esc, space, tab, backspace, delete, up, down, left, right, home, end, pageup, pagedown, F1..F12 or one character)`)
	})
	const last = out[out.length - 1]
	if (MODS.has(last) && out.length === 1) return last
	return out.join('+')
}

module.exports = { normalizeKey }
