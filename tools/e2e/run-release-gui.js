#!/usr/bin/env node
'use strict'

/**
 * WO-836 part 3 — the GUI release suite: `npm run test:release-gui`.
 *
 * The real Godot client on hidden Xvfb displays, clicked like an operator, in two phases that each get their own sandbox
 * server (tools/e2e/sandbox-server.js) and their own results:
 *
 *   sim   every scenario in godot/client/e2e/scenarios (01..11, 13 …; not 06 XR, 12 air, 99 driver) against the simulated Caspar — what the GUI stores,
 *         shows and sends; one screenshot per step.
 *   air   scenario 12_air_print against a THROWAWAY real Caspar (tools/e2e/air-fixture.js: own Xvfb, own AMCP port,
 *         2 x 720p, never the box's :5250) — Caspar PRINT of PGM / PRV before and after a stage, TAKE and FTB, verified with
 *         pixel probes that are self-tested on every run (godot/client/e2e/e2e_probe.gd), plus a screenshot probe of the
 *         look card's thumbnail.
 *
 * Nothing touches the live server, the live Caspar, config/ or projects/. One report: <out>/report.md (+ results.json,
 * per-phase folders with shots/, prints, server.log, godot.log).
 *
 *   node tools/e2e/run-release-gui.js [--out=DIR] [--only=sim,air] [--skip=air] [--e2e=01_new_project,…]   (--e2e narrows sim)
 * Exit: 0 all green, 1 anything failed (a phase that did not run counts as failed).
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { combinedReport } = require('./release-report')

const ROOT = path.resolve(__dirname, '../..')
const SCEN_DIR = path.join(ROOT, 'godot/client/e2e/scenarios')
const arg = (k, d) => {
	const hit = process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
	if (!hit) return d
	return hit.includes('=') ? hit.split('=').slice(1).join('=') : '1'
}
const list = (v) => String(v || '').split(',').filter(Boolean)

/** Scenario files that run in the simulated phase: everything but the agent driver (99_), the air scenario and the XR walk (needs a flag + a headset-less previs). */
function simScenarios() {
	return fs
		.readdirSync(SCEN_DIR)
		.filter((f) => f.endsWith('.gd') && !f.startsWith('99_') && !f.startsWith('12_') && !f.startsWith('06_'))
		.map((f) => f.slice(0, -3))
		.sort()
}

const PHASES = [
	{ id: 'sim', title: 'Simulated Caspar (every GUI scenario except 06 XR and 12 air)', args: () => [`--e2e=${arg('e2e', simScenarios().join(','))}`] },
	{ id: 'air', title: 'Throwaway real Caspar: PRINT + screenshot probes (scenario 12)', args: () => ['--air', '--e2e=12_air_print'] },
]

function main() {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
	const out = path.resolve(arg('out', path.join(os.tmpdir(), 'highascg-release-gui', stamp)))
	const only = list(arg('only'))
	const skip = list(arg('skip'))
	const bad = [...only, ...skip].filter((id) => !PHASES.some((p) => p.id === id))
	if (bad.length) {
		console.error(`[release-gui] unknown phase(s) ${bad.join(', ')} (known: ${PHASES.map((p) => p.id).join(', ')})`)
		process.exit(2)
	}
	fs.mkdirSync(out, { recursive: true })
	console.log(`[release-gui] out ${out}`)
	const phases = []
	for (const p of PHASES) {
		const dir = path.join(out, p.id)
		if ((only.length && !only.includes(p.id)) || skip.includes(p.id)) {
			phases.push({ id: p.id, title: p.title, status: 'skipped', dir })
			continue
		}
		console.log(`\n[release-gui] ===== ${p.id}: ${p.title} =====`)
		const t0 = Date.now()
		const r = spawnSync(process.execPath, [path.join(__dirname, 'run-gui-e2e.js'), `--out=${dir}`, ...p.args()], { cwd: ROOT, stdio: 'inherit', env: process.env })
		let res = null
		try {
			res = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'))
		} catch {
			/* the client never wrote results (crash / timeout) — reported as a failed phase below */
		}
		phases.push({ id: p.id, title: p.title, dir, ms: Date.now() - t0, exit: r.status, res, status: res && res.failed === 0 && r.status === 0 ? 'pass' : 'FAIL' })
	}
	const report = combinedReport(out, phases)
	fs.writeFileSync(path.join(out, 'report.md'), report.markdown)
	fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: report.passed, failed: report.failed, skipped: report.skipped, total: report.total, phases: phases.map((p) => ({ id: p.id, status: p.status, exit: p.exit, ms: p.ms, passed: p.res?.passed, failed: p.res?.failed, skipped: p.res?.skipped })) }, null, 2))
	console.log(`\n[release-gui] summary`)
	for (const p of phases) console.log(`  ${p.status.toUpperCase().padEnd(7)} ${p.id.padEnd(4)} ${p.res ? `${p.res.passed}/${p.res.passed + p.res.failed} passed${p.res.skipped ? `, ${p.res.skipped} skipped` : ''}` : p.status === 'skipped' ? '' : 'no results (client crashed or timed out)'}${p.ms ? `, ${(p.ms / 1000).toFixed(0)}s` : ''}`)
	console.log(`[release-gui] ${report.passed}/${report.passed + report.failed} steps passed, ${report.skipped} skipped — report ${path.join(out, 'report.md')}`)
	const failed = phases.some((p) => p.status === 'FAIL')
	console.log(failed ? '[release-gui] NOT READY' : '[release-gui] all run phases green')
	process.exit(failed ? 1 : 0)
}

main()
