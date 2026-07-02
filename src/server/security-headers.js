'use strict'

/**
 * Security headers for static UI responses (WO-103 T103.5).
 * CSP is balanced for index.html import-map bootstrap + ES modules; templates are excluded in http-server.
 */

function isSecurityHeadersEnabled() {
	const v = String(process.env.HIGHASCG_CSP || '').trim().toLowerCase()
	if (v === '0' || v === 'false' || v === 'off') return false
	return true
}

function isCspReportOnly() {
	const v = String(process.env.HIGHASCG_CSP_REPORT_ONLY || '').trim().toLowerCase()
	return v === '1' || v === 'true' || v === 'on'
}

/**
 * @returns {string}
 */
function buildContentSecurityPolicy() {
	const directives = [
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'self'",
		"form-action 'self'",
		// importmap bootstrap + legacy innerHTML onerror thumb fallbacks
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"connect-src 'self' ws: wss: blob:",
		"worker-src 'self' blob:",
		"media-src 'self' blob:",
	]
	return directives.join('; ')
}

/**
 * @param {{ html?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
function buildSecurityHeaders(opts = {}) {
	/** @type {Record<string, string>} */
	const headers = {
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'strict-origin-when-cross-origin',
	}
	if (opts.html && isSecurityHeadersEnabled()) {
		const key = isCspReportOnly() ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy'
		headers[key] = buildContentSecurityPolicy()
	}
	return headers
}

/**
 * @param {Record<string, string>} existing
 * @param {{ html?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
function mergeSecurityHeaders(existing, opts = {}) {
	return { ...existing, ...buildSecurityHeaders(opts) }
}

module.exports = {
	buildContentSecurityPolicy,
	buildSecurityHeaders,
	mergeSecurityHeaders,
	isSecurityHeadersEnabled,
	isCspReportOnly,
}
