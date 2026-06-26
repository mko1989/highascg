const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { ipcMain } = require('electron')
const { getMainWindow } = require('./main-window.js')

/**
 * @param {{
 *   launcherDir: string,
 *   repoRoot: string,
 *   simLauncherScript: string,
 *   resolveSimAppRoot: Function,
 *   formatSimRootHelp: Function,
 *   isServerAppRoot: (dir: string) => boolean,
 * }} ctx
 */
function registerSimIpc(ctx) {
	const { launcherDir, repoRoot, simLauncherScript, resolveSimAppRoot, formatSimRootHelp, isServerAppRoot } = ctx

	/** @type {import('child_process').ChildProcess | null} */
	let simProcess = null

	function cleanupSimulation() {
		if (!simProcess) return
		console.log('[Electron Main] Killing active simulation process...')
		try {
			if (process.platform === 'win32') {
				spawn('taskkill', ['/pid', simProcess.pid, '/f', '/t'])
			} else {
				simProcess.kill('SIGINT')
				setTimeout(() => {
					if (simProcess) simProcess.kill('SIGKILL')
				}, 1000)
			}
		} catch (e) {
			console.error('[Electron Main] Error killing sim process:', e)
		}
		simProcess = null
	}

	ipcMain.on('start-sim', (event, { port, offlineMode }) => {
		const mainWindow = getMainWindow()
		if (simProcess) {
			event.reply('sim-log', '[Launcher] Simulation is already running!\n')
			return
		}

		event.reply('sim-log', '[Launcher] Preparing to launch simulation...\n')

		if (!fs.existsSync(simLauncherScript)) {
			event.reply('sim-log', `[Launcher] Missing simulation helper: ${simLauncherScript}\n`)
			event.reply('sim-status', { running: false, error: 'missing launcher script' })
			return
		}

		const resolved = resolveSimAppRoot({
			launcherDir,
			repoRoot,
			allowExfatStick: false,
		})
		if (!resolved) {
			event.reply('sim-log', `[Launcher] ${formatSimRootHelp({ repoRoot, launcherDir })}\n`)
			event.reply('sim-status', { running: false, error: 'no server tree' })
			return
		}

		event.reply('sim-log', `[Launcher] Server app root (${resolved.source}): ${resolved.appRoot}\n`)
		event.reply('sim-log', `[Launcher] Helper: ${simLauncherScript}\n`)

		const env = {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			HIGHASCG_LAUNCH_NO_BROWSER: '1',
			HIGHASCG_OFFLINE_MODE: offlineMode ? '1' : '0',
			HTTP_PORT: String(port),
			HIGHASCG_LAUNCHER_DIR: launcherDir,
			HIGHASCG_SIM_APP_ROOT: resolved.appRoot,
		}

		try {
			simProcess = spawn(process.execPath, [simLauncherScript], {
				cwd: resolved.appRoot,
				env,
			})

			simProcess.stdout.on('data', (data) => {
				if (mainWindow) mainWindow.webContents.send('sim-log', data.toString())
			})
			simProcess.stderr.on('data', (data) => {
				if (mainWindow) mainWindow.webContents.send('sim-log', data.toString())
			})
			simProcess.on('error', (err) => {
				if (mainWindow) {
					mainWindow.webContents.send('sim-log', `[Launcher Error] Spawn failed: ${err.message}\n`)
					mainWindow.webContents.send('sim-status', { running: false, error: err.message })
				}
				simProcess = null
			})
			simProcess.on('exit', (code, signal) => {
				if (mainWindow) {
					mainWindow.webContents.send(
						'sim-log',
						`[Launcher] Simulation process exited with code ${code} ${signal ? `(signal: ${signal})` : ''}\n`,
					)
					mainWindow.webContents.send('sim-status', { running: false, code })
				}
				simProcess = null
			})

			event.reply('sim-status', { running: true })
		} catch (err) {
			event.reply('sim-log', `[Launcher Error] Exception: ${err.message}\n`)
			event.reply('sim-status', { running: false, error: err.message })
			simProcess = null
		}
	})

	ipcMain.on('stop-sim', (event) => {
		cleanupSimulation()
		event.reply('sim-status', { running: false })
		event.reply('sim-log', '[Launcher] Simulation stopped by user.\n')
	})

	ipcMain.handle('check-sim-runtime', async () => {
		const resolved = resolveSimAppRoot({
			launcherDir,
			repoRoot,
			allowExfatStick: false,
		})
		if (!resolved) {
			return { ready: false, help: formatSimRootHelp({ repoRoot, launcherDir }) }
		}
		const nm = path.join(resolved.appRoot, 'node_modules')
		return {
			ready: true,
			appRoot: resolved.appRoot,
			source: resolved.source,
			hasNodeModules: fs.existsSync(nm),
		}
	})

	return { cleanupSimulation }
}

module.exports = { registerSimIpc }
