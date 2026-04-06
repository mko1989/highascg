/**
 * Generated CasparCG configuration: preview XML, download, apply on same host (write + RESTART).
 */

'use strict'

const fs = require('fs').promises
const path = require('path')
const defaults = require('../../config/default')
const { buildConfigXml } = require('../config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../config/build-caspar-generator-config')
const { getStandardModeChoices } = require('../config/config-modes')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

/**
 * @param {object} ctx
 * @returns {string}
 */
function resolveCasparConfigWritePath(ctx) {
	const env = String(process.env.CASPAR_CONFIG_PATH || '').trim()
	if (env) return env
	const p = ctx.config?.casparServer && String(ctx.config.casparServer.configPath || '').trim()
	if (p) return p
	const d = String(defaults.casparServer?.configPath || '').trim()
	return d || '/opt/casparcg/config/casparcg.config'
}

/**
 * @param {object} ctx
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
async function applyCasparConfigToDiskAndRestart(ctx) {
	if (ctx.config?.offline_mode) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: 'Offline preparation mode: use Download only, or disable offline mode to apply to a live server.',
			}),
		}
	}
	if (!ctx.amcp) {
		return {
			status: 503,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Caspar not connected' }),
		}
	}
	const filePath = resolveCasparConfigWritePath(ctx)
	if (!filePath) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error:
					'Set Screens → Caspar config path on server, or CASPAR_CONFIG_PATH on the HighAsCG process, so the file can be written.',
			}),
		}
	}
	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(ctx.config))
	await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {})
	await fs.writeFile(filePath, xml, 'utf8')
	await ctx.amcp.query.restart()
	if (ctx.configManager && ctx.config.casparServer) {
		try {
			ctx.configManager.save({
				...ctx.configManager.get(),
				casparServer: ctx.config.casparServer,
			})
		} catch (_) {}
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, path: filePath, message: 'Config written; Caspar RESTART sent.' }),
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
	const b = parseBody(body) || {}
	if (b.casparServer && typeof b.casparServer === 'object') {
		ctx.config.casparServer = {
			...(defaults.casparServer || {}),
			...(ctx.config.casparServer || {}),
			...b.casparServer,
		}
	}
	const overridePath = typeof b.path === 'string' ? b.path.trim() : ''
	if (overridePath) {
		ctx.config.casparServer = { ...(ctx.config.casparServer || {}), configPath: overridePath }
	}
	return applyCasparConfigToDiskAndRestart(ctx)
}

module.exports = {
	handleGet,
	handlePost,
	applyCasparConfigToDiskAndRestart,
	resolveCasparConfigWritePath,
}
