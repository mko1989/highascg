'use strict'

/**
 * WO-1039 — the owner's PixelHue Studio, run inside this server.
 *
 * The vendored Studio (src/pixelhue/vendor/pixelhue-studio, unmodified ES modules) is its own little HTTP app with a
 * typed API over one connected switcher. It is started in-process on a loopback port the first time it is needed,
 * and every request to it goes through `call()`:
 *   - it is kept connected to the address set in Devices ▸ PixelHue (`POST /api/connect` when needed);
 *   - Studio guards every request with the `session` of its current connection — the bridge adds it, so a client of
 *     HighAsCG never handles sessions; a request refused because the connection changed (409) reconnects and is
 *     sent once more (a refused request was not executed);
 *   - Studio's API is GET = read, PUT = write. HighAsCG's routes take GET and POST: a POST here is Studio's PUT.
 *
 * Nothing leaves the box: the Studio app listens on 127.0.0.1 only and is reachable only through these routes.
 * Removing it: this file, routes-pixelhue-studio.js and the vendor directory.
 */

const http = require('node:http')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const SERVER = path.join(__dirname, 'vendor', 'pixelhue-studio', 'server.js')
const TIMEOUT_MS = 90000 // Studio's own device calls may take up to 80 s (layer create on a busy switcher)

function createStudioBridge(deps = {}) {
	const startApp = deps.startApp || (async () => {
		const mod = await import(pathToFileURL(SERVER).href)
		const app = mod.createApp()
		await new Promise((resolve, reject) => app.once('error', reject).listen(0, '127.0.0.1', resolve))
		app.unref?.()
		return { port: app.address().port, close: () => app.close() }
	})
	let app = null
	let starting = null
	let session = ''
	let host = ''
	let state = null // Studio's answer to the last connect: { session, device: { model, serial, … }, capabilities }

	function ensureApp() {
		if (app) return Promise.resolve(app)
		if (!starting) {
			starting = startApp()
				.then((a) => (app = a))
				.finally(() => (starting = null))
		}
		return starting
	}

	/** One request to the Studio app. → { status, type, body: Buffer } */
	function raw(method, apiPath, body) {
		return ensureApp().then(({ port }) => new Promise((resolve, reject) => {
			const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
			const req = http.request({ host: '127.0.0.1', port, path: apiPath, method, timeout: TIMEOUT_MS,
				headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (res) => {
				const chunks = []
				res.on('data', (c) => chunks.push(c))
				res.on('end', () => resolve({ status: res.statusCode || 502, type: String(res.headers['content-type'] || 'application/json'), body: Buffer.concat(chunks) }))
			})
			req.on('timeout', () => req.destroy(new Error('PixelHue Studio did not answer in time')))
			req.on('error', reject)
			req.end(data || undefined)
		}))
	}

	const json = (r) => {
		try {
			return JSON.parse(r.body.toString('utf8'))
		} catch {
			return null
		}
	}

	/** Connect Studio to `wantHost` (again when it changed or `force`). → Studio's state, or throws with its reason. */
	async function connect(wantHost, force = false) {
		if (!force && session && host === wantHost) return state
		const r = await raw('POST', '/api/connect', { host: wantHost })
		const j = json(r)
		if (r.status !== 200 || !j?.session) {
			session = ''
			state = null
			throw Object.assign(new Error(j?.error || `PixelHue Studio could not connect to ${wantHost}`), { status: r.status === 200 ? 502 : r.status })
		}
		session = j.session
		host = wantHost
		state = j
		return j
	}

	const withSession = (apiPath) => `${apiPath}${apiPath.includes('?') ? '&' : '?'}session=${encodeURIComponent(session)}`

	/**
	 * @param {'GET' | 'POST'} method POST = a Studio write (PUT)
	 * @param {string} apiPath Studio path with its query, e.g. `/api/programming` or `/api/gallery/thumb?id=3`
	 * @param {object | undefined} body the write's body (the session is added)
	 * @param {string} wantHost the switcher address from Devices ▸ PixelHue
	 * @returns {Promise<{ status: number, type: string, body: Buffer }>}
	 */
	async function call(method, apiPath, body, wantHost) {
		if (!wantHost) return { status: 409, type: 'application/json', body: Buffer.from(JSON.stringify({ error: 'No PixelHue switcher is set (Devices ▸ PixelHue).' })) }
		for (let attempt = 0; ; attempt++) {
			try {
				await connect(wantHost, attempt > 0)
			} catch (e) {
				return { status: e.status || 502, type: 'application/json', body: Buffer.from(JSON.stringify({ error: e.message })) }
			}
			const r = method === 'GET' ? await raw('GET', withSession(apiPath)) : await raw('PUT', withSession(apiPath), { ...(body && typeof body === 'object' ? body : {}), session })
			const refused = r.status === 409 && /Connection changed|Connect to a device first/.test(r.body.toString('utf8'))
			if (!refused || attempt > 0) return r
		}
	}

	return {
		call,
		/** Studio's connection state for `wantHost` (connects when needed): model, serial, capabilities. */
		status: async (wantHost, force = false) => {
			if (!wantHost) return { connected: false, error: 'No PixelHue switcher is set (Devices ▸ PixelHue).' }
			try {
				const s = await connect(wantHost, force)
				return { connected: true, host: wantHost, device: s.device || null, capabilities: s.capabilities || {} }
			} catch (e) {
				return { connected: false, host: wantHost, error: e.message }
			}
		},
		stop: () => {
			try {
				app?.close()
			} catch (_) {
				/* already closed */
			}
			app = null
			session = ''
			state = null
		},
	}
}

module.exports = { createStudioBridge }
