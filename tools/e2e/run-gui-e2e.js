#!/usr/bin/env node
'use strict'

/**
 * WO-719 — GUI end-to-end run: a sandbox server (tools/e2e/sandbox-server.js) + the real Godot client on a hidden
 * Xvfb display, driven by the scenarios in godot/client/e2e/scenarios/ (clicks, typing, drags — as an operator).
 * Nothing touches the live server, the live projects or the operator's screens.
 *
 *   node tools/e2e/run-gui-e2e.js                         # every scenario
 *   node tools/e2e/run-gui-e2e.js --e2e=01_new_project,02_outputs
 *   node tools/e2e/run-gui-e2e.js --out=/path/report-dir --keep   # keep the sandbox root for inspection
 *   node tools/e2e/run-gui-e2e.js --e2e=06_xr_walk --xr            # WO-741: the client walks the previs (-- --xr)
 *
 * Output: <out>/results.json, <out>/report.md, <out>/shots/NN_<scenario>_<step>.png, <out>/sandbox/server.log,
 * <out>/godot.log. Exit code = failed steps (0 = all green).
 */

const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { startSandbox } = require('./sandbox-server')
const { writeReport } = require('./e2e-report')

const REPO_ROOT = path.resolve(__dirname, '../..')
const arg = (k, d) => {
	const hit = process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
	if (!hit) return d
	return hit.includes('=') ? hit.split('=').slice(1).join('=') : '1'
}

function findGodot() {
	const cands = [process.env.GODOT, path.join(os.homedir(), '.local/opt/godot/godot'), '/opt/godot/godot', '/usr/local/bin/godot', '/usr/bin/godot']
	return cands.find((c) => c && fs.existsSync(c))
}

async function main() {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
	const out = path.resolve(arg('out', path.join(os.tmpdir(), 'highascg-e2e', stamp)))
	const scenarios = arg('e2e', 'all')
	const timeoutS = Number(arg('timeout', '600'))
	const godot = findGodot()
	if (!godot) throw new Error('Godot not found — set GODOT=/path/to/godot')
	fs.mkdirSync(path.join(out, 'shots'), { recursive: true })
	console.log(`[e2e] out ${out}`)

	const sb = await startSandbox({ root: path.join(out, 'sandbox'), log: (s) => console.log(`[e2e] ${s}`) })
	let code
	try {
		const userDir = path.join(out, 'godot-user')
		fs.mkdirSync(userDir, { recursive: true })
		const godotArgs = ['--rendering-driver', 'opengl3', '--path', path.join(REPO_ROOT, 'godot/client'), '--',
			`--server=${sb.url}`, `--e2e=${scenarios}`, `--e2e-out=${path.join(out, 'shots')}`, '--windowed',
			'--video=feed'] // pictures over the sandbox's WebSocket feed: the client never maps the live box's /dev/shm
		if (arg('xr')) godotArgs.push('--xr') // WO-741 (detachable): walk the previs, scenario 06_xr_walk
		const xvfb = ['-a', '-s', '-screen 0 1920x1080x24', godot, ...godotArgs]
		const log = fs.openSync(path.join(out, 'godot.log'), 'w')
		const child = spawn('xvfb-run', xvfb, {
			// user:// (ui.cfg, connection profiles, cluster follow) lands in the run folder, never the operator client's
			env: { ...process.env, XDG_DATA_HOME: userDir, XDG_CONFIG_HOME: userDir, HIGHASCG_SERVER: sb.url },
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: true, // own process group: a kill takes xvfb-run, Xvfb and Godot together (no orphaned Xvfb)
		})
		const killGroup = () => {
			try {
				process.kill(-child.pid, 'SIGKILL')
			} catch {
				/* already gone */
			}
		}
		let hang = null
		const tee = (d) => {
			fs.writeSync(log, d)
			for (const line of d.toString('utf8').split('\n')) {
				if (line.startsWith('[e2e]')) console.log(line)
				// results are written right after DONE; a client still alive 20 s later is stuck in shutdown
				if (line.startsWith('[e2e] DONE') && !hang)
					hang = setTimeout(() => {
						console.log('[e2e] HANG: the client did not quit 20 s after DONE — killed (see WO-719)')
						killGroup()
					}, 20000)
			}
		}
		child.stdout.on('data', tee)
		child.stderr.on('data', tee)
		const killer = setTimeout(() => {
			console.log(`[e2e] TIMEOUT after ${timeoutS}s — killing the client`)
			killGroup()
		}, timeoutS * 1000)
		code = await new Promise((resolve) => child.on('exit', (c) => resolve(c === null ? 99 : c)))
		clearTimeout(killer)
		clearTimeout(hang)
		killGroup() // whatever xvfb-run left behind
		const resultsFile = path.join(out, 'shots', 'results.json')
		if (fs.existsSync(resultsFile)) {
			fs.renameSync(resultsFile, path.join(out, 'results.json'))
			const res = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'))
			writeReport(out, res)
			console.log(`[e2e] ${res.passed} passed, ${res.failed} failed, ${res.skipped} skipped — report ${path.join(out, 'report.md')}`)
		} else {
			console.log(`[e2e] no results.json — the client crashed or never ran (see ${path.join(out, 'godot.log')})`)
			code = code || 98
		}
	} finally {
		await sb.stop()
		if (!arg('keep')) fs.rmSync(path.join(out, 'sandbox', 'media'), { recursive: true, force: true })
	}
	process.exit(code)
}

main().catch((e) => {
	console.error(`[e2e] ${e.stack || e}`)
	process.exit(97)
})
