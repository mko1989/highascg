'use strict'

/**
 * WO-1035 — read-only view of a PixelHue switcher: which layers sit on which screen, and where.
 *
 * Purpose: HighAsCG feeds the switcher a key + fill pair for overlays (WO-1034); to draw something that follows a
 * switcher layer (a border round a PIP) it has to know that layer's rectangle. Reading never writes; the only write
 * is `put`, used by pixelhue-look-drive.js when "looks drive the switcher" is on (off by default).
 *
 * Transport (docs/reference/PIXELHUE_API.md): discovery on https://{host}:19998 (self-signed) names the device
 * address and its HTTP API port; `node/open-detail` gives sn + startTime; the token is an HS256 JWT of { SN } signed
 * with String(startTime), sent raw in `Authorization`. Screens and layers come from `…/list-detail`.
 */

const crypto = require('node:crypto')
const http = require('node:http')
const https = require('node:https')

const UNICO_PORT = 19998
const DEFAULT_API_PORT = 8088
const CACHE_MS = 200
const TIMEOUT_MS = 4000

const SCENE = { 2: 'pgm', 4: 'pvw' }
const LAYER_TYPE = { 2: 'normal', 4: 'aux', 8: 'mvr', 16: 'bkg', 32: 'logo' }

const b64url = (buf) => Buffer.from(buf).toString('base64url')

/** HS256 JWT, payload { SN }, secret String(startTime), no iat/exp — what the switcher's own clients send. */
function makeToken(sn, startTime) {
	const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
	const body = b64url(JSON.stringify({ SN: sn }))
	const sig = crypto.createHmac('sha256', String(startTime)).update(`${head}.${body}`).digest('base64url')
	return `${head}.${body}.${sig}`
}

/** GET (or, with a body, PUT) a JSON document; https targets are the switcher's self-signed discovery service. */
function httpJson(url, headers = {}, body) {
	return new Promise((resolve, reject) => {
		const lib = url.startsWith('https:') ? https : http
		const data = body === undefined ? null : JSON.stringify(body)
		const opts = { method: data ? 'PUT' : 'GET', timeout: TIMEOUT_MS, rejectUnauthorized: false,
			headers: { ...headers, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }
		const req = lib.request(url, opts, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
				} catch (e) {
					reject(new Error(`bad JSON from ${url}: ${e.message}`))
				}
			})
		})
		req.on('timeout', () => req.destroy(new Error(`timeout: ${url}`)))
		req.on('error', reject)
		req.end(data || undefined)
	})
}

const listOf = (r) => (Array.isArray(r?.data) ? r.data : Array.isArray(r?.data?.list) ? r.data.list : [])
const int = (v) => Math.round(Number(v) || 0)

/** The address + HTTP API port to talk to: what discovery advertises, else the host itself on the default port. */
async function resolveDevice(host, get) {
	try {
		const dev = listOf(await get(`https://${host}:${UNICO_PORT}/unico/v1/ucenter/device-list`))[0]
		const proto = (dev?.protocols || []).find((p) => p?.linkType === 'http')
		if (dev?.ip) return { ip: String(dev.ip), port: int(proto?.port) || DEFAULT_API_PORT }
	} catch {
		/* no discovery service on this address: it may be the device itself */
	}
	return { ip: host, port: DEFAULT_API_PORT }
}

/** One layer as HighAsCG needs it: rectangle in screen pixels (top-left origin), order, visibility, source. */
function normalizeLayer(l) {
	const o = l?.layerIdObj || {}
	const w = l?.window || {}
	return {
		layerId: l?.layerId,
		name: String(l?.general?.name || ''),
		screenId: o.attachScreenId,
		scene: SCENE[o.sceneType] || 'none',
		type: LAYER_TYPE[o.type] || String(o.type ?? ''),
		zorder: int(l?.zorder),
		enabled: l?.enable === 1,
		opacity: Number.isFinite(Number(l?.opacity)) ? Number(l.opacity) : 100,
		x: int(w.x),
		y: int(w.y),
		width: int(w.width),
		height: int(w.height),
		source: String(l?.source?.general?.sourceName || ''),
		sourceType: l?.source?.general?.sourceType ?? null,
		sourceId: l?.source?.general?.sourceId ?? null,
	}
}

const r6 = (v) => Math.round(v * 1e6) / 1e6

/** The layer's rectangle as a look-layer `fill` (top-left + size, as fractions of the screen): a HighAsCG layer with
 * this fill on an output of the same shape covers exactly what the switcher layer covers. */
function withFill(l, sw, sh) {
	if (!(sw > 0) || !(sh > 0) || !(l.width > 0) || !(l.height > 0)) return l
	return { ...l, fill: { x: r6(l.x / sw), y: r6(l.y / sh), scaleX: r6(l.width / sw), scaleY: r6(l.height / sh) } }
}

/** Screens with their layers, bottom layer first. */
function normalize(screensRes, layersRes) {
	const layers = listOf(layersRes).map(normalizeLayer)
	return listOf(screensRes).map((s) => {
		const win = s?.mosaic?.window || {}
		return {
			screenId: s?.screenId,
			name: String(s?.general?.name || '').trim(),
			enabled: s?.enable === 1,
			width: int(win.width),
			height: int(win.height),
			layers: layers
				.filter((l) => l.screenId === s?.screenId)
				.sort((a, b) => a.zorder - b.zorder)
				.map((l) => withFill(l, int(win.width), int(win.height))),
		}
	})
}

/**
 * A reader for one switcher address. The token lives until the switcher refuses it (it restarts → new startTime);
 * reads within CACHE_MS share one round trip, so several overlays polling cost the switcher one request pair.
 * @param {string} host
 * @param {{ get?: (url: string, headers?: object) => Promise<object>, now?: () => number }} [deps]
 */
function createPixelhueReader(host, deps = {}) {
	const get = deps.get || httpJson
	const now = deps.now || Date.now
	let device = null
	let token = ''
	let cache = null
	let pending = null

	async function login() {
		device = device || (await resolveDevice(host, get))
		const od = await get(`http://${device.ip}:${device.port}/unico/v1/node/open-detail`)
		if (!od?.data?.sn) throw new Error('PixelHue open-detail returned no serial number')
		token = makeToken(od.data.sn, od.data.startTime)
	}

	async function authed(path, body) {
		for (let attempt = 0; ; attempt++) {
			if (!token) await login()
			const r = await get(`http://${device.ip}:${device.port}${path}`, { Authorization: token }, body)
			if (r?.code === 0 || (body !== undefined && r?.code === 200)) return r
			if (attempt > 0) throw new Error(`PixelHue ${path}: code ${r?.code} ${r?.message || r?.msg || ''}`.trim())
			token = '' // refused: the switcher restarted since the token was made
		}
	}

	async function fetchAll() {
		const screens = await authed('/unico/v1/screen/list-detail')
		const layers = await authed('/unico/v1/layers/list-detail')
		return { host, device: { ...device }, at: now(), screens: normalize(screens, layers) }
	}

	/** @returns {Promise<{ host: string, device: { ip: string, port: number }, at: number, screens: object[] }>} */
	function read() {
		if (cache && now() - cache.at < CACHE_MS) return Promise.resolve(cache)
		if (!pending) {
			pending = fetchAll()
				.then((r) => (cache = r))
				.finally(() => (pending = null))
		}
		return pending
	}

	/** The ONE write (pixelhue-look-drive.js): PUT a body to the switcher; the next read is fresh. */
	async function put(path, body) {
		const r = await authed(path, body)
		cache = null
		return r
	}

	return { host, read, put }
}

module.exports = { makeToken, normalize, createPixelhueReader }
