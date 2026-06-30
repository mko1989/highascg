'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { checkNuclearPassword } = require('./routes-system-setup')
const {
	getTailscaleStatus,
	setTailscaleEnabled,
	startTailscaleLogin,
	spawnOperatorTailscaleLogin,
	saveTailscalePrefs,
	logoutTailscale,
	loadTailscaleConfig,
} = require('../network/tailscale-service')

/**
 * @param {string} path
 */
async function handleGet(path) {
	if (path !== '/api/network/tailscale/status') return null
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody(getTailscaleStatus({ includeConfig: true })),
	}
}

/**
 * @param {string} path
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	const routes = new Set([
		'/api/network/tailscale/enable',
		'/api/network/tailscale/login',
		'/api/network/tailscale/login-operator-ui',
		'/api/network/tailscale/prefs',
		'/api/network/tailscale/logout',
	])
	if (!routes.has(path)) return null

	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }

	const b = parseBody(body)

	if (path === '/api/network/tailscale/enable') {
		const enabled = b?.enabled === true || b?.enabled === 'true'
		const r = setTailscaleEnabled(enabled)
		if (!r.ok) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: r.error }) }
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, enabled, config: loadTailscaleConfig(), status: getTailscaleStatus() }),
		}
	}

	if (path === '/api/network/tailscale/prefs') {
		const config = saveTailscalePrefs({
			autoLoginOnBoot: b?.autoLoginOnBoot === true || b?.autoLoginOnBoot === 'true',
			hostname: b?.hostname != null ? String(b.hostname) : undefined,
			acceptRoutes: b?.acceptRoutes === true || b?.acceptRoutes === 'true',
			operatorLoginAssist: b?.operatorLoginAssist !== false && b?.operatorLoginAssist !== 'false',
		})
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, config }) }
	}

	if (path === '/api/network/tailscale/logout') {
		const r = logoutTailscale()
		if (!r.ok) return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: r.error }) }
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, status: getTailscaleStatus() }) }
	}

	if (path === '/api/network/tailscale/login') {
		const login = await startTailscaleLogin(loadTailscaleConfig())
		if (!login.ok) return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: login.error }) }
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, ...login, status: getTailscaleStatus() }),
		}
	}

	if (path === '/api/network/tailscale/login-operator-ui') {
		const stNow = getTailscaleStatus()
		if (stNow.connected) {
			const adminUrl = stNow.adminUrl || 'https://login.tailscale.com/admin/machines'
			try {
				const spawned = spawnOperatorTailscaleLogin(adminUrl)
				return {
					status: 200,
					headers: JSON_HEADERS,
					body: jsonBody({
						ok: true,
						spawned: true,
						connected: true,
						authUrl: null,
						url: adminUrl,
						note: 'Already connected — opened Tailscale admin console on the operator monitor.',
						status: stNow,
						...spawned,
					}),
				}
			} catch (e) {
				return {
					status: 502,
					headers: JSON_HEADERS,
					body: jsonBody({
						error: e instanceof Error ? e.message : String(e),
						connected: true,
						note: 'Tailscale is connected; operator browser launch failed.',
						status: stNow,
					}),
				}
			}
		}

		let authUrl = String(b?.authUrl || '').trim()
		if (!authUrl) {
			const login = await startTailscaleLogin(loadTailscaleConfig())
			if (!login.ok) return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: login.error }) }
			authUrl = String(login.authUrl || '').trim()
		}
		if (!authUrl) {
			const st = getTailscaleStatus()
			if (st.connected) {
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, spawned: false, connected: true, status: st }) }
			}
			return {
				status: 409,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'No Tailscale auth URL yet — try Log in again in a few seconds.', status: st }),
			}
		}
		try {
			const spawned = spawnOperatorTailscaleLogin(authUrl)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, spawned: true, authUrl, ...spawned, status: getTailscaleStatus() }),
			}
		} catch (e) {
			return {
				status: 502,
				headers: JSON_HEADERS,
				body: jsonBody({ error: e instanceof Error ? e.message : String(e), authUrl }),
			}
		}
	}

	return null
}

module.exports = { handleGet, handlePost }
