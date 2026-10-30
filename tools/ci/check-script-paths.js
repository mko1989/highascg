#!/usr/bin/env node
/**
 * Verify that all script paths referenced from src/, run.sh, package.json,
 * and systemd units actually exist on disk.
 *
 * Exit 1 if any referenced paths are missing.
 * Usage: node tools/ci/check-script-paths.js
 *
 * This guard prevents broken references when scripts are moved or renamed.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const REPO_ROOT = path.join(__dirname, '../..')

/**
 * WO-836: reduce a source chunk to the text that can actually execute. src/ prose comments cite scripts that were
 * deleted long ago (tools/runtime/operator-shape-overlay.py, gone since WO-646) — a comment is not a dangling reference.
 * Whole-line comments go, and a trailing `// ...` tail goes (only when preceded by whitespace, so `http://` survives).
 * @param {string} text
 */
function stripComments(text) {
	return text
		.split('\n')
		.filter((l) => !/^\s*(?:\/\/|\*|\/\*|#)/.test(l))
		.map((l) => l.replace(/\s\/\/.*$/, ''))
		.join('\n')
}

function findScriptReferences() {
	const refs = new Map()

	// Search in src/
	if (fs.existsSync(path.join(REPO_ROOT, 'src'))) {
		try {
			const output = execSync(
				`grep -rh "tools/runtime\\|scripts/\\|work/" src/ --include="*.js" --include="*.sh" 2>/dev/null`,
				{ cwd: REPO_ROOT, encoding: 'utf8' }
			)
			const scripts =
				stripComments(output)
					.split(REPO_ROOT + '/')
					.join('')
					.match(/(?<![A-Za-z0-9_/-])(?:tools|scripts|work)\/[a-zA-Z0-9_/-]+\.(?:sh|py|js)/g) || []
			scripts.forEach((s) => {
				if (!refs.has(s)) refs.set(s, [])
				refs.get(s).push('src/')
			})
		} catch {
			// grep might return non-zero if no matches
		}
	}

	// Search in run.sh
	const runsh = path.join(REPO_ROOT, 'run.sh')
	if (fs.existsSync(runsh)) {
		try {
			const content = stripComments(fs.readFileSync(runsh, 'utf8'))
				.split(REPO_ROOT + '/')
				.join('')
			const scripts = content.match(/(?<![A-Za-z0-9_/-])(?:tools|scripts|work)\/[a-zA-Z0-9_/-]+\.(?:sh|py|js)/g) || []
			scripts.forEach((s) => {
				if (!refs.has(s)) refs.set(s, [])
				refs.get(s).push('run.sh')
			})
		} catch {}
	}

	// Search in package.json
	const pkgjson = path.join(REPO_ROOT, 'package.json')
	if (fs.existsSync(pkgjson)) {
		try {
			const content = fs
				.readFileSync(pkgjson, 'utf8')
				.split(REPO_ROOT + '/')
				.join('')
			const scripts = content.match(/(?<![A-Za-z0-9_/-])(?:tools|scripts|work)\/[a-zA-Z0-9_/-]+\.(?:sh|py|js)/g) || []
			scripts.forEach((s) => {
				if (!refs.has(s)) refs.set(s, [])
				refs.get(s).push('package.json')
			})
		} catch {}
	}

	// Search in systemd units
	const systemdDir = path.join(REPO_ROOT, 'scripts/systemd')
	if (fs.existsSync(systemdDir)) {
		try {
			const output = execSync(`grep -rh "ExecStart\\|ExecStop" scripts/systemd/ 2>/dev/null`, {
				cwd: REPO_ROOT,
				encoding: 'utf8',
			})
			const scripts =
				output
					.split(REPO_ROOT + '/')
					.join('')
					.match(/(?<![A-Za-z0-9_/-])(?:tools|scripts|work|bin)\/[a-zA-Z0-9_/-]+\.(?:sh|py|js)/g) || []
			scripts.forEach((s) => {
				if (!refs.has(s)) refs.set(s, [])
				refs.get(s).push('scripts/systemd/')
			})
		} catch {}
	}

	// Search in scripts/exfat for ExecStart writers
	const exfatDir = path.join(REPO_ROOT, 'scripts/exfat')
	if (fs.existsSync(exfatDir)) {
		try {
			const output = execSync(`grep -rh "ExecStart\\|ExecStop" scripts/exfat/ 2>/dev/null`, {
				cwd: REPO_ROOT,
				encoding: 'utf8',
			})
			const scripts =
				output
					.split(REPO_ROOT + '/')
					.join('')
					.match(/(?<![A-Za-z0-9_/-])(?:tools|scripts|work|bin)\/[a-zA-Z0-9_/-]+\.(?:sh|py|js)/g) || []
			scripts.forEach((s) => {
				if (!refs.has(s)) refs.set(s, [])
				refs.get(s).push('scripts/exfat/')
			})
		} catch {}
	}

	return refs
}

function main() {
	const refs = findScriptReferences()
	let missing = []

	console.log(`Checking ${refs.size} script references...\n`)

	for (const [script, sources] of refs) {
		const fullPath = path.join(REPO_ROOT, script)
		if (!fs.existsSync(fullPath)) {
			missing.push({ script, fullPath, sources })
		}
	}

	if (missing.length === 0) {
		console.log('✓ All script paths exist on disk\n')
		process.exit(0)
	}

	console.error(`✗ Missing ${missing.length} referenced script path(s):\n`)
	missing.forEach(({ script, fullPath, sources }) => {
		console.error(`  ${script}`)
		console.error(`    (searched in: ${sources.join(', ')})`)
		console.error(`    (looked for: ${fullPath})\n`)
	})

	process.exit(1)
}

if (require.main === module) main()

module.exports = { findScriptReferences, stripComments }
