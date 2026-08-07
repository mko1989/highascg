const path = require('path')
const { BrowserWindow, ipcMain } = require('electron')

/*
 * CG Studio is served in-process by the HighAsCG server (src/cg-studio/ via the
 * module registry — /cg-studio/ + /api/cg-studio, enabled by default). The
 * launcher no longer hosts its own copy: "open CG Studio" just opens a window
 * on the connected (or simulated) server's studio URL.
 */

let cgStudioWindow = null

function closeCgStudioWindow() {
	if (cgStudioWindow && !cgStudioWindow.isDestroyed()) cgStudioWindow.close()
	cgStudioWindow = null
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
	const { launcherDir, getEnabledModuleIds } = ctx

	ipcMain.handle('cg-studio-is-enabled', () => ({
		enabled: getEnabledModuleIds().includes('cg-studio'),
	}))

	ipcMain.handle('open-cg-studio', (_event, payload) => {
		if (!getEnabledModuleIds().includes('cg-studio')) {
			return { ok: false, error: 'Enable CG Overlay Studio in the Modules tab first.' }
		}
		const url = String(payload && payload.url ? payload.url : '').trim()
		if (!/^https?:\/\//.test(url)) {
			return { ok: false, error: `Invalid CG Studio URL: ${url || '(empty)'}` }
		}
		openCgStudioWindow(url, launcherDir)
		return { ok: true, url }
	})
}

module.exports = {
	registerCgStudioIpc,
	closeCgStudioWindow,
}
