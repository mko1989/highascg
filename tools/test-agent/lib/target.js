'use strict'

/**
 * WO-836 Part 3c — which server / Caspar `caspar` talks to: the running driver's target (state file), or
 * HIGHASCG_TEST_TARGET=live|sandbox. Live reads the node's token from .private/api-token itself (never printed, never
 * put in the state file); the media root (where Caspar drops PRINT PNGs) from GET /api/settings → local_media_path.
 */

const fs = require('fs')
const http = require('http')
const path = require('path')
const { readState } = require('./state')

const REPO_ROOT = path.resolve(__dirname, '../../..')
const LIVE_API = 'http://127.0.0.1:4200'

function readToken() {
	for (const p of [path.join(REPO_ROOT, '.private/api-token'), path.join(process.env.HOME || '', 'highascg/.private/api-token')]) {
		try {
			const t = fs.readFileSync(p, 'utf8').trim()
			if (t) return t
		} catch {
			/* next */
		}
	}
	return ''
}

function resolveTarget() {
	const st = readState()
	const mode = process.env.HIGHASCG_TEST_TARGET || st?.mode || 'live'
	if (!['live', 'sandbox'].includes(mode)) throw new Error(`HIGHASCG_TEST_TARGET must be live or sandbox, got '${mode}'`)
	if (mode === 'sandbox' && !(st && st.mode === 'sandbox')) throw new Error('target is sandbox but no sandbox driver is running (ui start --sandbox)')
	const api = process.env.HIGHASCG_TEST_API || (mode === 'sandbox' ? st.server : st?.server || LIVE_API)
	return { mode, api, out: st?.out || null }
}

/** GET/POST JSON against the node. `token` goes in a Bearer header on live only. */
function request(t, method, apiPath, body) {
	return new Promise((resolve, reject) => {
		const u = new URL(apiPath, t.api)
		const headers = { Accept: 'application/json' }
		if (t.mode === 'live') {
			const tok = readToken()
			if (tok) headers.Authorization = `Bearer ${tok}`
		}
		const payload = body == null ? null : JSON.stringify(body)
		if (payload) {
			headers['Content-Type'] = 'application/json'
			headers['Content-Length'] = Buffer.byteLength(payload)
		}
		const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
			const c = []
			res.on('data', (d) => c.push(d))
			res.on('end', () => {
				const text = Buffer.concat(c).toString('utf8')
				let data = text
				try {
					data = JSON.parse(text)
				} catch {
					/* leave as text */
				}
				if (res.statusCode >= 400) return reject(new Error(`${method} ${u.pathname} → HTTP ${res.statusCode}: ${String(text).slice(0, 200)}`))
				resolve(data)
			})
		})
		req.on('error', (e) => reject(new Error(`cannot reach the node at ${t.api} (${e.code || e.message})`)))
		req.setTimeout(15000, () => req.destroy(new Error('node request timed out')))
		if (payload) req.write(payload)
		req.end()
	})
}

module.exports = { resolveTarget, request, readToken, REPO_ROOT }
