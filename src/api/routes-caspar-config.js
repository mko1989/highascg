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
const { applyFullServerConfig } = require('../utils/full-config-apply')
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
	const def = String(defaults.casparServer?.configPath || '').trim() || '/home/casparcg/highascg/config/casparcg.config'
	const cp = String(cs.configPath || '').trim()
	cs.configPath = cp || def
}

/** Where generated XML is written for Apply / project sync.
 * Order: **saved** `casparServer.configPath` (Settings → System) → `CASPAR_CONFIG_PATH` env → default
 * `/home/casparcg/highascg/config/casparcg.config`. Relative paths resolve from the HighAsCG process cwd.
 *
 * @param {object} ctx
 * @returns {string}
 */
function resolveCasparConfigWritePath(ctx) {
	const fallback = String(defaults.casparServer?.configPath || '').trim() || '/home/casparcg/highascg/config/casparcg.config'
	const raw = ctx.config?.casparServer && String(ctx.config.casparServer.configPath || '').trim()
	if (raw) return toAbsoluteConfigPath(raw)
	const fromEnv = String(process.env.CASPAR_CONFIG_PATH || '').trim()
	if (fromEnv) return toAbsoluteConfigPath(fromEnv)
	return fallback
}

/**
 * Write generated casparcg.config XML to disk (no restart).
 *
 * @param {object} ctx
 * @returns {Promise<{ ok: boolean, status?: number, path?: string, error?: string, detail?: string, hint?: string }>}
 */
/**
 * @param {object} ctx
 * @param {{ xml?: string }} [opts] - one-shot XML from editor Apply (not persisted in settings)
 */
async function writeCasparConfigToDisk(ctx, opts = {}) {
	if (ctx.config?.offline_mode) {
		apiLog(ctx, 'warn', '[Caspar config] Write rejected: offline_mode is enabled')
		return {
			ok: false,
			status: 400,
			error: 'Offline preparation mode: use Download only, or disable offline mode to apply to a live server.',
		}
	}
	const filePath = resolveCasparConfigWritePath(ctx)
	if (!filePath) {
		apiLog(ctx, 'warn', '[Caspar config] Write aborted: could not resolve output path')
		return {
			ok: false,
			status: 400,
			error:
				'Set System → Caspar config path in Settings (saved in highascg.config.json), or CASPAR_CONFIG_PATH on the HighAsCG process when no path is saved.',
		}
	}
	apiLog(ctx, 'info', `[Caspar config] Writing casparcg.config → ${filePath}`)
	const oneShot = typeof opts.xml === 'string' ? opts.xml.trim() : ''
	const persistedOverride = String(ctx.config?.casparServer?.casparConfigOverride || '').trim()
	const xml = oneShot || persistedOverride || buildConfigXml(buildCasparGeneratorFlatConfig(ctx.config))
	if (oneShot) {
		apiLog(ctx, 'info', '[Caspar config] Using one-shot XML from config editor (not saved in settings)')
	} else if (persistedOverride) {
		apiLog(
			ctx,
			'warn',
			'[Caspar config] Using manual XML override (casparServer.casparConfigOverride) — generator DeckLink/keyer fixes are bypassed; clear override in Settings to use generated XML',
		)
	}
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
			return { ok: false, status: 403, error: 'Permission denied writing Caspar config file.', detail: msg, path: filePath, hint }
		}
		return { ok: false, status: 500, error: 'Failed to write Caspar config file.', detail: msg, path: filePath }
	}
	if (ctx.configManager && ctx.config.casparServer) {
		try {
			ctx.configManager.save(
				{
					...ctx.configManager.get(),
					casparServer: ctx.config.casparServer,
					audioRouting: ctx.config.audioRouting || defaults.audioRouting,
				},
				{ emitChange: !ctx._fullApplyInProgress },
			)
		} catch (_) {}
	}
	return { ok: true, path: filePath }
}

/**
 * @param {object} ctx
 * @param {{ skipCasparRestart?: boolean }} [opts]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
async function applyCasparConfigToDiskAndRestart(ctx, opts = {}) {
	apiLog(ctx, 'info', '[Caspar config] Full apply starting')
	const oneShotXml = typeof opts.xml === 'string' ? opts.xml.trim() : ''
	const writeHook = oneShotXml
		? (applyCtx) => writeCasparConfigToDisk(applyCtx, { xml: oneShotXml })
		: writeCasparConfigToDisk
	let fullApply
	ctx._fullApplyInProgress = true
	try {
		fullApply = await applyFullServerConfig(ctx, {
			log: (level, msg) => apiLog(ctx, level, msg),
			writeCasparConfig: writeHook,
			skipCasparRestart: opts.skipCasparRestart,
		})
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		apiLog(ctx, 'warn', `[Caspar config] Full apply failed: ${msg}`)
		return {
			status: 502,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: 'Full apply failed.',
				detail: msg,
			}),
		}
	} finally {
		delete ctx._fullApplyInProgress
	}

	if (fullApply.step === 'caspar_write' && fullApply.caspar) {
		return {
			status: fullApply.caspar.status || 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: fullApply.caspar.error,
				detail: fullApply.caspar.detail,
				path: fullApply.caspar.path,
				hint: fullApply.caspar.hint,
			}),
		}
	}

	return {
		status: fullApply.ok ? 200 : 502,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: fullApply.ok,
			error: fullApply.ok ? undefined : fullApply.message || `Full apply failed at ${fullApply.step || 'unknown'}`,
			path: fullApply.caspar?.path,
			restartSent: !!fullApply.casparRestart?.restartSent,
			disconnected: !!fullApply.casparRestart?.disconnected,
			reconnected: !!fullApply.casparRestart?.reconnected,
			layoutApplied: !!fullApply.layout?.postApplied,
			layoutPersisted: !!fullApply.layout?.persisted,
			needsNodmRestart: !!fullApply.layout?.needsNodmRestart,
			plannedCanvas: fullApply.layout?.plannedCanvas || null,
			currentCanvas: fullApply.layout?.currentCanvas || null,
			dmRestarted: !!fullApply.displayRestart?.nodmRestarted,
			displayStable: !!fullApply.displayRestart?.displayStable,
			xrandrCommand: fullApply.layout?.postXrandrCommand || fullApply.layout?.preXrandrCommand || null,
			fullApply,
			message: fullApply.message,
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
		const q = query || {}
		const override = String(ctx.config?.casparServer?.casparConfigOverride || '').trim()
		const xml = (q.effective === '1' && override) ? override : buildConfigXml(buildCasparGeneratorFlatConfig(ctx.config))
		const download = q.download === '1' || q.download === 'true'
		const headers = {
			'Content-Type': 'application/xml; charset=utf-8',
		}
		if (download) {
			headers['Content-Disposition'] = 'attachment; filename="casparcg.config"'
		}
		return { status: 200, headers, body: xml }
	}

	if (p === '/api/caspar-config/override') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ override: ctx.config?.casparServer?.casparConfigOverride || '' }),
		}
	}

	return null
}

/**
 * @param {string} p
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(p, body, ctx) {
	if (p === '/api/caspar-config/apply') {
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
		const skipCasparRestart =
			b.skipCasparRestart === true ||
			b.skipCasparRestart === 'true' ||
			b.skipDisplayRestart === true ||
			b.skipDisplayRestart === 'true'
		const xml = typeof b.xml === 'string' ? b.xml : ''
		return applyCasparConfigToDiskAndRestart(ctx, { skipCasparRestart, xml })
	}

	if (p === '/api/caspar-config/override') {
		const b = parseBody(body) || {}
		const override = typeof b.override === 'string' ? b.override : ''
		if (!ctx.config.casparServer) ctx.config.casparServer = { ...defaults.casparServer }
		ctx.config.casparServer.casparConfigOverride = override
		if (ctx.configManager) {
			ctx.configManager.save({ ...ctx.configManager.get(), casparServer: ctx.config.casparServer })
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	}

	return null
}

module.exports = {
	handleGet,
	handlePost,
	applyCasparConfigToDiskAndRestart,
	writeCasparConfigToDisk,
	resolveCasparConfigWritePath,
	normalizeCasparServerConfigPath,
}
