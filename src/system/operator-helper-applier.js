'use strict'

/**
 * WO-317 — applier: EXECUTE the raise/park plans (operator-helper-window-plan.js) against the live
 * X session, and resolve the real window ids those plans need.
 *
 * Split from the planner on purpose: the planner is pure (offline-tested), the applier is the thin
 * side-effecting layer. Its own core — `executePlan` — is still offline-testable via an injected
 * execFile, because the ONE thing that must not regress is honoring `optional`: a best-effort step
 * (a raise that Openbox may clamp, a windowmove) failing must not abort the rest of the plan, while
 * a REQUIRED step failing (the python promoter/parker, the kiosk refocus) must be reported so the
 * caller can log an incomplete restack rather than pretend it worked.
 *
 * Window-id resolution reuses x-display-session-runtime's xdotool helpers (same env, same class
 * table) so the applier and the existing WO-283 path agree on what "the helper window" is.
 */

const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const { execFile } = require('child_process')
const execFileAsync = promisify(execFile)

const REPO_ROOT = path.join(__dirname, '../..')
const { PARK_SCRIPT } = require('./operator-helper-window-plan')

/** Mirror of resolveWindowAbovePromoter for the BELOW (park) script. @returns {string|null} */
function resolveWindowBelowParker() {
	for (const p of [
		path.join(REPO_ROOT, 'tools/runtime', PARK_SCRIPT),
		`/usr/local/lib/highascg/${PARK_SCRIPT}`,
		`/usr/local/bin/${PARK_SCRIPT}`,
	]) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * Execute an ordered plan of steps ({ bin, args, optional?, note? }).
 *
 * - A REQUIRED step that throws stops the plan and is reported in `failed` — the remaining steps do
 *   not run, because they depend on it (you cannot focus-last a window you failed to promote).
 * - An OPTIONAL step that throws is recorded in `skipped` and the plan continues.
 *
 * @param {import('./operator-helper-window-plan').PlanStep[]} steps
 * @param {{
 *   execFileImpl?: (bin: string, args: string[], opts: object) => Promise<any>,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   log?: (level: string, msg: string) => void,
 * }} [opts]
 * @returns {Promise<{ ok: boolean, ran: string[], skipped: string[], failed: string|null }>}
 */
async function executePlan(steps, opts = {}) {
	const exec = opts.execFileImpl || execFileAsync
	const env = opts.env
	const timeout = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 5000
	const log = opts.log || (() => {})
	const ran = []
	const skipped = []
	for (const step of steps || []) {
		const label = `${step.bin} ${step.args.join(' ')}`
		try {
			await exec(step.bin, step.args, { env, timeout })
			ran.push(label)
		} catch (e) {
			const msg = e?.message || String(e)
			if (step.optional) {
				skipped.push(label)
				log('info', `[Helper applier] optional step failed (continuing): ${label} — ${msg}`)
			} else {
				log('warn', `[Helper applier] REQUIRED step failed, aborting plan: ${label} — ${msg}`)
				return { ok: false, ran, skipped, failed: label }
			}
		}
	}
	return { ok: true, ran, skipped, failed: null }
}

/**
 * Resolve the kiosk window id (the marker-titled operator GUI window) via xdotool.
 * @param {{ marker: string, env?: NodeJS.ProcessEnv, execFileImpl?: Function, timeoutMs?: number }} opts
 * @returns {Promise<string|null>}
 */
async function resolveKioskWid(opts) {
	const exec = opts.execFileImpl || execFileAsync
	const timeout = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 3000
	try {
		const { stdout } = await exec('xdotool', ['search', '--name', opts.marker], { env: opts.env, timeout })
		const ids = String(stdout || '').trim().split(/\s+/).filter(Boolean)
		return ids[0] || null
	} catch {
		return null
	}
}

/**
 * Resolve the Caspar screen-consumer window id — the window the operator's video holes reveal, that
 * a parked helper must be lowered BENEATH. Best-effort: when it cannot be found the park still works
 * (lower to the bottom + kiosk refocus), just without a precise sibling reference.
 * @param {{ classes?: string[], env?: NodeJS.ProcessEnv, execFileImpl?: Function, timeoutMs?: number }} [opts]
 * @returns {Promise<string|null>}
 */
async function resolveConsumerWid(opts = {}) {
	const exec = opts.execFileImpl || execFileAsync
	const timeout = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 3000
	// CasparCG's SDL/screen-consumer window. Class/title varies by build; try the known candidates.
	const classes = opts.classes || ['CasparCG', 'casparcg']
	for (const cls of classes) {
		for (const flag of ['--class', '--classname']) {
			try {
				const { stdout } = await exec('xdotool', ['search', '--onlyvisible', flag, cls], { env: opts.env, timeout })
				const ids = String(stdout || '').trim().split(/\s+/).filter(Boolean)
				if (ids.length) return ids[0]
			} catch {
				/* try next */
			}
		}
	}
	return null
}

module.exports = {
	resolveWindowBelowParker,
	executePlan,
	resolveKioskWid,
	resolveConsumerWid,
}
