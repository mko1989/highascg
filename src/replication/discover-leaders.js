'use strict'

const os = require('os')
const http = require('http')

const SCAN_TIMEOUT_MS = 350

function fetchReplicationPing(host, port) {
	return new Promise((resolve) => {
		const req = http.get(
			{ host, port, path: '/api/replication/ping', timeout: SCAN_TIMEOUT_MS, headers: { Accept: 'application/json' } },
			(res) => {
				let data = ''
				res.on('data', (c) => {
					data += c
				})
				res.on('end', () => {
					try {
						resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, json: data ? JSON.parse(data) : null })
					} catch {
						resolve({ ok: false, json: null })
					}
				})
			},
		)
		req.on('timeout', () => {
			req.destroy()
			resolve({ ok: false, json: null })
		})
		req.on('error', () => resolve({ ok: false, json: null }))
	})
}

function localSubnetPrefix() {
	for (const list of Object.values(os.networkInterfaces())) {
		if (!list) continue
		for (const iface of list) {
			if (iface && !iface.internal && iface.family === 'IPv4') {
				const parts = String(iface.address || '').split('.')
				if (parts.length === 4) return parts.slice(0, 3).join('.')
			}
		}
	}
	return null
}

async function discoverAvailableLeaders(opts = {}) {
	const port = opts.port || 4200
	const prefix = opts.subnetPrefix || localSubnetPrefix()
	if (!prefix) return []

	const hosts = []
	for (let i = 1; i <= 254; i++) hosts.push(`${prefix}.${i}`)

	const results = await Promise.all(
		hosts.map(async (host) => {
			if (opts.excludeSelf && host === opts.excludeSelf) return null
			const res = await fetchReplicationPing(host, port)
			if (!res.ok || !res.json?.leaderAvailable) return null
			return {
				host,
				port,
				selfId: res.json.selfId || '',
				hostname: res.json.hostname || host,
				role: res.json.role || 'standalone',
				syncthingDeviceId: res.json.syncthingDeviceId || '',
				appVersion: res.json.appVersion || '',
			}
		}),
	)

	return results.filter(Boolean)
}

module.exports = { discoverAvailableLeaders, fetchReplicationPing, localSubnetPrefix }
