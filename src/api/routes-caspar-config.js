/**
 * Generated CasparCG configuration: preview XML, download, apply on same host (write + RESTART).
 */

'use strict'

const fs = require('fs').promises
const path = require('path')
const defaults = require('../../config/default')
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
		apiLog(ctx, 'warn', '[Caspar config] File written; AMCP RESTART skipped (Caspar not connected)')
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				path: filePath,
				restartSent: false,
				message:
					'Config file written. Caspar is not connected (AMCP), so RESTART was not sent — start Caspar or reconnect, then restart it to load this file.',
			}),
		}
	}

	try {
		apiLog(ctx, 'info', '[Caspar config] Sending AMCP RESTART…')
		await ctx.amcp.query.restart()
		apiLog(ctx, 'info', '[Caspar config] AMCP RESTART completed')
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
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
