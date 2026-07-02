'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const {
	buildContentSecurityPolicy,
	buildSecurityHeaders,
	isSecurityHeadersEnabled,
} = require('../../src/server/security-headers')
const { serveWebApp } = require('../../src/server/http-server')
const { REPO_ROOT } = require('../../src/repo-paths')

test('buildContentSecurityPolicy restricts object-src and allows same-origin modules', () => {
	const csp = buildContentSecurityPolicy()
	assert.match(csp, /default-src 'self'/)
	assert.match(csp, /object-src 'none'/)
	assert.match(csp, /script-src 'self' 'unsafe-inline'/)
	assert.match(csp, /connect-src 'self' ws: wss:/)
})

test('buildSecurityHeaders adds CSP only for HTML responses', () => {
	const prev = process.env.HIGHASCG_CSP
	delete process.env.HIGHASCG_CSP
	try {
		const html = buildSecurityHeaders({ html: true })
		assert.ok(html['Content-Security-Policy'])
		assert.equal(html['X-Content-Type-Options'], 'nosniff')

		const js = buildSecurityHeaders({ html: false })
		assert.equal(js['Content-Security-Policy'], undefined)
		assert.equal(js['X-Content-Type-Options'], 'nosniff')
	} finally {
		if (prev === undefined) delete process.env.HIGHASCG_CSP
		else process.env.HIGHASCG_CSP = prev
	}
})

test('HIGHASCG_CSP=0 disables CSP header', () => {
	const prev = process.env.HIGHASCG_CSP
	process.env.HIGHASCG_CSP = '0'
	try {
		assert.equal(isSecurityHeadersEnabled(), false)
		const h = buildSecurityHeaders({ html: true })
		assert.equal(h['Content-Security-Policy'], undefined)
	} finally {
		if (prev === undefined) delete process.env.HIGHASCG_CSP
		else process.env.HIGHASCG_CSP = prev
	}
})

test('serveWebApp attaches CSP to index.html shell', async () => {
	const webDir = path.join(REPO_ROOT, 'client')
	const res = await serveWebApp('/', { webDir })
	assert.equal(res.status, 200)
	assert.match(String(res.body), /HighAsCG/)
	assert.ok(res.headers['Content-Security-Policy'])
	assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
})
