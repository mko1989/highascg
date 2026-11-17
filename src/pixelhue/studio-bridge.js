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
 *   - WO-1106 C41: Studio keeps the switcher's token from its connect; a switcher restart / power cycle (new startTime)
 *     makes it dead, and "connected" stayed cached until the address changed. A dead token (the switcher's 401 / 403,
 *     a read the switcher rejects) drops the session, reconnects once and repeats the request once; a switcher that
 *     cannot be reached drops the session, so the next request (and status) connects again instead of trusting it;
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
const CONNECT_FAIL_CACHE_MS = 3000 // WO-1106 C11: a switcher that just refused is not asked again for this long

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
	const now = deps.now || Date.now
	let connecting = null // { host, promise } — the connect in flight
	let failed = null // { host, at, error } — the last refused connect

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

	/**
	 * Connect Studio to `wantHost` (again when it changed or `force`). → Studio's state, or throws with its reason.
	 * WO-1106 C11: every connect invalidates Studio's previous session, so the pane's burst of requests each logging in
	 * meant 409s and more logins. Callers for the same host share the connect in flight (a forced one too: it is a
	 * fresh connect), and a refused connect is answered from a 3 s cache unless forced.
	 */
	async function connect(wantHost, force = false) {
		if (!force && session && host === wantHost) return state
		if (connecting && connecting.host === wantHost) return connecting.promise
		if (!force && failed && failed.host === wantHost && now() - failed.at < CONNECT_FAIL_CACHE_MS) throw failed.error
		const promise = connectOnce(wantHost).finally(() => {
			if (connecting && connecting.promise === promise) connecting = null
		})
		connecting = { host: wantHost, promise }
		return promise
	}

	async function connectOnce(wantHost) {
		let r
		try {
			r = await raw('POST', '/api/connect', { host: wantHost })
		} catch (e) {
			failed = { host: wantHost, at: now(), error: e }
			throw e
		}
		const j = json(r)
		if (r.status !== 200 || !j?.session) {
			session = ''
			state = null
			const error = Object.assign(new Error(j?.error || `PixelHue Studio could not connect to ${wantHost}`), { status: r.status === 200 ? 502 : r.status })
			failed = { host: wantHost, at: now(), error }
			throw error
		}
		failed = null
		session = j.session
		host = wantHost
		state = j
		return j
	}

	/**
	 * WO-1106 C41: what Studio's answer says about the connection. Studio wraps every switcher failure as 502 with
	 * `Device HTTP <code> at <path>.` / `Device rejected <path>: <message> (code <n>).` / `Cannot reach <host>:<port>: …`
	 * (vendor lib/pixelhue.js requestJson). The switcher's refusal code for a stale token is not documented, so a
	 * rejected READ is treated as one (as pixelhue-read.js does); a rejected WRITE is not repeated — it may be a real
	 * refusal after part of the write went through.
	 * @returns {'retry' | 'drop' | null} retry = reconnect + send once more; drop = forget the session, answer as is
	 */
	function refusal(r, method) {
		if (r.status !== 409 && r.status !== 502) return null
		const text = r.body.toString('utf8')
		if (r.status === 409) return /Connection changed|Connect to a device first/.test(text) ? 'retry' : null
		if (/Device HTTP 40[13] at /.test(text)) return 'retry'
		if (/Device rejected [^"]*\(code -?\d+\)/.test(text)) return method === 'GET' ? 'retry' : null
		if (/Cannot reach /.test(text)) return 'drop'
		return null
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
				await connect(wantHost)
			} catch (e) {
				return { status: e.status || 502, type: 'application/json', body: Buffer.from(JSON.stringify({ error: e.message })) }
			}
			const used = session
			const r = method === 'GET' ? await raw('GET', withSession(apiPath)) : await raw('PUT', withSession(apiPath), { ...(body && typeof body === 'object' ? body : {}), session })
			const why = refusal(r, method)
			// only the session this request used is dropped: a concurrent request may already have reconnected, and
			// the retry then uses that connect (C11: one connect per host) instead of forcing another
			if (why && session === used) {
				session = ''
				state = null
			}
			if (why !== 'retry' || attempt > 0) return r
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
			failed = null
		},
	}
}

module.exports = { createStudioBridge }
