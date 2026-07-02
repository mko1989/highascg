#!/usr/bin/env node
'use strict'

/**
 * npm audit wrapper for CI — allows documented exceptions (WO-105).
 * Fails on high/critical except optional xlsx (no upstream fix; roster import only).
 */
const { execSync } = require('child_process')

const ALLOWED_OPTIONAL = new Set(['xlsx'])

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
		const top = name.split('>').pop().trim()
		const isOptionalOnly =
			ALLOWED_OPTIONAL.has(top) &&
			info.via &&
			Array.isArray(info.via) &&
			info.via.every((v) => typeof v === 'string' || ALLOWED_OPTIONAL.has(v.name))
		if (isOptionalOnly && ALLOWED_OPTIONAL.has(top)) {
			console.warn(`[npm-audit-ci] allowed optional advisory: ${name} (${sev})`)
			continue
		}
		if (ALLOWED_OPTIONAL.has(top) && info.isDirect === false) {
			// xlsx only appears as optional root optionalDependency
			const chain = JSON.stringify(info)
			if (chain.includes('xlsx')) {
				console.warn(`[npm-audit-ci] allowed optional xlsx chain: ${name}`)
				continue
			}
		}
		blocking.push(`${name} (${sev})`)
	}

	if (blocking.length) {
		console.error('[npm-audit-ci] blocking vulnerabilities:\n' + blocking.map((b) => `  - ${b}`).join('\n'))
		process.exit(1)
	}
	console.log('[npm-audit-ci] OK (no blocking high/critical advisories)')
}

main()
