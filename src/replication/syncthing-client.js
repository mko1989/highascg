'use strict'

const http = require('http')
const { readSyncthingApiKey } = require('./syncthing-media-status')

const SYNCTHING_API = process.env.HIGHASCG_SYNCTHING_API || 'http://127.0.0.1:8384'

/**
 * @param {'GET'|'POST'|'PUT'|'PATCH'} method
 * @param {string} apiPath
 * @param {object|null} [body]
 */
function syncthingRequest(method, apiPath, body = null) {
	return new Promise((resolve) => {
		let url
		try {
			url = new URL(apiPath.startsWith('/') ? apiPath : `/${apiPath}`, SYNCTHING_API)
		} catch (e) {
			resolve({ ok: false, status: 0, json: null, error: e?.message || String(e) })
			return
		}
		const apiKey = readSyncthingApiKey()
		const bodyStr = body != null ? JSON.stringify(body) : ''
		const req = http.request(
			{
				hostname: url.hostname,
				port: url.port || 8384,
				path: url.pathname + url.search,
				method,
				timeout: 15000,
				headers: {
					Accept: 'application/json',
					...(apiKey ? { 'X-API-Key': apiKey } : {}),
					...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
				},
			},
			(res) => {
				let data = ''
				res.on('data', (c) => {
					data += c
				})
				res.on('end', () => {
					let json = null
					try {
						json = data ? JSON.parse(data) : null
					} catch {
						json = null
					}
					const ok = res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300
					resolve({ ok, status: res.statusCode || 0, json, error: ok ? undefined : `HTTP ${res.statusCode}` })
				})
			},
		)
		req.on('timeout', () => {
			req.destroy()
			resolve({ ok: false, status: 0, json: null, error: 'timeout' })
		})
		req.on('error', (e) => resolve({ ok: false, status: 0, json: null, error: e?.message || String(e) }))
		if (bodyStr) req.write(bodyStr)
		req.end()
	})
}

async function getSyncthingConfig() {
	return syncthingRequest('GET', '/rest/config')
}

async function saveSyncthingConfig(config) {
	return syncthingRequest('PUT', '/rest/config', config)
}

async function getLocalSyncthingDeviceId() {
	const st = await syncthingRequest('GET', '/rest/system/status')
	if (st.ok && st.json?.myID) return st.json.myID
	return null
}

async function scanFolder(folderId) {
	return syncthingRequest('POST', `/rest/db/scan?folder=${encodeURIComponent(folderId)}`)
}

async function ensureRemoteDevice(deviceId, name) {
	const cfgRes = await getSyncthingConfig()
	if (!cfgRes.ok || !cfgRes.json) return { ok: false, error: cfgRes.error || 'config read failed' }
	const cfg = cfgRes.json
	cfg.devices = Array.isArray(cfg.devices) ? cfg.devices : []
	if (!cfg.devices.some((d) => d.deviceID === deviceId)) {
		cfg.devices.push({
			deviceID: deviceId,
			name: name || deviceId.slice(0, 7),
			addresses: ['dynamic'],
			compressed: true,
		})
	}
	const save = await saveSyncthingConfig(cfg)
	return save.ok ? { ok: true } : { ok: false, error: save.error || 'config save failed' }
}

async function ensureSharedFolder(folderId, folderPath, deviceIds, folderType = 'sendreceive') {
	const cfgRes = await getSyncthingConfig()
	if (!cfgRes.ok || !cfgRes.json) return { ok: false, error: cfgRes.error || 'config read failed' }
	const cfg = cfgRes.json
	cfg.folders = Array.isArray(cfg.folders) ? cfg.folders : []
	let folder = cfg.folders.find((f) => f.id === folderId)
	const deviceEntries = deviceIds.map((id) => ({ deviceID: id }))
	if (!folder) {
		folder = {
			id: folderId,
			label: folderId,
			path: folderPath,
			type: folderType,
			devices: deviceEntries,
			rescanIntervalS: 60,
			fsWatcherEnabled: true,
			ignorePerms: true,
		}
		cfg.folders.push(folder)
	} else {
		folder.path = folderPath
		folder.type = folderType
		folder.devices = deviceEntries
	}
	const save = await saveSyncthingConfig(cfg)
	if (!save.ok) return { ok: false, error: save.error || 'config save failed' }
	await scanFolder(folderId)
	return { ok: true, folderId }
}

module.exports = {
	syncthingRequest,
	getSyncthingConfig,
	saveSyncthingConfig,
	getLocalSyncthingDeviceId,
	scanFolder,
	ensureRemoteDevice,
	ensureSharedFolder,
}
