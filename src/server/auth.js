'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

const TOKEN_FILE = path.join(REPO_ROOT, '.private', 'api-token')
const SESSION_COOKIE = 'highascg_session'
const TOKEN_BYTES = 32

/** @type {boolean | null} */
let _runtimeEnforceAuth = null

function truthyEnv(v) {
	if (v == null) return false
	const s = String(v).trim().toLowerCase()
	return s === '1' || s === 'true' || s === 'yes'
}

function getSecurityConfig(config) {
	const sec = config?.security && typeof config.security === 'object' ? config.security : {}
	return {
		enforceAuth: !!sec.enforceAuth,
		exposeToNetwork: sec.exposeToNetwork !== false,
		apiToken: String(sec.apiToken || '').trim(),
	}
}

function isEnforceAuthActive(config) {
	if (_runtimeEnforceAuth != null) return _runtimeEnforceAuth
	if (truthyEnv(process.env.HIGHASCG_ENFORCE_AUTH)) return true
	return getSecurityConfig(config).enforceAuth
}

/** @param {{ enforceAuth?: boolean }} opts */
function setAuthRuntime(opts = {}) {
	if (typeof opts.enforceAuth === 'boolean') _runtimeEnforceAuth = opts.enforceAuth
}

function secureCompare(a, b) {
	const left = Buffer.from(String(a || ''), 'utf8')
	const right = Buffer.from(String(b || ''), 'utf8')
	if (left.length !== right.length) return false
	return crypto.timingSafeEqual(left, right)
}

function readApiTokenFromFile() {
	try {
		if (!fs.existsSync(TOKEN_FILE)) return ''
		const raw = fs.readFileSync(TOKEN_FILE, 'utf8').trim()
		return raw
	} catch {
		return ''
	}
}

function writeApiTokenToFile(token) {
	const dir = path.dirname(TOKEN_FILE)
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
	fs.writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600, encoding: 'utf8' })
}

/**
 * Ensure a per-install API token exists when auth enforcement is active.
 * @param {{ config: object, log?: (level: string, msg: string) => void }} opts
 * @returns {string}
 */
function ensureApiToken(opts) {
	const config = opts?.config || {}
	const log = typeof opts?.log === 'function' ? opts.log : () => {}
	const sec = getSecurityConfig(config)
	let token = readApiTokenFromFile() || sec.apiToken
	if (!token && isEnforceAuthActive(config)) {
		token = crypto.randomBytes(TOKEN_BYTES).toString('hex')
		writeApiTokenToFile(token)
		log(
			'warn',
			`[auth] Generated API token in ${TOKEN_FILE} — run: bash tools/runtime/print-api-token.sh`,
		)
	}
	if (token && !readApiTokenFromFile() && sec.apiToken) {
		try {
			writeApiTokenToFile(token)
		} catch (e) {
			log('warn', `[auth] Could not persist api-token file: ${e?.message || e}`)
		}
	}
	return token
}

function getExpectedApiToken(config) {
	return readApiTokenFromFile() || getSecurityConfig(config).apiToken || ''
}

function parseCookies(req) {
	const raw = req?.headers?.cookie ? String(req.headers.cookie) : ''
	/** @type {Record<string, string>} */
	const out = {}
	for (const part of raw.split(';')) {
		const idx = part.indexOf('=')
		if (idx <= 0) continue
		const k = part.slice(0, idx).trim()
		const v = part.slice(idx + 1).trim()
		if (k) out[k] = decodeURIComponent(v)
	}
	return out
}

function extractBearerToken(req) {
	const h = req?.headers?.authorization ? String(req.headers.authorization) : ''
	const m = /^Bearer\s+(.+)$/i.exec(h.trim())
	return m ? m[1].trim() : ''
}

function extractAuthTokenFromRequest(req) {
	const bearer = extractBearerToken(req)
	if (bearer) return bearer
	const cookies = parseCookies(req)
	if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE]
	try {
		const url = new URL(req?.url || '/', 'http://127.0.0.1')
		const q = url.searchParams.get('token')
		if (q) return String(q).trim()
	} catch {
		/* ignore */
	}
	return ''
}

function isPublicApiPath(method, apiPath) {
	const m = String(method || 'GET').toUpperCase()
	const p = String(apiPath || '')
	if (m === 'GET' && p === '/api/auth/status') return true
	if (m === 'POST' && (p === '/api/auth/login' || p === '/api/auth/logout')) return true
	if (m === 'GET' && p === '/api/ping') return true
	return false
}

/**
 * @param {string} method
 * @param {string} apiPath path without query
 * @param {import('http').IncomingMessage | undefined} req
 * @param {object} ctx
 */
function checkHttpAuth(method, apiPath, req, ctx) {
	if (!isEnforceAuthActive(ctx?.config)) return { ok: true }
	if (isPublicApiPath(method, apiPath)) return { ok: true }
	const expected = getExpectedApiToken(ctx?.config)
	if (!expected) {
		return {
			ok: false,
			status: 503,
			error: 'API authentication is enabled but no API token is configured.',
		}
	}
	const provided = extractAuthTokenFromRequest(req)
	if (!provided || !secureCompare(provided, expected)) {
		return { ok: false, status: 401, error: 'Unauthorized' }
	}
	return { ok: true }
}

function checkWebSocketAuth(req, ctx) {
	if (!isEnforceAuthActive(ctx?.config)) return { ok: true }
	const expected = getExpectedApiToken(ctx?.config)
	if (!expected) return { ok: false, status: 503, error: 'Auth enabled without token' }
	const provided = extractAuthTokenFromRequest(req)
	if (!provided || !secureCompare(provided, expected)) {
		return { ok: false, status: 401, error: 'Unauthorized' }
	}
	return { ok: true }
}

function sessionCookieHeader(token, { secure = false } = {}) {
	const parts = [
		`${SESSION_COOKIE}=${encodeURIComponent(token)}`,
		'Path=/',
		'HttpOnly',
		'SameSite=Strict',
		'Max-Age=2592000',
	]
	if (secure) parts.push('Secure')
	return parts.join('; ')
}

function clearSessionCookieHeader({ secure = false } = {}) {
	const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']
	if (secure) parts.push('Secure')
	return parts.join('; ')
}

function resolveServerBindAddress(config, cliBindAddress) {
	if (cliBindAddress != null && String(cliBindAddress).trim()) {
		return String(cliBindAddress).trim()
	}
	if (process.env.BIND_ADDRESS) return String(process.env.BIND_ADDRESS).trim()
	if (!isEnforceAuthActive(config)) {
		return config?.server?.bindAddress || '0.0.0.0'
	}
	const sec = getSecurityConfig(config)
	if (sec.exposeToNetwork) {
		return config?.server?.bindAddress || '0.0.0.0'
	}
	return '127.0.0.1'
}

function validateExposurePolicy(config, log = () => {}) {
	if (!isEnforceAuthActive(config)) return true
	const sec = getSecurityConfig(config)
	const bind = resolveServerBindAddress(config)
	const token = getExpectedApiToken(config)
	if (!token) {
		log('error', '[auth] HIGHASCG_ENFORCE_AUTH is on but no API token exists — refusing network bind')
		return false
	}
	if (sec.exposeToNetwork && (bind === '0.0.0.0' || bind === '::')) {
		log('info', '[auth] Network exposure enabled with API token authentication')
	}
	return true
}

function isOriginAllowed(req, config) {
	if (!isEnforceAuthActive(config)) return true
	const origin = req?.headers?.origin ? String(req.headers.origin) : ''
	if (!origin || origin === 'null') return true
	const host = req?.headers?.host ? String(req.headers.host) : ''
	if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true
	const allowed = String(process.env.HIGHASCG_CORS_ORIGINS || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
	return allowed.includes(origin)
}

module.exports = {
	TOKEN_FILE,
	SESSION_COOKIE,
	setAuthRuntime,
	getSecurityConfig,
	isEnforceAuthActive,
	ensureApiToken,
	getExpectedApiToken,
	secureCompare,
	parseCookies,
	extractAuthTokenFromRequest,
	isPublicApiPath,
	checkHttpAuth,
	checkWebSocketAuth,
	sessionCookieHeader,
	clearSessionCookieHeader,
	resolveServerBindAddress,
	validateExposurePolicy,
	isOriginAllowed,
}
