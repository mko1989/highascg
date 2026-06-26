const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { createLauncherStaticServer } = require('./main-static-server.js')
const {
	getEnabledModuleIds,
	setEnabledModuleIds,
	getRegistryModules,
	buildModulesApiPayload,
} = require('./launcher-modules-prefs.js')
const { createWindow } = require('./main-window.js')
const { registerSimIpc } = require('./main-sim.js')
const { registerCgStudioIpc, closeCgStudioWindow, stopCgStudioServer, syncCgStudioModule } = require('./main-cg-studio.js')
const { createUsbProbe } = require('./main-usb.js')

const LAUNCHER_DIR = __dirname

function requireLauncherModule(bundledRel, devRel) {
	const bundled = path.join(LAUNCHER_DIR, bundledRel)
	if (fs.existsSync(bundled)) {
		return require(bundled)
	}
	return require(path.join(LAUNCHER_DIR, devRel))
}

const { WEBUI_PORT } = requireLauncherModule('lib/webui-port.cjs', '../../lib/webui-port.cjs')
const {
	resolveSimAppRoot,
	formatSimRootHelp,
	isServerAppRoot,
	simPathOnVolume,
} = requireLauncherModule('portable-sim/sim-app-root.cjs', '../portable-desktop/sim-app-root.cjs')

const REPO_ROOT = app.isPackaged ? LAUNCHER_DIR : path.resolve(LAUNCHER_DIR, '../../..')
const SIM_LAUNCHER_SCRIPT = path.join(
	LAUNCHER_DIR,
	fs.existsSync(path.join(LAUNCHER_DIR, 'portable-sim/launch-sim-from-exfat.cjs'))
		? 'portable-sim/launch-sim-from-exfat.cjs'
		: '../portable-desktop/launch-sim-from-exfat.cjs',
)

let webuiApiOrigin = 'http://127.0.0.1:4200'

ipcMain.on('update-api-origin', (_event, origin) => {
	webuiApiOrigin = origin
	console.log('[Electron Main] WebUI API Origin updated to:', webuiApiOrigin)
})

const distWebPath = path.resolve(__dirname, 'dist-web')
const server = createLauncherStaticServer({
	getApiOrigin: () => webuiApiOrigin,
	distWebPath,
	port: WEBUI_PORT,
	getEnabledModuleIds,
	buildModulesApiPayload,
})

ipcMain.handle('get-optional-modules', () => ({
	registry: getRegistryModules(),
	enabled: getEnabledModuleIds(),
}))

ipcMain.handle('set-optional-modules', async (_event, enabled) => {
	const prev = getEnabledModuleIds()
	const nextIds = Array.isArray(enabled) ? enabled : []
	setEnabledModuleIds(nextIds)
	const next = getEnabledModuleIds()
	const wasOn = prev.includes('cg-studio')
	const nowOn = next.includes('cg-studio')
	let cgStudio = null
	if (wasOn !== nowOn) {
		cgStudio = await syncCgStudioModule(nowOn, LAUNCHER_DIR, REPO_ROOT, resolveSimAppRoot, (msg) =>
			console.log('[Electron Main]', msg),
		)
	}
	return { enabled: next, cgStudio }
})

const { cleanupSimulation } = registerSimIpc({
	launcherDir: LAUNCHER_DIR,
	repoRoot: REPO_ROOT,
	simLauncherScript: SIM_LAUNCHER_SCRIPT,
	resolveSimAppRoot,
	formatSimRootHelp,
	isServerAppRoot,
})

registerCgStudioIpc({
	launcherDir: LAUNCHER_DIR,
	repoRoot: REPO_ROOT,
	resolveSimAppRoot,
	getEnabledModuleIds,
	log: (msg) => console.log('[Electron Main]', msg),
})

const { checkUsbStatus } = createUsbProbe({ isServerAppRoot, simPathOnVolume })
ipcMain.handle('check-usb-status', checkUsbStatus)

ipcMain.on('open-external-url', (_event, url) => {
	shell.openExternal(url)
})

const windowHooks = {
	onClosed: () => {
		closeCgStudioWindow()
		void stopCgStudioServer()
		cleanupSimulation()
	},
}

app.whenReady().then(async () => {
	createWindow(LAUNCHER_DIR, windowHooks)

	if (getEnabledModuleIds().includes('cg-studio')) {
		await syncCgStudioModule(true, LAUNCHER_DIR, REPO_ROOT, resolveSimAppRoot, (msg) =>
			console.log('[Electron Main]', msg),
		)
	}

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow(LAUNCHER_DIR, windowHooks)
		}
	})
})

app.on('window-all-closed', () => {
	closeCgStudioWindow()
	void stopCgStudioServer()
	cleanupSimulation()
	server.close()
	if (process.platform !== 'darwin') {
		app.quit()
	}
})
