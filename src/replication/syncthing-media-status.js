'use strict'

const http = require('http')

const SYNCTHING_API = process.env.HIGHASCG_SYNCTHING_API || 'http://127.0.0.1:8384'

/**
 * @param {string} folderId
 * @returns {Promise<{ ok: boolean, state?: string, globalBytes?: number, needBytes?: number, error?: string }>}
 */
async function fetchSyncthingFolderStatus(folderId) {
	const path = `/rest/db/status?folder=${encodeURIComponent(folderId)}`
	return new Promise((resolve) => {
		let url
		try {
			url = new URL(path, SYNCTHING_API)
		} catch (e) {
			resolve({ ok: false, error: e?.message || String(e) })
			return
		}
		const req = http.get(url, { timeout: 3000 }, (res) => {
			let data = ''
			res.on('data', (c) => {
				data += c
			})
			res.on('end', () => {
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
		})
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

module.exports = { fetchSyncthingFolderStatus, getMediaSyncStatus }
