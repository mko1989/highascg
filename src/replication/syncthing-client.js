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
						/* non-JSON body — stays null */
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

async function getLocalSyncthingDeviceId() {
	const st = await syncthingRequest('GET', '/rest/system/status')
	if (st.ok && st.json?.myID) return st.json.myID
	return null
}

// WO-831: only the device-id read is used (pairing + replication GET). The config-writing helpers
// (ensureSharedFolder / ensureRemoteDevice / scanFolder …) had no caller — media moves by rsync.
module.exports = { getLocalSyncthingDeviceId }
