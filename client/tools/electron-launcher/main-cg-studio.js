const fs = require('fs')
const path = require('path')
const { BrowserWindow, ipcMain } = require('electron')

let cgStudioWindow = null
let studioServer = null

function hasTemplateTree(root) {
	return fs.existsSync(path.join(root, 'template', 'lower-thirds'))
}

function resolveHighascgRoot(launcherDir, repoRoot, resolveSimAppRoot) {
	const candidates = []
	const resolved = resolveSimAppRoot({ launcherDir, repoRoot, allowExfatStick: false })
	if (resolved) candidates.push(resolved.appRoot)
	for (const candidate of [
		process.env.HIGHASCG_SIM_APP_ROOT,
		process.env.HIGHASCG_SERVER_ROOT,
		'/Users/marcin/highascg',
	]) {
		if (candidate) candidates.push(path.resolve(candidate))
	}
	for (const root of candidates) {
		if (hasTemplateTree(root)) return root
	}
	return null
}

function resolveCgStudioPaths(launcherDir, repoRoot, resolveSimAppRoot) {
	const highascgRoot = resolveHighascgRoot(launcherDir, repoRoot, resolveSimAppRoot)
	if (!highascgRoot) return null

	const bundled = path.join(launcherDir, 'cg-studio')
	if (fs.existsSync(path.join(bundled, 'studio-server.js'))) {
		return { packageDir: bundled, highascgRoot, source: 'launcher/cg-studio bundle' }
	}

	const packageDir = path.join(highascgRoot, 'src/cg-studio')
	if (fs.existsSync(path.join(packageDir, 'studio-server.js'))) {
		return { packageDir, highascgRoot, source: highascgRoot }
	}

	return null
}

function closeCgStudioWindow() {
	if (cgStudioWindow && !cgStudioWindow.isDestroyed()) cgStudioWindow.close()
	cgStudioWindow = null
}

async function stopCgStudioServer() {
	if (studioServer) {
		await studioServer.close()
		studioServer = null
	}
}

function openCgStudioWindow(studioUrl, launcherDir) {
	const url = String(studioUrl || '').trim()
	if (!url) return null
	if (cgStudioWindow && !cgStudioWindow.isDestroyed()) {
		cgStudioWindow.loadURL(url)
		cgStudioWindow.focus()
		return cgStudioWindow
	}
	cgStudioWindow = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 960,
		minHeight: 600,
		title: 'CG Studio',
		icon: path.join(launcherDir, 'icon.svg'),
		autoHideMenuBar: true,
		webPreferences: { nodeIntegration: false, contextIsolation: true, devTools: true },
	})
	cgStudioWindow.loadURL(url)
	cgStudioWindow.on('closed', () => {
		cgStudioWindow = null
	})
	return cgStudioWindow
}

function registerCgStudioIpc(ctx) {
	const { launcherDir, repoRoot, resolveSimAppRoot, getEnabledModuleIds, log = console.log } = ctx

	async function ensureStudioServer() {
		if (studioServer) return studioServer
		const paths = resolveCgStudioPaths(launcherDir, repoRoot, resolveSimAppRoot)
		if (!paths) {
			throw new Error(
				'CG Studio not found. Run npm run launcher:prepare or set HIGHASCG_SERVER_ROOT=/Users/marcin/highascg',
			)
		}
		const { configure } = require(path.join(paths.packageDir, 'cg-studio-context'))
		const { startStudioServer } = require(path.join(paths.packageDir, 'studio-server'))
		const { resolveStudioPort } = require(path.join(paths.packageDir, 'routes'))
		configure({
			packageDir: paths.packageDir,
			templateRoot: path.join(paths.highascgRoot, 'template'),
		})
		const port = resolveStudioPort()
		studioServer = await startStudioServer({
			port,
			bindAddress: '127.0.0.1',
			log: (level, msg) => log(`[${level}] ${msg}`),
		})
		log(`[cg-studio] templates: ${paths.highascgRoot}/template (${paths.source})`)
		return studioServer
	}

	ipcMain.handle('cg-studio-is-enabled', () => ({
		enabled: getEnabledModuleIds().includes('cg-studio'),
		running: Boolean(studioServer),
		url: studioServer ? studioServer.url : null,
	}))

	ipcMain.handle('open-cg-studio', async () => {
		if (!getEnabledModuleIds().includes('cg-studio')) {
			return { ok: false, error: 'Enable CG Overlay Studio in the Modules tab first.' }
		}
		try {
			const server = await ensureStudioServer()
			openCgStudioWindow(server.url, launcherDir)
			return { ok: true, url: server.url, port: server.port }
		} catch (e) {
			return { ok: false, error: e.message || String(e) }
		}
	})
}

async function syncCgStudioModule(enabled, launcherDir, repoRoot, resolveSimAppRoot, log = console.log) {
	if (enabled) {
		const paths = resolveCgStudioPaths(launcherDir, repoRoot, resolveSimAppRoot)
		if (!paths) {
			log('[cg-studio] enable skipped — package or template tree not found')
			return { ok: false, running: false, error: 'CG Studio package not found' }
		}
		try {
			const { configure } = require(path.join(paths.packageDir, 'cg-studio-context'))
			const { startStudioServer } = require(path.join(paths.packageDir, 'studio-server'))
			const { resolveStudioPort } = require(path.join(paths.packageDir, 'routes'))
			if (!studioServer) {
				configure({
					packageDir: paths.packageDir,
					templateRoot: path.join(paths.highascgRoot, 'template'),
				})
				studioServer = await startStudioServer({
					port: resolveStudioPort(),
					bindAddress: '127.0.0.1',
					log: (level, msg) => log(`[${level}] ${msg}`),
				})
				log(`[cg-studio] started on ${studioServer.url} (module enabled)`)
			}
			return { ok: true, running: true, url: studioServer.url, port: studioServer.port }
		} catch (e) {
			log(`[cg-studio] start failed: ${e.message || e}`)
			return { ok: false, running: false, error: e.message || String(e) }
		}
	}

	closeCgStudioWindow()
	await stopCgStudioServer()
	log('[cg-studio] stopped (module disabled)')
	return { ok: true, running: false }
}

module.exports = {
	registerCgStudioIpc,
	closeCgStudioWindow,
	stopCgStudioServer,
	resolveCgStudioPaths,
	syncCgStudioModule,
}
