#!/usr/bin/env node
'use strict'

/**
 * npm audit wrapper for CI — fails on high/critical production advisories (WO-105).
 *
 * WO-836: an audit that could not RUN is not a clean audit. A registry/network error makes `npm audit --json` print
 * `{ message, error }` with no `vulnerabilities`; the old wrapper read that as "no vulnerabilities" and passed. Now the
 * report must carry `metadata.vulnerabilities` (what a real answer always has), otherwise the wrapper exits 2 — distinct
 * from 1 (blocking advisories), and still a failing status for the CI step. Working offline on purpose:
 * `NPM_AUDIT_ALLOW_OFFLINE=1` (or `--allow-offline`) downgrades "could not run" to a warning and exit 0.
 */
const { execSync } = require('child_process')

const ALLOW_OFFLINE = process.env.NPM_AUDIT_ALLOW_OFFLINE === '1' || process.argv.includes('--allow-offline')

/** @returns {{ payload: any, runError: string }} */
function runAudit() {
	let out = ''
	try {
		out = execSync('npm audit --omit=dev --json', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
	} catch (e) {
		// npm exits non-zero both for "advisories found" (JSON on stdout) and for "audit failed" (JSON with `error`)
		out = e.stdout || ''
		if (!out)
			return {
				payload: null,
				runError: String(e.stderr || e.message || e)
					.trim()
					.split('\n')
					.pop(),
			}
	}
	try {
		return { payload: JSON.parse(out), runError: '' }
	} catch (e) {
		return { payload: null, runError: `unparseable npm audit output (${e.message})` }
	}
}

function main() {
	const { payload, runError } = runAudit()
	const answered = payload && !payload.error && payload.metadata && payload.metadata.vulnerabilities
	if (!answered) {
		const why = runError || payload?.message || payload?.error?.summary || 'npm audit returned no vulnerability report'
		if (ALLOW_OFFLINE) {
			console.warn(`[npm-audit-ci] WARNING: audit could not run (${why}) — NOT verified (offline allowed)`)
			return
		}
		console.error(
			`[npm-audit-ci] audit could not run: ${why}\n  (a skipped audit is not a pass; set NPM_AUDIT_ALLOW_OFFLINE=1 to accept that locally)`
		)
		process.exit(2)
	}

	const vulns = payload.vulnerabilities || {}
	/** @type {string[]} */
	const blocking = []

	for (const [name, info] of Object.entries(vulns)) {
		const sev = info.severity || ''
		if (sev !== 'high' && sev !== 'critical') continue
		blocking.push(`${name} (${sev})`)
	}

	if (blocking.length) {
		console.error('[npm-audit-ci] blocking vulnerabilities:\n' + blocking.map((b) => `  - ${b}`).join('\n'))
		process.exit(1)
	}
	console.log('[npm-audit-ci] OK (no blocking high/critical advisories)')
}

main()
