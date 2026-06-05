'use strict'

const { isHeadlessMode } = require('./headless-mode')

/** @type {Record<string, string>} */
const BASE = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

/** Default UI dev origins when headless + split dev (Vite). */
const DEFAULT_DEV_ORIGINS = [
	'http://localhost:3000',
	'http://127.0.0.1:3000',
	'http://localhost:5173',
	'http://127.0.0.1:5173',
]

/** Vite `host: true` — allow UI from LAN IPs on dev ports. */
function isLanDevUiOrigin(origin) {
	return /^https?:\/\/[^/]+:(3000|5173)$/.test(String(origin || ''))
}

/** @returns {string[]} */
function parseAllowedOrigins() {
	const raw = process.env.HIGHASCG_CORS_ORIGINS
	if (raw != null && String(raw).trim() !== '') {
		return String(raw)
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	}
	if (isHeadlessMode()) return [...DEFAULT_DEV_ORIGINS]
	return []
}

/**
 * @param {import('http').IncomingMessage | null | undefined} [req]
 * @returns {Record<string, string>}
 */
function corsHeadersForRequest(req) {
	const allowed = parseAllowedOrigins()
	const origin = req?.headers?.origin ? String(req.headers.origin) : ''
	if (!origin || origin === 'null') {
		return { ...BASE }
	}
	if (allowed.length > 0 && (allowed.includes(origin) || (isHeadlessMode() && isLanDevUiOrigin(origin)))) {
		return {
			'Access-Control-Allow-Origin': origin,
			'Access-Control-Allow-Methods': BASE['Access-Control-Allow-Methods'],
			'Access-Control-Allow-Headers': BASE['Access-Control-Allow-Headers'],
			Vary: 'Origin',
		}
	}
	if (isHeadlessMode() && allowed.length > 0) {
		return { ...BASE, 'Access-Control-Allow-Origin': allowed[0] }
	}
	return { ...BASE }
}

function corsHeaders() {
	return { ...BASE }
}

/**
 * @param {Record<string, string> | undefined} [extra]
 * @param {import('http').IncomingMessage | null | undefined} [req]
 */
function mergeCors(extra, req) {
	return { ...corsHeadersForRequest(req), ...(extra || {}) }
}

module.exports = { BASE, corsHeaders, corsHeadersForRequest, mergeCors, parseAllowedOrigins }
