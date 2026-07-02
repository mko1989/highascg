'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const {
	isEnforceAuthActive,
	getExpectedApiToken,
	secureCompare,
	extractAuthTokenFromRequest,
	sessionCookieHeader,
	clearSessionCookieHeader,
} = require('../server/auth')

function isSecureRequest(req) {
	const xf = req?.headers?.['x-forwarded-proto']
	if (xf && String(xf).toLowerCase() === 'https') return true
	return false
}

async function handleGet(path, ctx, req) {
	if (path !== '/api/auth/status') return null
	const expected = getExpectedApiToken(ctx?.config)
	const provided = extractAuthTokenFromRequest(req)
	const authenticated = !!(expected && provided && secureCompare(provided, expected))
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			enforceAuth: isEnforceAuthActive(ctx?.config),
			hasToken: !!expected,
			authenticated,
		}),
	}
}

async function handlePost(path, body, ctx, req) {
	if (path === '/api/auth/login') {
		if (!isEnforceAuthActive(ctx?.config)) {
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, enforceAuth: false }),
			}
		}
		const expected = getExpectedApiToken(ctx?.config)
		if (!expected) {
			return {
				status: 503,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: 'API token not configured on server.' }),
			}
		}
		const b = parseBody(body)
		const provided = String(b?.token || b?.password || '').trim()
		if (!provided || !secureCompare(provided, expected)) {
			return {
				status: 401,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: 'Invalid token.' }),
			}
		}
		return {
			status: 200,
			headers: {
				...JSON_HEADERS,
				'Set-Cookie': sessionCookieHeader(expected, { secure: isSecureRequest(req) }),
			},
			body: jsonBody({ ok: true }),
		}
	}
	if (path === '/api/auth/logout') {
		return {
			status: 200,
			headers: {
				...JSON_HEADERS,
				'Set-Cookie': clearSessionCookieHeader({ secure: isSecureRequest(req) }),
			},
			body: jsonBody({ ok: true }),
		}
	}
	return null
}

module.exports = { handleGet, handlePost }
