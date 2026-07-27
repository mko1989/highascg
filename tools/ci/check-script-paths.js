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

// Patterns to search for script references
const PATTERNS = [
	// Shell: bash path/to/script.sh
	/bash\s+["']?([^"'\s]+\.sh)["']?/g,
	// Node: path.join(..., 'tools/runtime/...'), path.join(__dirname, '../../tools/...'), etc.
	/(?:path\.join|__dirname)\s*\(\s*['"][^'"]*['"],\s*['"]([^'"]+\.(?:sh|py|js))["']/g,
	// systemd ExecStart paths
	/ExecStart=\s*([^\s]+\.sh)/g,
	// Direct paths like tools/runtime/xxx.sh or scripts/setup/xxx.sh
	/(?:tools|scripts|work)\/[a-zA-Z0-9_\/-]+\.(?:sh|py|js)/g,
]

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
				output
					.split(REPO_ROOT + '/')
					.join('')
					.match(/(?<![A-Za-z0-9_\/-])(?:tools|scripts|work)\/[a-zA-Z0-9_\/-]+\.(?:sh|py|js)/g) || []
			scripts.forEach((s) => {
				if (!refs.has(s)) refs.set(s, [])
				refs.get(s).push('src/')
			})
		} catch (e) {
			// grep might return non-zero if no matches
		}
	}

	// Search in run.sh
	const runsh = path.join(REPO_ROOT, 'run.sh')
	if (fs.existsSync(runsh)) {
		try {
			const content = fs
				.readFileSync(runsh, 'utf8')
				.split(REPO_ROOT + '/')
				.join('')
			const scripts = content.match(/(?<![A-Za-z0-9_\/-])(?:tools|scripts|work)\/[a-zA-Z0-9_\/-]+\.(?:sh|py|js)/g) || []
			scripts.forEach((s) => {
				if (!refs.has(s)) refs.set(s, [])
				refs.get(s).push('run.sh')
			})
		} catch (e) {}
	}

	// Search in package.json
	const pkgjson = path.join(REPO_ROOT, 'package.json')
	if (fs.existsSync(pkgjson)) {
		try {
			const content = fs
				.readFileSync(pkgjson, 'utf8')
				.split(REPO_ROOT + '/')
				.join('')
			const scripts = content.match(/(?<![A-Za-z0-9_\/-])(?:tools|scripts|work)\/[a-zA-Z0-9_\/-]+\.(?:sh|py|js)/g) || []
			scripts.forEach((s) => {
				if (!refs.has(s)) refs.set(s, [])
				refs.get(s).push('package.json')
			})
		} catch (e) {}
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
					.match(/(?<![A-Za-z0-9_\/-])(?:tools|scripts|work|bin)\/[a-zA-Z0-9_\/-]+\.(?:sh|py|js)/g) || []
			scripts.forEach((s) => {
				if (!refs.has(s)) refs.set(s, [])
				refs.get(s).push('scripts/systemd/')
			})
		} catch (e) {}
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
					.match(/(?<![A-Za-z0-9_\/-])(?:tools|scripts|work|bin)\/[a-zA-Z0-9_\/-]+\.(?:sh|py|js)/g) || []
			scripts.forEach((s) => {
				if (!refs.has(s)) refs.set(s, [])
				refs.get(s).push('scripts/exfat/')
			})
		} catch (e) {}
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

main()
