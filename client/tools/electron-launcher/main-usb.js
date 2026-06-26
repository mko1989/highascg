const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile } = require('child_process')

/** @param {string} file @param {string[]} args @param {import('child_process').ExecFileOptions} opts */
function execFileAsync(file, args, opts = {}) {
	return new Promise((resolve, reject) => {
		execFile(file, args, opts, (err, stdout, stderr) => {
			if (err) reject(err)
			else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
		})
	})
}

async function checkWindowsVolume(label) {
	const want = String(label).toUpperCase()
	const letters = []
	for (let code = 67; code <= 90; code++) letters.push(`${String.fromCharCode(code)}:`)

	const hits = await Promise.all(
		letters.map(
			(drive) =>
				new Promise((resolve) => {
					execFile(
						'cmd.exe',
						['/c', 'vol', drive],
						{ windowsHide: true, timeout: 400, maxBuffer: 64 * 1024 },
						(err, stdout) => {
							if (err || !stdout) {
								resolve(null)
								return
							}
							if (String(stdout).toUpperCase().includes(want)) {
								resolve(`${drive}\\`)
							} else {
								resolve(null)
							}
						},
					)
				}),
		),
	)
	return hits.find(Boolean) || null
}

function findDarwinVolumeByLabel(label) {
	const volumesDev = (() => {
		try {
			return fs.statSync('/Volumes').dev
		} catch (_) {
			return null
		}
	})()

	const exact = path.join('/Volumes', label)
	if (fs.existsSync(exact) && fs.statSync(exact).isDirectory()) {
		if (volumesDev === null || fs.statSync(exact).dev !== volumesDev) {
			return exact
		}
	}
	try {
		for (const name of fs.readdirSync('/Volumes')) {
			if (name === label || name.startsWith(`${label} `)) {
				const candidate = path.join('/Volumes', name)
				if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
					if (volumesDev === null || fs.statSync(candidate).dev !== volumesDev) {
						return candidate
					}
				}
			}
		}
	} catch (_) {
		/* ignore */
	}
	return null
}

/**
 * @param {{ isServerAppRoot: (dir: string) => boolean, simPathOnVolume: (mount: string) => string }} simHelpers
 */
function createUsbProbe({ isServerAppRoot, simPathOnVolume }) {
	let usbStatusInFlight = null

	async function probeUsbStatus() {
		const label = 'HIGHASCGEXF'
		const platform = process.platform
		let mountedPath = null

		if (platform === 'darwin') {
			mountedPath = findDarwinVolumeByLabel(label)
		} else if (platform === 'win32') {
			mountedPath = await checkWindowsVolume(label)
		} else if (platform === 'linux') {
			const u = os.userInfo().username
			const tries = [
				path.join('/media', u, label),
				path.join('/run/media', u, label),
				path.join('/mnt', label),
			]
			for (const t of tries) {
				if (fs.existsSync(t) && fs.statSync(t).isDirectory()) {
					mountedPath = t
					break
				}
			}
			if (!mountedPath) {
				try {
					const { stdout } = await execFileAsync('findmnt', ['-n', '-o', 'TARGET', `-L${label}`], {
						timeout: 2000,
						windowsHide: true,
					})
					const out = stdout.trim()
					if (out && fs.existsSync(out)) mountedPath = out
				} catch (_) {
					/* ignore */
				}
			}
		}

		if (mountedPath) {
			const simDir = simPathOnVolume(mountedPath)
			const hasPayload = isServerAppRoot(simDir)
			return {
				mounted: true,
				path: mountedPath,
				hasPayload,
				payloadPath: simDir,
			}
		}

		return { mounted: false }
	}

	function checkUsbStatus() {
		if (usbStatusInFlight) return usbStatusInFlight
		usbStatusInFlight = probeUsbStatus().finally(() => {
			usbStatusInFlight = null
		})
		return usbStatusInFlight
	}

	return { checkUsbStatus }
}

module.exports = { createUsbProbe, execFileAsync }
