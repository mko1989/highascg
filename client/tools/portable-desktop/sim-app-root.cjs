'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const DEFAULT_LABEL = process.env.HIGHASCG_EXFAT_LABEL || 'HIGHASCGEXF'
const SIM_SERVER_DIRNAME = 'sim-server'

function isServerAppRoot(dir) {
	if (!dir) return false
	const root = path.resolve(dir)
	if (!fs.existsSync(path.join(root, 'index.js'))) return false
	const pkgPath = path.join(root, 'package.json')
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
			const name = String(pkg.name || '')
			if (name === 'highascg-client' || name === 'highascg-web') return false
		} catch (_) {
			/* ignore */
		}
	}
	return true
}

function bundledSimServerDir(launcherDir) {
	return launcherDir ? path.join(path.resolve(launcherDir), SIM_SERVER_DIRNAME) : null
}

function getWindowsDriveForLabel(label) {
	const esc = String(label).replace(/'/g, "''")
	const ps = `Get-Volume | Where-Object FileSystemLabel -eq '${esc}' | Select-Object -First 1 | ForEach-Object { $_.DriveLetter }`
	try {
		const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
			encoding: 'utf8',
			windowsHide: true,
			timeout: 15000,
		}).trim()
		const letter = out.split(/\s+/).filter(Boolean)[0]
		if (letter && /^[A-Za-z]$/.test(letter)) return `${letter.toUpperCase()}:`
	} catch (_) {
		/* ignore */
	}
	return null
}

function resolveExfatVolumeRoot() {
	const override = process.env.HIGHASCG_EXFAT_ROOT
	if (override) {
		const r = path.resolve(override.replace(/[/\\]+$/, ''))
		if (fs.existsSync(r) && fs.statSync(r).isDirectory()) return r
	}
	const label = DEFAULT_LABEL
	const platform = process.platform
	if (platform === 'darwin') {
		const vol = path.join('/Volumes', label)
		if (fs.existsSync(vol) && fs.statSync(vol).isDirectory()) return vol
		try {
			for (const name of fs.readdirSync('/Volumes')) {
				if (name === label || name.startsWith(`${label} `)) {
					const candidate = path.join('/Volumes', name)
					if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
				}
			}
		} catch (_) {
			/* ignore */
		}
	}
	if (platform === 'win32') {
		const drive = getWindowsDriveForLabel(label)
		if (drive && fs.existsSync(drive)) return drive
	}
	if (platform === 'linux') {
		const u = os.userInfo().username
		const tries = [
			path.join('/media', u, label),
			path.join('/run/media', u, label),
			path.join('/mnt', label),
		]
		for (const t of tries) {
			if (fs.existsSync(t) && fs.statSync(t).isDirectory()) return t
		}
		try {
			const out = execFileSync('findmnt', ['-n', '-o', 'TARGET', `-L${label}`], {
				encoding: 'utf8',
				timeout: 5000,
			}).trim()
			if (out && fs.existsSync(out)) return out
		} catch (_) {
			/* ignore */
		}
	}
	return null
}

function simPathOnVolume(volRoot) {
	return path.join(volRoot, 'sim', 'highascg')
}

/**
 * Resolve the Node **server** tree used for local simulation (--no-caspar).
 * Standalone client / Electron launcher: bundled `sim-server/` next to the app, then dev `not-needed/`.
 * USB exFAT is opt-in only (`allowExfatStick` or `HIGHASCG_SIM_ALLOW_EXFAT=1`).
 *
 * @param {{
 *   argv?: string[],
 *   repoRoot?: string,
 *   launcherDir?: string,
 *   allowExfatStick?: boolean,
 * }} [opts]
 * @returns {{ appRoot: string, source: string } | null}
 */
function resolveSimAppRoot(opts = {}) {
	const argv = opts.argv || process.argv
	const repoRoot = opts.repoRoot
		? path.resolve(opts.repoRoot)
		: path.resolve(__dirname, '../../..')
	const launcherDir = opts.launcherDir
		? path.resolve(opts.launcherDir)
		: process.env.HIGHASCG_LAUNCHER_DIR
			? path.resolve(process.env.HIGHASCG_LAUNCHER_DIR)
			: null

	const allowExfat =
		opts.allowExfatStick === true ||
		process.env.HIGHASCG_SIM_ALLOW_EXFAT === '1' ||
		process.env.HIGHASCG_SIM_ALLOW_EXFAT === 'true'

	for (const key of ['HIGHASCG_SIM_APP_ROOT', 'HIGHASCG_EXFAT_APP_ROOT']) {
		const override = process.env[key]
		if (override) {
			const r = path.resolve(override)
			if (isServerAppRoot(r)) return { appRoot: r, source: key }
		}
	}

	const bundled = bundledSimServerDir(launcherDir)
	if (bundled && isServerAppRoot(bundled)) {
		return { appRoot: bundled, source: `${SIM_SERVER_DIRNAME}/ (launcher bundle)` }
	}

	const nn = path.join(repoRoot, 'not-needed')
	if (isServerAppRoot(nn)) {
		return { appRoot: nn, source: 'not-needed/ (dev server tree)' }
	}

	const forceCwd =
		argv.includes('--use-cwd') ||
		process.env.SIM_USE_CWD === '1' ||
		process.env.HIGHASCG_SIM_USE_CWD === '1'
	const cwd = process.cwd()
	if (forceCwd && isServerAppRoot(cwd)) {
		return { appRoot: cwd, source: 'SIM_USE_CWD (--use-cwd)' }
	}

	if (allowExfat) {
		const volFromEnv = process.env.HIGHASCG_EXFAT_ROOT
		if (volFromEnv) {
			const vr = path.resolve(volFromEnv.replace(/[/\\]+$/, ''))
			const sim = simPathOnVolume(vr)
			if (isServerAppRoot(sim)) return { appRoot: sim, source: 'HIGHASCG_EXFAT_ROOT+sim/highascg' }
			if (isServerAppRoot(vr)) return { appRoot: vr, source: 'HIGHASCG_EXFAT_ROOT(root=app)' }
		}
		const vol = resolveExfatVolumeRoot()
		if (vol) {
			const sim = simPathOnVolume(vol)
			if (isServerAppRoot(sim)) return { appRoot: sim, source: `volume ${DEFAULT_LABEL}` }
		}
	}

	return null
}

/**
 * @param {{ repoRoot?: string, launcherDir?: string }} [opts]
 */
function formatSimRootHelp(opts = {}) {
	const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : path.resolve(__dirname, '../../..')
	const launcherDir = opts.launcherDir ? path.resolve(opts.launcherDir) : null
	const bundled = bundledSimServerDir(launcherDir)
	const lines = [
		'Could not find a HighAsCG server tree for simulation (need index.js + node_modules).',
		'',
		'Simulation runs from the standalone client app — not from the USB stick.',
		'',
		`  • Run: npm run launcher:prepare  (copies server into launcher/${SIM_SERVER_DIRNAME}/)`,
		`  • Then once: npm run launcher:sim-install`,
		`  • Start GUI from repo root: npm run launcher  (not from ${SIM_SERVER_DIRNAME}/)`,
		'  • Or set HIGHASCG_SIM_APP_ROOT=/path/to/server/tree',
	]
	if (bundled) {
		lines.push('', `  Expected bundle path: ${bundled}`)
	}
	if (fs.existsSync(path.join(repoRoot, 'not-needed', 'index.js'))) {
		lines.push('', `  Dev checkout: not-needed/ is present — run npm ci there or use launcher:prepare.`)
	}
	return lines.join('\n')
}

module.exports = {
	DEFAULT_LABEL,
	SIM_SERVER_DIRNAME,
	isServerAppRoot,
	bundledSimServerDir,
	resolveExfatVolumeRoot,
	resolveSimAppRoot,
	formatSimRootHelp,
	simPathOnVolume,
}
