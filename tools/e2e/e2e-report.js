'use strict'

/** WO-719 — results.json → report.md (one table per scenario, failures first-line, screenshot per step). */

const fs = require('fs')
const path = require('path')

function writeReport(out, res) {
	const lines = [`# HighAsCG GUI end-to-end run`, '', `Server: ${res.server} · **${res.passed} passed, ${res.failed} failed, ${res.skipped} skipped**`, '']
	const by = new Map()
	for (const s of res.steps || []) {
		if (!by.has(s.scenario)) by.set(s.scenario, [])
		by.get(s.scenario).push(s)
	}
	for (const [name, steps] of by) {
		lines.push(`## ${name}`, '', '| | step | ms | detail | shot |', '|---|---|---:|---|---|')
		for (const s of steps) {
			const mark = s.skipped ? '⏭' : s.ok ? '✅' : '❌'
			const shot = s.shot ? `[png](${path.relative(out, s.shot)})` : ''
			lines.push(`| ${mark} | ${s.step} | ${s.ms} | ${String(s.why || '').replace(/\|/g, '\\|').slice(0, 300)} | ${shot} |`)
		}
		lines.push('')
	}
	fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n'))
}

module.exports = { writeReport }
