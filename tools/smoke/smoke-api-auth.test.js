'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const auth = require('../../src/server/auth')
const { redactObject } = require('../../src/support/redact-settings')
const { extractZipSafely } = require('../../src/utils/safe-unzip')
const { routeRequest } = require('../../src/api/router')
const { corsHeadersForRequest } = require('../../src/server/cors')

function mockReq({ authorization = '', cookie = '', url = '/api/settings' } = {}) {
	return {
		url,
		headers: {
			authorization,
			cookie,
		},
	}
}

test.after(() => {
	auth.setAuthRuntime({ enforceAuth: false })
})

test('checkHttpAuth allows requests when enforcement is off', () => {
	auth.setAuthRuntime({ enforceAuth: false })
	const r = auth.checkHttpAuth('GET', '/api/settings', mockReq(), { config: {} })
	assert.equal(r.ok, true)
})

test('checkHttpAuth returns 401 without token when enforcement is on', () => {
	auth.setAuthRuntime({ enforceAuth: true })
	const token = 'test-token-' + 'a'.repeat(40)
	const r = auth.checkHttpAuth('POST', '/api/system/setup/reboot', mockReq(), {
		config: { security: { apiToken: token } },
	})
	assert.equal(r.ok, false)
	assert.equal(r.status, 401)
})

test('checkHttpAuth accepts Bearer token when enforcement is on', () => {
	auth.setAuthRuntime({ enforceAuth: true })
	const token = 'bearer-token-' + 'c'.repeat(40)
	const r = auth.checkHttpAuth('GET', '/api/settings', mockReq({ authorization: `Bearer ${token}` }), {
		config: { security: { apiToken: token } },
	})
	assert.equal(r.ok, true)
})

test('isPublicApiPath allows auth status and login', () => {
	assert.equal(auth.isPublicApiPath('GET', '/api/auth/status'), true)
	assert.equal(auth.isPublicApiPath('POST', '/api/auth/login'), true)
	assert.equal(auth.isPublicApiPath('GET', '/api/settings'), false)
})

test('resolveServerBindAddress uses loopback when auth enforced without network exposure', () => {
	auth.setAuthRuntime({ enforceAuth: true })
	const addr = auth.resolveServerBindAddress(
		{ server: { bindAddress: '0.0.0.0' }, security: { exposeToNetwork: false } },
		null,
	)
	assert.equal(addr, '127.0.0.1')
})

test('redactObject masks nuclearPassword in settings-shaped payload', () => {
	const out = redactObject({
		ui: { nuclearPassword: 'secret', nuclearRequirePassword: true },
		security: { apiToken: 'tok' },
	})
	assert.equal(out.ui.nuclearPassword, '[REDACTED]')
	assert.equal(out.security.apiToken, '[REDACTED]')
})

test('checkWebSocketAuth rejects missing token when enforcement is on', () => {
	auth.setAuthRuntime({ enforceAuth: true })
	const token = 'ws-token-' + 'e'.repeat(40)
	const ctx = { config: { security: { apiToken: token } } }
	const r = auth.checkWebSocketAuth(mockReq(), ctx)
	assert.equal(r.ok, false)
	assert.equal(r.status, 401)
	const ok = auth.checkWebSocketAuth(mockReq({ authorization: `Bearer ${token}` }), ctx)
	assert.equal(ok.ok, true)
})

test('cors omits wildcard origin for foreign origin when auth enforced', () => {
	auth.setAuthRuntime({ enforceAuth: true })
	const h = corsHeadersForRequest({
		headers: { origin: 'https://evil.example', host: '127.0.0.1:4200' },
	})
	assert.notEqual(h['Access-Control-Allow-Origin'], '*')
	assert.equal(h['Access-Control-Allow-Origin'], undefined)
})

test('routeRequest returns 401 without token when auth enforced', async () => {
	auth.setAuthRuntime({ enforceAuth: true })
	const token = 'route-' + 'f'.repeat(40)
	const ctx = {
		config: {
			security: { apiToken: token },
			caspar: { host: '127.0.0.1', port: 5250 },
			server: { httpPort: 4200, bindAddress: '127.0.0.1' },
		},
	}
	const denied = await routeRequest('GET', '/api/logs', '', ctx, mockReq())
	assert.equal(denied.status, 401)
	const ok = await routeRequest('GET', '/api/logs', '', ctx, mockReq({ authorization: `Bearer ${token}` }))
	assert.equal(ok.status, 200)
})

test('extractZipSafely rejects zip-slip paths', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-slip-'))
	const { execSync } = require('child_process')
	try {
		execSync('zip -q evil.zip "../../../tmp/evil.txt"', { cwd: dir, stdio: 'ignore' })
	} catch {
		fs.rmSync(dir, { recursive: true, force: true })
		return
	}
	await assert.rejects(
		() => extractZipSafely(path.join(dir, 'evil.zip'), path.join(dir, 'out')),
		/zip slip blocked/,
	)
	fs.rmSync(dir, { recursive: true, force: true })
})
