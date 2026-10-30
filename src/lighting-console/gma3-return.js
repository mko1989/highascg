'use strict'

/**
 * WO-857 — the return path to a grandMA3: HighAsCG's selection / level / aim, typed into the console's command line over
 * OSC `/cmd` (Menu > In & Out > OSC: Enable Input, Receive Command = Yes). Plain command-line text, one message per
 * command, never an OSC bundle (the console does not read them). The sender is the WO-837 lighting-console service
 * (`fire(id, { action: 'command' })` → drivers/grandma3.js → osc-send.js, one UDP datagram per message).
 *
 *   selectCommand([101,102,103,110]) → "Fixture 101 Thru 103 + 110"
 *   atCommand(50)                    → "At 50"
 *   attributeCommand("Pan", 12.5)    → 'Attribute "Pan" At 12.5'
 *
 * UNCERTAIN until run on a console: the multi-range form of `Fixture`, and the scale of Pan / Tilt (percent of the range
 * or physical degrees, WO-857 §1.3). The commands themselves are ordinary MA3 command-line syntax.
 */

const MAX_COMMAND = 400 // actions.js
const ATTR_RE = /^[A-Za-z][A-Za-z0-9 _]{0,31}$/

/** Head numbers → one `Fixture a Thru b + c` selection command (runs of 3+ become `Thru`), or throws when it will not fit. */
function selectCommand(fids) {
	const list = [...new Set((fids || []).map(Number))].sort((a, b) => a - b)
	if (!list.length || list.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('select needs one or more head numbers (whole numbers from 1)')
	const parts = []
	for (let i = 0; i < list.length; ) {
		let j = i
		while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++
		parts.push(j - i >= 2 ? `${list[i]} Thru ${list[j]}` : list.slice(i, j + 1).join(' + '))
		i = j + 1
	}
	const text = `Fixture ${parts.join(' + ')}`
	if (text.length > MAX_COMMAND) throw new Error(`selection too long for one command line (${text.length} > ${MAX_COMMAND} characters): pick fewer separate ranges`)
	return text
}

function atCommand(level) {
	const n = Number(level)
	if (level === '' || level == null || !Number.isFinite(n) || n < 0 || n > 100) throw new Error(`level must be 0–100 (got ${JSON.stringify(level)})`)
	return `At ${+n.toFixed(3)}`
}

function attributeCommand(name, value) {
	const n = Number(value)
	if (typeof name !== 'string' || !ATTR_RE.test(name)) throw new Error(`attribute must be a name like "Pan" (got ${JSON.stringify(name)})`)
	if (value === '' || value == null || !Number.isFinite(n) || Math.abs(n) > 1e6) throw new Error(`attribute value must be a number (got ${JSON.stringify(value)})`)
	return `Attribute "${name}" At ${+n.toFixed(4)}`
}

/**
 * The command lines for one return-path request, in send order.
 * @param {{ action: 'select' | 'at' | 'attribute', fids?: number[], level?: number, attribute?: string, value?: number }} req
 *   `at` / `attribute` act on what the console has selected; with `fids` the selection is typed first.
 */
function commandsFor(req) {
	const r = req && typeof req === 'object' ? req : {}
	const lines = []
	if (r.action === 'select') return [selectCommand(r.fids)]
	if (r.action !== 'at' && r.action !== 'attribute') throw new Error(`unknown action ${JSON.stringify(r.action)} (select, at, attribute)`)
	if (Array.isArray(r.fids) && r.fids.length) lines.push(selectCommand(r.fids))
	lines.push(r.action === 'at' ? atCommand(r.level) : attributeCommand(r.attribute, r.value))
	return lines
}

/**
 * Send `lines` to the stored console `consoleId` (kind grandma3) in order. → { ok, console, sent: [command] }
 * @param {{ fire: Function, get: Function }} svc the lighting-console service
 */
async function sendCommands(svc, consoleId, lines) {
	const con = svc.get(consoleId)
	if (!con) throw new Error(`lighting console ${JSON.stringify(consoleId)} is not configured (Devices > Lighting consoles)`)
	if (con.kind !== 'grandma3') throw new Error(`console ${JSON.stringify(consoleId)} is a ${con.kind}, the return path speaks grandMA3 command lines`)
	for (const command of lines) await svc.fire(consoleId, { action: 'command', command })
	return { ok: true, console: consoleId, sent: lines }
}

module.exports = { selectCommand, atCommand, attributeCommand, commandsFor, sendCommands }
