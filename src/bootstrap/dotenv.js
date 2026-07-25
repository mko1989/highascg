'use strict'

const path = require('path')
const fs = require('fs')

/** Load repo `.env` when vars are unset (deploy / dev convenience; no dependency). */
function loadRepoDotEnv(repoRoot) {
	const envPath = path.join(repoRoot, '.env')
	if (!fs.existsSync(envPath)) return
	for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq <= 0) continue
		const key = trimmed.slice(0, eq).trim()
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] != null) continue
		let val = trimmed.slice(eq + 1).trim()
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1)
		}
		process.env[key] = val
	}
}

module.exports = { loadRepoDotEnv }
