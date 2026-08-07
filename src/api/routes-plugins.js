'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const pluginManager = require('../plugins/plugin-manager')

function persistPlugins(ctx, pluginsState) {
	if (!ctx || !ctx.configManager) return false
	const cur = ctx.configManager.get()
	return ctx.configManager.save({ ...cur, plugins: pluginsState })
}

function list(ctx) {
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			plugins: pluginManager.listPlugins(ctx?.config || {}),
		}),
	}
}

function handleGet(method, p, ctx) {
	if (method !== 'GET' || p !== '/api/plugins') return null
	return list(ctx)
}

async function handlePost(method, p, body, ctx) {
	if (method !== 'POST') return null

	if (p === '/api/plugins/add') {
		const payload = parseBody(body)
		const validation = pluginManager.validatePluginInput(payload, 'add')
		if (!validation.ok) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: validation.errors.join('; ') }),
			}
		}
		const data = validation.value
		const id = data.id
		const pluginsState = pluginManager.setEntry(ctx.config, id, {
			...data,
		})
		ctx.config.plugins = pluginsState
		persistPlugins(ctx, pluginsState)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				note: 'Plugin added. Enable/load may require restart if module files are not present yet.',
				plugins: pluginManager.listPlugins(ctx?.config || {}),
			}),
		}
	}

	const m = p.match(/^\/api\/plugins\/([^/]+)\/(enable|disable|update)$/)
	if (!m) return null
	const id = decodeURIComponent(m[1])
	const action = m[2]
	const payload = parseBody(body) || {}

	if (action === 'enable' || action === 'disable') {
		const pluginsState = pluginManager.setEntry(ctx.config, id, {
			enabled: action === 'enable',
		})
		ctx.config.plugins = pluginsState
		persistPlugins(ctx, pluginsState)
		if (action === 'enable') {
			const runtime = pluginManager.enablePluginNow(ctx.config, id, ctx)
			return {
				status: runtime.ok ? 200 : 409,
				headers: JSON_HEADERS,
				body: jsonBody({
					ok: runtime.ok,
					error: runtime.ok ? undefined : runtime.error || 'enable_failed',
					requiresRestart: runtime.ok ? false : true,
					note: runtime.ok
						? 'Plugin enabled and loaded.'
						: 'Plugin marked enabled but could not load at runtime; restart may be required.',
					plugins: pluginManager.listPlugins(ctx?.config || {}),
				}),
			}
		}
		const runtime = await pluginManager.disablePluginNow(ctx.config, id, ctx)
		return {
			status: runtime.ok ? 200 : 409,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: runtime.ok,
				error: runtime.ok ? undefined : 'disable_failed',
				requiresRestart: runtime.requiresRestart === true,
				requiresBrowserRefresh: runtime.requiresBrowserRefresh === true,
				note: runtime.ok
					? 'Plugin disabled and unloaded from server runtime. Browser refresh may be needed to remove already-loaded UI assets.'
					: 'Plugin marked disabled, but runtime shutdown/unload did not fully complete.',
				plugins: pluginManager.listPlugins(ctx?.config || {}),
			}),
		}
	}

	const updateValidation = pluginManager.validatePluginInput(payload, 'update')
	if (!updateValidation.ok) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: updateValidation.errors.join('; ') }),
		}
	}
	const pluginsState = pluginManager.setEntry(ctx.config, id, {
		...updateValidation.value,
		lastUpdateAt: new Date().toISOString(),
	})
	ctx.config.plugins = pluginsState
	persistPlugins(ctx, pluginsState)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			note: 'Metadata updated. Remote fetch/sync is not implemented yet.',
			plugins: pluginManager.listPlugins(ctx?.config || {}),
		}),
	}
}

module.exports = {
	handleGet,
	handlePost,
}

