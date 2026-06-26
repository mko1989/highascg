'use strict'

/**
 * Preload for the HighAsCG control UI window (dist-web).
 * Injects API origin before app modules load.
 */
const { contextBridge } = require('electron')

function readApiOriginFromArgv() {
	for (const arg of process.argv) {
		if (arg.startsWith('--highascg-api-origin=')) {
			return decodeURIComponent(arg.slice('--highascg-api-origin='.length))
		}
	}
	return ''
}

const apiOrigin = readApiOriginFromArgv().replace(/\/$/, '')

contextBridge.exposeInMainWorld('__HIGHASCG_API_ORIGIN__', apiOrigin)
