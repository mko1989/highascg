'use strict'

/**
 * WO-730 — run the post-update sweep (tools/sweep/run-sweep.js) once after each update, by itself.
 *
 * "An update" = the code id changed since the last sweep: BUILD_STAMP (drop / web-UI updates write it) plus the git
 * commit when this is a checkout. Two minutes after the server starts on new code it spawns the sweep (read only,
 * no --peers / --tests), logs one summary line, and the report stays in ~/.local/state/highascg/sweep/ (outside the
 * repo: Syncthing would carry it to the peers) — GET /api/system/update/sweep returns the last one.
 * Off in a sandbox and with HIGHASCG_SWEEP_AFTER_UPDATE=0.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { REPO_ROOT } = require('../repo-paths')

const DELAY_MS = 120000

function sweepStateDir() {
	return process.env.HIGHASCG_SWEEP_DIR || path.join(os.homedir(), '.local/state/highascg/sweep')
}

const read = (f) => {
	try {
		return fs.readFileSync(f, 'utf8').trim()
	} catch {
		return ''
	}
}

/** The commit HEAD points at, read from .git without running git ('' when not a checkout). */
function gitHead(repo = REPO_ROOT) {
	const head = read(path.join(repo, '.git/HEAD'))
	if (!head.startsWith('ref: ')) return head.slice(0, 12)
	const ref = head.slice(5)
	const loose = read(path.join(repo, '.git', ref))
	if (loose) return loose.slice(0, 12)
	const packed = read(path.join(repo, '.git/packed-refs'))
		.split('\n')
		.find((l) => l.endsWith(` ${ref}`))
	return packed ? packed.slice(0, 12) : ''
}

/** "<build stamp>[+<commit>]" — what an update changes. */
function codeId(repo = REPO_ROOT) {
	const stamp = read(path.join(repo, 'BUILD_STAMP')) || read(path.join(repo, '.highascg-build-stamp')) || 'unstamped'
	const head = gitHead(repo)
	return head ? `${stamp}+${head}` : stamp
}

function lastReport(dir = sweepStateDir()) {
	try {
		return JSON.parse(fs.readFileSync(path.join(dir, 'last.json'), 'utf8'))
	} catch {
		return null
	}
}

/** @param {{ log?: Function, config?: object }} ctx */
function startSweepAfterUpdate(ctx, { delayMs = DELAY_MS } = {}) {
	const log = (lvl, m) => ctx?.log?.(lvl, `[sweep] ${m}`)
	if (require('../bootstrap/sandbox').isSandbox() || process.env.HIGHASCG_SWEEP_AFTER_UPDATE === '0') return null
	const id = codeId()
	if (lastReport()?.codeId === id) return null
	const port = ctx?.config?.server?.httpPort || 4200
	const timer = setTimeout(() => {
		const dir = sweepStateDir()
		fs.mkdirSync(dir, { recursive: true })
		const out = fs.openSync(path.join(dir, 'auto.log'), 'w')
		const child = spawn(
			process.execPath,
			[path.join(REPO_ROOT, 'tools/sweep/run-sweep.js'), '--auto', `--url=http://127.0.0.1:${port}`],
			{ cwd: REPO_ROOT, stdio: ['ignore', out, out] }
		)
		child.on('exit', (code) => {
			fs.closeSync(out)
			const t = lastReport()?.totals
			if (t)
				log(
					t.fail ? 'warn' : 'info',
					`after update ${id}: ${t.pass} pass, ${t.warn} warn, ${t.fail} fail — GET /api/system/update/sweep`
				)
			else log('warn', `after update ${id}: the sweep exited ${code} without a report (${path.join(dir, 'auto.log')})`)
		})
	}, delayMs)
	timer.unref?.()
	log('info', `new code ${id}: sweep in ${Math.round(delayMs / 1000)} s`)
	return timer
}

module.exports = { codeId, gitHead, sweepStateDir, lastReport, startSweepAfterUpdate }
