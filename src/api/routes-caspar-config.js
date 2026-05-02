/**
 * Generated CasparCG configuration: preview XML, download, apply on same host (write + RESTART).
 */

'use strict'

const fs = require('fs').promises
const path = require('path')
const defaults = require('../config/defaults')
const { buildConfigXml, normalizeAudioRouting } = require('../config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../config/build-caspar-generator-config')
const { getStandardModeChoices } = require('../config/config-modes')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

/**
 * @param {object} ctx
 * @param {'info'|'warn'|'error'|'debug'} level
 * @param {string} msg
 */
function apiLog(ctx, level, msg) {
	if (ctx && typeof ctx.log === 'function') ctx.log(level, msg)
}

/**
 * @param {string} p - trimmed non-empty path from settings or env
 * @returns {string}
 */
function toAbsoluteConfigPath(p) {
	if (path.isAbsolute(p)) return p
	return path.resolve(process.cwd(), p)
}

/**
 * Persisted `configPath: ""` would otherwise mask the default. Ensures Apply and GET /api/settings
 * agree on the effective path.
 *
 * @param {Record<string, unknown>} cs
 */
function normalizeCasparServerConfigPath(cs) {
	if (!cs || typeof cs !== 'object') return
	const def = String(defaults.casparServer?.configPath || '').trim() || '/opt/casparcg/config/casparcg.config'
	const cp = String(cs.configPath || '').trim()
	cs.configPath = cp || def
}

/** Max time to wait for AMCP TCP after writing config (Caspar may still be booting). Env: HIGHASCG_CASPAR_CONFIG_RESTART_WAIT_MS */
function resolveCasparRestartWaitMs() {
	const raw = process.env.HIGHASCG_CASPAR_CONFIG_RESTART_WAIT_MS
	if (raw === undefined || raw === '') return 15_000
	const n = parseInt(String(raw), 10)
	if (!Number.isFinite(n) || n < 0) return 15_000
	return Math.min(n, 120_000)
}

/**
 * `ctx.amcp` is always set when Caspar is enabled, but TCP may be down (Caspar stopped, restarting, or wrong host/port).
 * @param {object} ctx
 * @returns {boolean}
 */
function isAmcpTcpConnected(ctx) {
	return !!(ctx.casparConnection?.tcp?.isConnected)
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {object} ctx
 * @param {number} maxMs
 * @param {number} [pollMs]
 */
async function waitForAmcpTcp(ctx, maxMs, pollMs = 400) {
	const t0 = Date.now()
	while (Date.now() - t0 < maxMs) {
		if (isAmcpTcpConnected(ctx)) return true
		await sleep(pollMs)
	}
	return isAmcpTcpConnected(ctx)
}

/**
 * Where generated XML is written for Apply / project sync.
 * Order: **saved** `casparServer.configPath` (Settings → System) → `CASPAR_CONFIG_PATH` env → default
 * `/opt/casparcg/config/casparcg.config`. Relative paths resolve from the HighAsCG process cwd.
 *
 * @param {object} ctx
 * @returns {string}
 */
function resolveCasparConfigWritePath(ctx) {
	const fallback = String(defaults.casparServer?.configPath || '').trim() || '/opt/casparcg/config/casparcg.config'
	const raw = ctx.config?.casparServer && String(ctx.config.casparServer.configPath || '').trim()
	if (raw) return toAbsoluteConfigPath(raw)
	const fromEnv = String(process.env.CASPAR_CONFIG_PATH || '').trim()
	if (fromEnv) return toAbsoluteConfigPath(fromEnv)
	return fallback
}

/**
 * @param {object} ctx
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
async function applyCasparConfigToDiskAndRestart(ctx) {
	if (ctx.config?.offline_mode) {
		apiLog(ctx, 'warn', '[Caspar config] Apply rejected: offline_mode is enabled')
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: 'Offline preparation mode: use Download only, or disable offline mode to apply to a live server.',
			}),
		}
	}
	const filePath = resolveCasparConfigWritePath(ctx)
	if (!filePath) {
		apiLog(ctx, 'warn', '[Caspar config] Apply aborted: could not resolve output path')
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error:
					'Set System → Caspar config path in Settings (saved in highascg.config.json), or CASPAR_CONFIG_PATH on the HighAsCG process when no path is saved.',
			}),
		}
	}
	apiLog(ctx, 'info', `[Caspar config] Writing generated casparcg.config → ${filePath}`)
	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(ctx.config))
	const dir = path.dirname(filePath)
	try {
		await fs.mkdir(dir, { recursive: true })
		await fs.writeFile(filePath, xml, 'utf8')
		apiLog(ctx, 'info', `[Caspar config] Saved ${filePath} (${xml.length} bytes)`)
	} catch (e) {
		const code = e && e.code
		const msg = e instanceof Error ? e.message : String(e)
		const hint =
			'The HighAsCG process must be allowed to create/write this path. Run it as a user that owns the Caspar config directory, or use sudo chown on the directory. If no path is saved in Settings, CASPAR_CONFIG_PATH can point to a writable file (e.g. under /tmp for testing).'
		apiLog(ctx, 'error', `[Caspar config] Write failed (${filePath}): ${msg}`)
		if (code === 'EACCES' || code === 'EPERM') {
			return {
				status: 403,
				headers: JSON_HEADERS,
				body: jsonBody({
					error: 'Permission denied writing Caspar config file.',
					detail: msg,
					path: filePath,
					hint,
				}),
			}
		}
		return {
			status: 500,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: 'Failed to write Caspar config file.',
				detail: msg,
				path: filePath,
			}),
		}
	}
	if (ctx.configManager && ctx.config.casparServer) {
		try {
			ctx.configManager.save({
				...ctx.configManager.get(),
				casparServer: ctx.config.casparServer,
				audioRouting: ctx.config.audioRouting || defaults.audioRouting,
			})
		} catch (_) {}
	}

	if (!ctx.amcp) {
		apiLog(ctx, 'warn', '[Caspar config] File written; AMCP RESTART skipped (no AMCP client — e.g. --no-caspar)')
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				path: filePath,
				restartSent: false,
				message:
					'Config file written. Caspar AMCP is disabled, so RESTART was not sent — restart Caspar manually so it loads this file.',
			}),
		}
	}

	let tcpUp = isAmcpTcpConnected(ctx)
	if (!tcpUp) {
		const waitMs = resolveCasparRestartWaitMs()
		if (waitMs > 0) {
			apiLog(
				ctx,
				'info',
				`[Caspar config] AMCP TCP not connected (${ctx._casparStatus?.host ?? '?'}:${ctx._casparStatus?.port ?? '?'}) — waiting up to ${waitMs}ms before RESTART…`,
			)
			tcpUp = await waitForAmcpTcp(ctx, waitMs)
		}
	}
	if (!tcpUp) {
		apiLog(
			ctx,
			'warn',
			'[Caspar config] File written; AMCP TCP still down — RESTART skipped. Fix Settings → Connection (host/port) or start Caspar, then use Write & restart again or restart the Caspar service.',
		)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				path: filePath,
				restartSent: false,
				message:
					'Config file written. Caspar did not accept AMCP on the configured host/port, so RESTART was not sent. When Caspar is running and reachable, use Write & restart again or restart Caspar so it loads the file below.',
				hint:
					'Caspar only reads this XML after AMCP RESTART or a full process restart. Ensure systemd ExecStart (or manual launch) uses the same path as System → Caspar config path.',
			}),
		}
	}

	try {
		apiLog(ctx, 'info', '[Caspar config] Sending AMCP RESTART…')
		await ctx.amcp.query.restart()
		apiLog(ctx, 'info', '[Caspar config] AMCP RESTART completed')
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		if (/not connected/i.test(msg)) {
			apiLog(ctx, 'warn', `[Caspar config] RESTART failed: ${msg} (socket dropped between check and send)`)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({
					ok: true,
					path: filePath,
					restartSent: false,
					message:
						'Config file written. AMCP disconnected before RESTART completed — retry Write & restart when Caspar is stable.',
					detail: msg,
				}),
			}
		}
		apiLog(ctx, 'warn', `[Caspar config] AMCP RESTART failed after write: ${msg}`)
		return {
			status: 502,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: 'Config file written but Caspar RESTART failed.',
				detail: msg,
				path: filePath,
			}),
		}
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			path: filePath,
			restartSent: true,
			message: 'Config written; Caspar RESTART sent.',
		}),
	}
}

/**
 * @param {string} p
 * @param {Record<string, string>} query - from {@link parseQueryString}
 * @param {object} ctx
 */
function handleGet(p, query, ctx) {
	if (p === '/api/caspar-config/mode-choices') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ modes: getStandardModeChoices() }),
		}
	}

	if (p === '/api/caspar-config/generate') {
		const xml = buildConfigXml(buildCasparGeneratorFlatConfig(ctx.config))
		const q = query || {}
		const download = q.download === '1' || q.download === 'true'
		const headers = {
			'Content-Type': 'application/xml; charset=utf-8',
		}
		if (download) {
			headers['Content-Disposition'] = 'attachment; filename="casparcg.config"'
		}
		return { status: 200, headers, body: xml }
	}

	return null
}

/**
 * @param {string} p
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(p, body, ctx) {
	if (p !== '/api/caspar-config/apply') return null
	apiLog(ctx, 'info', '[Caspar config] POST /api/caspar-config/apply')
	const b = parseBody(body) || {}
	if (b.casparServer && typeof b.casparServer === 'object') {
		ctx.config.casparServer = {
			...(defaults.casparServer || {}),
			...(ctx.config.casparServer || {}),
			...b.casparServer,
		}
		normalizeCasparServerConfigPath(ctx.config.casparServer)
	}
	// Audio / OSC tab (ALSA devices, etc.) — must merge before buildConfigXml; apply used to send casparServer only.
	if (b.audioRouting && typeof b.audioRouting === 'object') {
		ctx.config.audioRouting = normalizeAudioRouting({
			...(defaults.audioRouting || {}),
			...(ctx.config.audioRouting || {}),
			...b.audioRouting,
		})
	}
	const overridePath = typeof b.path === 'string' ? b.path.trim() : ''
	if (overridePath) {
		ctx.config.casparServer = { ...(ctx.config.casparServer || defaults.casparServer || {}), configPath: overridePath }
		normalizeCasparServerConfigPath(ctx.config.casparServer)
	}
	return applyCasparConfigToDiskAndRestart(ctx)
}

module.exports = {
	handleGet,
	handlePost,
	applyCasparConfigToDiskAndRestart,
	resolveCasparConfigWritePath,
	normalizeCasparServerConfigPath,
}
