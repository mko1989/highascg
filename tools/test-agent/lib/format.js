'use strict'

/** WO-836 Part 3c — compact text for `ui list` (a Haiku agent reads this, so one control per line). Pure. */

function q(s) {
	return JSON.stringify(String(s))
}

/** @param {object} e one entry from the client's `list` */
function line(e) {
	const parts = [`[${e.kind}]`]
	const main = e.label || e.tip || e.placeholder || ''
	parts.push(main ? q(main) : '(unnamed)')
	if (e.tip && e.tip !== main) parts.push(`tip=${q(e.tip.length > 70 ? e.tip.slice(0, 67) + '...' : e.tip)}`)
	if (e.kind === 'field') {
		if (e.caption && e.caption !== main) parts.push(`caption=${q(e.caption)}`)
		if (e.placeholder && e.placeholder !== main) parts.push(`hint=${q(e.placeholder)}`)
		parts.push(`value=${q(e.text ?? '')}`)
		if (e.editable === false) parts.push('READONLY')
	}
	if (e.kind === 'option') parts.push(`items=${q((e.items || []).join(' | '))}`)
	if (e.kind === 'tab' && e.selected) parts.push('SELECTED')
	if ((e.kind === 'toggle') && e.pressed != null) parts.push(e.pressed ? 'ON' : 'off')
	if (e.kind === 'row' && e.cols && e.cols.length > 1) parts.push(`cols=${q(e.cols.join(' | '))}`)
	if (e.kind === 'row' && e.depth > 1) parts.push(`depth=${e.depth}`)
	if (!e.enabled) parts.push('DISABLED')
	parts.push(`at ${e.cx},${e.cy}`, `rect ${e.x},${e.y},${e.w}x${e.h}`)
	return parts.join(' ')
}

/** @param {{count:number, shown:number, entries:object[]}} res */
function formatList(res) {
	const out = res.entries.map(line)
	out.push(res.count > res.shown ? `-- ${res.shown} of ${res.count} shown; narrow with a kind (buttons|fields|tabs|options|rows|labels) or --under "<container>" or --limit N` : `-- ${res.count} controls`)
	return out.join('\n')
}

module.exports = { line, formatList }
