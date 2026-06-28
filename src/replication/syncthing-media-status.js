'use strict'

const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const SYNCTHING_API = process.env.HIGHASCG_SYNCTHING_API || 'http://127.0.0.1:8384'

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

/**
 * @param {string} folderId
 * @returns {Promise<{ ok: boolean, state?: string, globalBytes?: number, needBytes?: number, error?: string }>}
 */
async function fetchSyncthingFolderStatus(folderId) {
	const apiPath = `/rest/db/status?folder=${encodeURIComponent(folderId)}`
	return new Promise((resolve) => {
		let url
		try {
			url = new URL(apiPath, SYNCTHING_API)
		} catch (e) {
			resolve({ ok: false, error: e?.message || String(e) })
			return
		}
		const apiKey = readSyncthingApiKey()
		const req = http.get(
			{
				hostname: url.hostname,
				port: url.port || (url.protocol === 'https:' ? 443 : 80),
				path: url.pathname + url.search,
				timeout: 3000,
				headers: apiKey ? { 'X-API-Key': apiKey } : {},
			},
			(res) => {
				let data = ''
				res.on('data', (c) => {
					data += c
				})
				res.on('end', () => {
					if (res.statusCode === 404) {
						resolve({ ok: false, error: 'folder not configured' })
						return
					}
					if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
						resolve({ ok: false, error: `syncthing HTTP ${res.statusCode}` })
						return
					}
					try {
						const j = JSON.parse(data)
						resolve({
							ok: true,
							state: String(j.state || 'unknown'),
							globalBytes: j.globalBytes ?? 0,
							needBytes: j.needBytes ?? 0,
						})
					} catch {
						resolve({ ok: false, error: 'invalid syncthing response' })
					}
				})
			},
		)
		req.on('timeout', () => {
			req.destroy()
			resolve({ ok: false, error: 'syncthing timeout' })
		})
		req.on('error', (e) => resolve({ ok: false, error: e?.message || String(e) }))
	})
}

/**
 * @param {string} folderId
 */
async function getMediaSyncStatus(folderId) {
	const st = await fetchSyncthingFolderStatus(folderId)
	if (!st.ok) {
		return { available: false, caughtUp: false, error: st.error, state: 'unavailable' }
	}
	const caughtUp = st.state === 'idle' && (st.needBytes ?? 0) === 0
	return {
		available: true,
		caughtUp,
		state: st.state,
		globalBytes: st.globalBytes,
		needBytes: st.needBytes,
		percent:
			st.globalBytes && st.globalBytes > 0
				? Math.round(((st.globalBytes - (st.needBytes || 0)) / st.globalBytes) * 100)
				: caughtUp
					? 100
					: 0,
	}
}

module.exports = { fetchSyncthingFolderStatus, getMediaSyncStatus, readSyncthingApiKey }
