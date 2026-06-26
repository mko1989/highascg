#!/usr/bin/env node
/**
 * Cross-platform helper for GitHub/release operators (Mac / Windows):
 *   · prepare-stick — ISO -> USB + HIGHASCGEXF + optional tarball or folder -> sim/highascg
 *   · sim — delegates to tools/portable-desktop/launch-sim-from-exfat.cjs (same as portable:sim)
 *
 * Lives at tools/operator-desktop/ (included in GitHub tarball releases).
 *
 * @see tools/operator-desktop/README.md
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function repoRoot() {
	return path.resolve(__dirname, '../..')
}

function usage(rc = 0) {
	const msg = `
HighAsCG operator (Mac / Windows)

Stick (elevated — sudo on macOS, Administrator PowerShell on Windows):

  node tools/operator-desktop/highascg-operator.js prepare-stick \\
    --iso PATH.iso [--tar-gz PATH.tar.gz | --app-dir UNPACKED_REPO] [--skip-exfat] [--dry-run]

Simulation:

  node tools/operator-desktop/highascg-operator.js sim [-- ...launcher flags]

npm:

  npm run operator-kit -- prepare-stick --iso ... [--tar-gz ...]
  npm run operator-kit -- sim

Overrides: HIGHASCG_MAC_SH, HIGHASCG_PS1_PATH
`
	process.stderr.write(`${msg.trim()}\n`)
	process.exit(rc)
}

function die(msg) {
	console.error('[operator]', msg)
	process.exit(2)
}

/** @returns {{iso?: string, tarGz?: string, appDir?: string, skipExfat?: boolean, dryRun?: boolean}} */
function parsePrepareStickArgv(argv) {
	const out = {}
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i]
		if (t === '--') break
		switch (t) {
			case '--skip-exfat':
				out.skipExfat = true
				break
			case '--dry-run':
				out.dryRun = true
				break
			case '--iso':
				i++
				if (i >= argv.length) die('--iso needs a path')
				out.iso = path.resolve(argv[i])
				break
			case '--tar-gz':
				i++
				if (i >= argv.length) die('--tar-gz needs a path')
				out.tarGz = path.resolve(argv[i])
				break
			case '--app-dir':
				i++
				if (i >= argv.length) die('--app-dir needs a path')
				out.appDir = path.resolve(argv[i])
				break
			default:
				if (t.startsWith('--')) die(`Unknown option: ${t}`)
				die(`Unexpected argument: ${t}`)
		}
	}
	return out
}

function validatePrepare(parsed) {
	if (!parsed.iso) die('--iso is required')
	if (!fs.existsSync(parsed.iso)) die(`ISO not found: ${parsed.iso}`)
	if (parsed.tarGz && parsed.appDir) die('Use only one of --tar-gz or --app-dir')
	if (parsed.tarGz && !fs.existsSync(parsed.tarGz)) die(`Tarball not found: ${parsed.tarGz}`)
	if (parsed.appDir) {
		if (!fs.statSync(parsed.appDir).isDirectory()) die(`--app-dir is not a directory: ${parsed.appDir}`)
		if (!fs.existsSync(path.join(parsed.appDir, 'package.json')))
			die(`--app-dir has no package.json: ${parsed.appDir}`)
	}
}

function spawnPrepareStick(parsed) {
	const root = repoRoot()

	if (process.platform === 'darwin') {
		const sh = process.env.HIGHASCG_MAC_SH || path.join(root, 'client/tools/live-usb/macos/make-highascg-stick.sh')
		const args = []
		if (parsed.skipExfat) args.push('--skip-exfat')
		if (parsed.dryRun) args.push('--dry-run')
		if (parsed.tarGz) args.push('--tar-gz', parsed.tarGz)
		if (parsed.appDir) args.push('--app-dir', parsed.appDir)
		args.push(parsed.iso)
		console.error(`[operator] Running with sudo:\n  sudo bash ${[sh, ...args].join(' ')}\n`)
		const r = spawnSync('sudo', ['bash', sh, ...args], { stdio: 'inherit' })
		process.exit(typeof r.status === 'number' ? r.status : 1)
	}

	if (process.platform === 'win32') {
		const ps1 =
			process.env.HIGHASCG_PS1_PATH || path.join(root, 'client/tools/live-usb/windows/make-highascg-stick.ps1')
		const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-IsoPath', parsed.iso]
		if (parsed.skipExfat) psArgs.push('-SkipExfat')
		if (parsed.dryRun) psArgs.push('-DryRun')
		if (parsed.tarGz) {
			psArgs.push('-TarGzPath')
			psArgs.push(parsed.tarGz)
		}
		if (parsed.appDir) {
			psArgs.push('-AppSourceDirectory')
			psArgs.push(parsed.appDir)
		}
		const pw =
			process.env.SystemRoot
				? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
				: 'powershell.exe'
		console.error(`[operator] Running elevated PowerShell script:\n  ${ps1}\n`)
		const r = spawnSync(pw, psArgs, { stdio: 'inherit' })
		process.exit(typeof r.status === 'number' ? r.status : 1)
	}

	die('prepare-stick is for macOS and Windows. On Linux use client/tools/stick-tools/ or tools/eggs/live-usb/.')
}

function main() {
	const argv = process.argv.slice(2)
	if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') usage(0)

	const cmd = argv[0].toLowerCase()

	if (cmd === 'prepare-stick' || cmd === 'stick') {
		const parsed = parsePrepareStickArgv(argv.slice(1))
		validatePrepare(parsed)
		spawnPrepareStick(parsed)
		return
	}

	if (cmd === 'sim' || cmd === 'simulate' || cmd === 'portable') {
		const launcher = path.join(repoRoot(), 'client/tools/portable-desktop/launch-sim-from-exfat.cjs')
		const r = spawnSync(process.execPath, [launcher, ...argv.slice(1)], { stdio: 'inherit' })
		process.exit(typeof r.status === 'number' ? r.status : 1)
	}

	die(`Unknown command: ${argv[0]}. Use --help`)
}

main()
