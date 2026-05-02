'use strict'

const defaults = require('../config/defaults')
const https = require('https')
const http = require('http')
const { URL } = require('url')
const jwt = require('jsonwebtoken')

/**
 * @typedef {Object} PixelhueResolved
 * @property {string} baseUrl
 * @property {number} apiPort
 * @property {string} token
 * @property {string} sn
 * @property {object} [openDetail]
 * @property {object} [deviceFromDiscovery] last discovery row for the chosen device
 * @property {Array<object>} [deviceList] raw list from ucenter
 */

const PATH = {
	ucenterList: '/unico/v1/ucenter/device-list',
	openDetail: '/unico/v1/node/open-detail',
	screenList: '/unico/v1/screen/list-detail',
	presetList: '/unico/v1/preset',
	layerList: '/unico/v1/layers/list-detail',
	ifaceList: '/unico/v1/interface/list-detail',
	take: '/unico/v1/screen/take',
	cut: '/unico/v1/screen/cut',
	ftb: '/unico/v1/screen/ftb',
	freeze: '/unico/v1/screen/freeze',
	select: '/unico/v1/screen/select',
	apply: '/unico/v1/preset/apply',
	layersSource: '/unico/v1/layers/source',
	layersSelect: '/unico/v1/layers/select',
	layersZorder: '/unico/v1/layers/zorder',
	layersWindow: '/unico/v1/layers/window',
	layersUmd: '/unico/v1/layers/umd',
	layerPresetList: '/unico/v1/layers/layer-preset/list-detail',
	layerPresetApply: '/unico/v1/layers/layer-preset/apply',
	sourceBackup: '/unico/v1/system/ctrl/source-backup',
}

let cacheKey = ''
/** @type {PixelhueResolved | null} */
let cacheConn = null

/**
 * @param {object} c
 * @returns {string}
 */
function configKey(c) {
	const p = c?.pixelhue && typeof c.pixelhue === 'object' ? c.pixelhue : {}
	return [
		!!p.enabled,
		String(p.host || '').trim(),
		Number(p.unicoPort) || 19998,
		p.apiPort == null || p.apiPort === '' ? '' : String(p.apiPort),
		String(p.targetSerial || '').trim(),
	].join('\t')
}

function clearConnectionCache() {
	cacheKey = ''
	cacheConn = null
}

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.method]
 * @param {object} [opts.headers]
 * @param {string|object} [opts.body] JSON
 * @param {boolean} [opts.httpsInsecure] default true for self-signed
 * @returns {Promise<{ statusCode: number, json: any, raw: string }>}
 */
function httpRequest(url, opts = {}) {
	return new Promise((resolve, reject) => {
		const u = new URL(url)
		const isHttps = u.protocol === 'https:'
		const lib = isHttps ? https : http
		const pathWithQuery = u.pathname + (u.search || '')
		const port = u.port ? parseInt(u.port, 10) : isHttps ? 443 : 80
		const bodyStr =
			opts.body === undefined
				? null
				: typeof opts.body === 'string'
					? opts.body
					: JSON.stringify(opts.body)
		/** @type {Record<string, string>} */
		const headers = { ...(opts.headers || {}) }
		if (bodyStr != null && !headers['Content-Type']) {
			headers['Content-Type'] = 'application/json'
		}
		const reqOpts = {
			hostname: u.hostname,
			port,
			path: pathWithQuery,
			method: opts.method || 'GET',
			headers,
		}
		if (isHttps && (opts.httpsInsecure !== false)) {
			// @ts-ignore — same as companion module to PixelHue ucenter
			reqOpts.agent = new https.Agent({ rejectUnauthorized: false })
		}
		const req = lib.request(reqOpts, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => {
				const raw = Buffer.concat(chunks).toString('utf8')
				let j = null
				try {
					j = raw ? JSON.parse(raw) : null
				} catch (_) {
					/* not JSON */
				}
				resolve({ statusCode: res.statusCode || 0, json: j, raw })
			})
		})
		req.on('error', reject)
		if (bodyStr != null) req.write(bodyStr)
		req.end()
	})
}

/**
 * @param {Array<any>} list
 * @param {string} targetSerial
 */
function pickDevice(list, targetSerial) {
	const t = String(targetSerial || '').trim()
	if (t) {
		const hit = list.find((d) => d && (d.SN === t || d.sn === t))
		if (hit) return hit
	}
	return list[0] || null
}

/**
 * @param {object} ctx
 * @param {{ force?: boolean }} [o]
 * @returns {Promise<PixelhueResolved>}
 */
async function resolveConnection(ctx, o) {
	const cfg = (ctx && ctx.config && ctx.config.pixelhue) || {}
	const ph = { ...defaults.pixelhue, ...cfg }
	const enabled = ph.enabled === true || ph.enabled === 'true' || ph.enabled === 1
	const host = String(ph.host || '').trim()
	if (!enabled) {
		const e = new Error('PixelHue is disabled in settings')
		/** @type {any} */ (e).code = 'PIXELHUE_DISABLED'
		throw e
	}
	if (!host) {
		const e = new Error('PixelHue host is not set')
		/** @type {any} */ (e).code = 'PIXELHUE_NO_HOST'
		throw e
	}

	const unico = Math.min(65535, Math.max(1, parseInt(String(ph.unicoPort != null ? ph.unicoPort : 19998), 10) || 19998))
	const targetSerial = String(ph.targetSerial || '').trim()
	const k = configKey({ pixelhue: { ...ph, host, unicoPort: unico, targetSerial, enabled: true } })
	if (!o?.force && cacheConn && k === cacheKey) return cacheConn

	let apiPort = ph.apiPort
	if (apiPort != null && apiPort !== '') {
		const n = parseInt(String(apiPort), 10)
		if (Number.isFinite(n) && n > 0 && n <= 65535) {
			apiPort = n
		} else {
			apiPort = null
		}
	} else {
		apiPort = null
	}

	/** @type {Array<any>} */
	let arr = []
	/** @type {any} */
	let device = null
	if (apiPort != null) {
		// Pinned port: skip ucenter (useful if discovery is blocked but REST is reachable)
	} else {
		const discUrl = `https://${host}:${unico}${PATH.ucenterList}`
		const disc = await httpRequest(discUrl, { method: 'GET' })
		if (disc.statusCode < 200 || disc.statusCode >= 300 || !disc.json) {
			const e = new Error(`Device discovery failed (${disc.statusCode}): ${disc.raw?.slice(0, 200) || 'no body'}`)
			/** @type {any} */ (e).code = 'PIXELHUE_DISCOVERY'
			throw e
		}
		const list = disc.json?.data?.list || disc.json?.data || []
		arr = Array.isArray(list) ? list : []
		device = pickDevice(arr, targetSerial)
		if (!device) {
			const e = new Error('No device in ucenter device-list (empty or wrong targetSerial?)')
			/** @type {any} */ (e).code = 'PIXELHUE_NO_DEVICE'
			throw e
		}
		const protos = device.protocols || []
		const httpProto = protos.find((p) => p && p.linkType === 'http' && p.port)
		if (!httpProto) {
			const e = new Error('No HTTP protocol/port in device discovery; set pixelhue.apiPort in config.')
			/** @type {any} */ (e).code = 'PIXELHUE_NO_HTTP_PORT'
			throw e
		}
		apiPort = parseInt(String(httpProto.port), 10)
	}

	const openUrl = `http://${host}:${apiPort}${PATH.openDetail}`
	const openRes = await httpRequest(openUrl, { method: 'GET' })
	if (openRes.statusCode < 200 || openRes.statusCode >= 300 || !openRes.json?.data) {
		const e = new Error(`open-detail failed (${openRes.statusCode}): ${openRes.raw?.slice(0, 200) || 'no data'}`)
		/** @type {any} */ (e).code = 'PIXELHUE_OPEN_DETAIL'
		throw e
	}
	const sn = String(openRes.json.data.sn != null ? openRes.json.data.sn : '')
	const startTime = openRes.json.data.startTime
	if (!sn || startTime == null) {
		const e = new Error('open-detail missing sn or startTime')
		/** @type {any} */ (e).code = 'PIXELHUE_OPEN_DETAIL'
		throw e
	}

	const token = jwt.sign(
		{ SN: sn },
		String(startTime),
		{ algorithm: 'HS256', noTimestamp: true }
	)

	/** @type {PixelhueResolved} */
	const resolved = {
		baseUrl: `http://${host}:${apiPort}`,
		apiPort,
		token,
		sn,
		openDetail: openRes.json.data,
		deviceFromDiscovery: device,
		deviceList: arr,
	}
	cacheKey = k
	cacheConn = resolved
	return resolved
}

/**
 * @param {PixelhueResolved} c
 * @param {string} unicoPath must start with /unico/
 * @param {string} [method]
 * @param {object|Array<any>|null} [jsonBody]
 */
async function unicoRequest(c, unicoPath, method = 'GET', jsonBody) {
	if (!unicoPath.startsWith('/unico/')) {
		const e = new Error('Path must start with /unico/')
		/** @type {any} */ (e).code = 'PIXELHUE_PATH'
		throw e
	}
	const url = `${c.baseUrl}${unicoPath}`
	/** @type {Record<string, string>} */
	const headers = { Authorization: c.token, Accept: 'application/json' }
	const body =
		jsonBody === undefined || method === 'GET' || method === 'HEAD' ? null : jsonBody
	const res = await httpRequest(url, { method, headers, body: body != null ? body : undefined, httpsInsecure: false })
	return { statusCode: res.statusCode, json: res.json, raw: res.raw }
}

module.exports = {
	PATH,
	resolveConnection,
	unicoRequest,
	clearConnectionCache,
	configKey,
}
