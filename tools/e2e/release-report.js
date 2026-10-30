'use strict'

/** WO-836 part 3 — one markdown report over the release suite's phases (each phase = one run-gui-e2e.js results.json). */

const fs = require('fs')
const path = require('path')

const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 400)

/** PRINT frames a phase kept (print_<label>_ch<N>_<n>.png next to the step shots). */
function prints(dir) {
	const shots = path.join(dir, 'shots')
	return fs.existsSync(shots) ? fs.readdirSync(shots).filter((f) => f.startsWith('print_')).sort() : []
}

/**
 * @param {string} out report folder (links are relative to it)
 * @param {{ id: string, title: string, status: string, dir: string, ms?: number, exit?: number, res?: object }[]} phases
 */
function combinedReport(out, phases) {
	let passed = 0
	let failed = 0
	let skipped = 0
	for (const p of phases) {
		passed += p.res?.passed || 0
		failed += p.res?.failed || 0
		skipped += p.res?.skipped || 0
	}
	const total = passed + failed
	const lines = ['# HighAsCG GUI release suite', '', `**${passed}/${total} steps passed**${failed ? `, **${failed} FAILED**` : ''}${skipped ? `, ${skipped} skipped` : ''} · ${new Date().toISOString()}`, '']
	lines.push('| phase | result | steps | time |', '|---|---|---|---|')
	for (const p of phases) {
		const r = p.res
		const steps = r ? `${r.passed}/${r.passed + r.failed}${r.skipped ? ` (+${r.skipped} skipped)` : ''}` : '—'
		const why = p.status === 'skipped' ? 'skipped' : p.res ? p.status : `FAIL (no results, exit ${p.exit})`
		lines.push(`| ${p.id} — ${p.title} | ${why} | ${steps} | ${p.ms ? `${(p.ms / 1000).toFixed(0)} s` : ''} |`)
	}
	lines.push('')
	for (const p of phases) {
		if (!p.res) continue
		lines.push(`## ${p.id} — ${p.title}`, '', `Server ${p.res.server} · folder \`${path.relative(out, p.dir)}\` (shots/, godot.log, sandbox/server.log)`, '')
		const by = new Map()
		for (const s of p.res.steps || []) {
			if (!by.has(s.scenario)) by.set(s.scenario, [])
			by.get(s.scenario).push(s)
		}
		for (const [name, steps] of by) {
			const bad = steps.filter((s) => !s.ok && !s.skipped).length
			lines.push(`### ${name} — ${steps.filter((s) => s.ok).length}/${steps.length}${bad ? ' ❌' : ''}`, '', '| | step | ms | detail | shot |', '|---|---|---:|---|---|')
			for (const s of steps) {
				const mark = s.skipped ? '⏭' : s.ok ? '✅' : '❌'
				lines.push(`| ${mark} | ${esc(s.step)} | ${s.ms} | ${esc(s.why)} | ${s.shot ? `[png](${path.relative(out, s.shot)})` : ''} |`)
			}
			lines.push('')
		}
		const pr = prints(p.dir)
		if (pr.length) {
			lines.push('### Caspar PRINT frames kept', '')
			for (const f of pr) lines.push(`- [${f}](${path.relative(out, path.join(p.dir, 'shots', f))})`)
			lines.push('')
		}
	}
	return { markdown: lines.join('\n'), passed, failed, skipped, total }
}

module.exports = { combinedReport }
