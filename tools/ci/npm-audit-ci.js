#!/usr/bin/env node
'use strict'

/**
 * npm audit wrapper for CI — fails on high/critical production advisories (WO-105).
 */
const { execSync } = require('child_process')

function main() {
	let payload
	try {
		const out = execSync('npm audit --omit=dev --json', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
		payload = JSON.parse(out)
	} catch (e) {
		payload = JSON.parse(e.stdout || '{}')
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
