const path = require('path')
const { BrowserWindow } = require('electron')

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null

function getMainWindow() {
	return mainWindow
}

/** @param {{ onClosed?: () => void }} [hooks] */
function createWindow(launcherDir, hooks = {}) {
	mainWindow = new BrowserWindow({
		width: 1100,
		height: 850,
		minWidth: 800,
		minHeight: 600,
		title: 'HighAsCG Operator Panel & Launcher',
		icon: path.join(launcherDir, 'icon.svg'),
		frame: true,
		autoHideMenuBar: true,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			devTools: true,
		},
	})

	mainWindow.loadFile(path.join(launcherDir, 'index.html'))

	mainWindow.on('closed', () => {
		mainWindow = null
		hooks.onClosed?.()
	})

	return mainWindow
}

module.exports = { createWindow, getMainWindow }
