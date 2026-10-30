'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

/** @type {string|null} */
let _cachedApiKey = null

function syncthingHome() {
	return process.env.HOME || os.homedir() || '/home/casparcg'
}

/**
 * @returns {string|null}
 */
function readSyncthingApiKey() {
	if (process.env.HIGHASCG_SYNCTHING_API_KEY) {
		return String(process.env.HIGHASCG_SYNCTHING_API_KEY).trim() || null
	}
	if (_cachedApiKey) return _cachedApiKey
	const home = syncthingHome()
	const candidates = [
		path.join(home, '.config', 'syncthing', 'config.xml'),
		path.join(home, '.local', 'state', 'syncthing', 'config.xml'),
	]
	for (const cfgPath of candidates) {
		try {
			if (!fs.existsSync(cfgPath)) continue
			const xml = fs.readFileSync(cfgPath, 'utf8')
			const m = xml.match(/<apikey>([^<]+)<\/apikey>/i)
			if (m) {
				_cachedApiKey = m[1].trim()
				return _cachedApiKey
			}
		} catch {
			/* try next */
		}
	}
	return null
}

module.exports = { readSyncthingApiKey }
