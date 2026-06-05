'use strict'

const moduleRegistry = require('../module-registry')

const PLUGIN_CATALOG = [
	{
		id: 'previs',
		name: 'Previs',
		moduleName: 'previs',
		legacyEnabled: (config) => {
			const envFlag = process.env.HIGHASCG_PREVIS
			return isTruthy(envFlag) || config?.features?.previs3d === true
		},
	},
	{
		id: 'tracking',
		name: 'Tracking',
		moduleName: 'tracking',
		legacyEnabled: (config) => {
			const envFlag = process.env.HIGHASCG_PREVIS
			return isTruthy(envFlag) || config?.features?.previs3d === true
		},
	},
	{
		id: 'autofollow',
		name: 'Auto Follow',
		moduleName: 'autofollow',
		legacyEnabled: (config) => {
			const envFlag = process.env.HIGHASCG_PREVIS
			return isTruthy(envFlag) || config?.features?.previs3d === true
		},
	},
	{
		id: 'cg-studio',
		name: 'Template Editor',
		moduleName: 'cg-studio',
		legacyEnabled: (config) => {
			const envFlag = process.env.HIGHASCG_CG_STUDIO
			return isTruthy(envFlag) || config?.features?.cgStudio === true
		},
	},
]

function isTruthy(v) {
	return v === '1' || String(v || '').toLowerCase() === 'true'
}

function isValidPluginId(id) {
	return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(String(id || ''))
}

function isValidModuleName(name) {
	return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(String(name || ''))
}

function validatePluginInput(input, mode) {
	const payload = input && typeof input === 'object' ? input : {}
	const errors = []
	const out = {}
	if (mode === 'add') {
		out.id = String(payload.id || '').trim()
		out.moduleName = String(payload.moduleName || out.id).trim()
		out.name = String(payload.name || out.id).trim() || out.id
		out.enabled = payload.enabled !== false
		out.source = String(payload.source || 'local').trim() || 'local'
		out.version = String(payload.version || '').trim()
		out.repoUrl = String(payload.repoUrl || '').trim()
		out.pinnedRef = String(payload.pinnedRef || '').trim()
		if (!out.id) errors.push('id is required')
		else if (!isValidPluginId(out.id)) errors.push('id has invalid format')
		if (!isValidModuleName(out.moduleName)) errors.push('moduleName has invalid format')
		if (!['local', 'bundled', 'github'].includes(out.source)) errors.push('source must be local, bundled, or github')
	} else if (mode === 'update') {
		out.version = String(payload.version || '').trim()
		out.repoUrl = String(payload.repoUrl || '').trim()
		out.pinnedRef = String(payload.pinnedRef || '').trim()
		if (payload.source !== undefined) {
			out.source = String(payload.source || '').trim()
			if (!['local', 'bundled', 'github'].includes(out.source)) errors.push('source must be local, bundled, or github')
		}
		if (payload.moduleName !== undefined) {
			out.moduleName = String(payload.moduleName || '').trim()
			if (!isValidModuleName(out.moduleName)) errors.push('moduleName has invalid format')
		}
	}
	return { ok: errors.length === 0, errors, value: out }
}

function normalizeStore(config) {
	if (!config || typeof config !== 'object') return { entries: {} }
	const src = config.plugins && typeof config.plugins === 'object' ? config.plugins : {}
	const entries = src.entries && typeof src.entries === 'object' ? src.entries : {}
	return { ...src, entries: { ...entries } }
}

function getEntry(config, id) {
	const store = normalizeStore(config)
	const e = store.entries[id]
	return e && typeof e === 'object' ? { ...e } : null
}

function setEntry(config, id, patch) {
	const next = normalizeStore(config)
	next.entries[id] = { ...(next.entries[id] || {}), ...patch, id }
	return next
}

function getKnownPluginIds() {
	return PLUGIN_CATALOG.map((x) => x.id)
}

function listPlugins(config) {
	const store = normalizeStore(config)
	const out = []
	for (const item of PLUGIN_CATALOG) {
		const entry = getEntry(config, item.id)
		const enabled =
			typeof entry?.enabled === 'boolean'
				? entry.enabled
				: typeof item.legacyEnabled === 'function'
					? !!item.legacyEnabled(config)
					: false
		const loaded = moduleRegistry.isLoaded(item.moduleName)
		out.push({
			id: item.id,
			name: item.name,
			moduleName: item.moduleName,
			enabled,
			loaded,
			source: entry?.source || 'bundled',
			version: entry?.version || '',
			repoUrl: entry?.repoUrl || '',
			pinnedRef: entry?.pinnedRef || '',
			status: enabled ? (loaded ? 'enabled' : 'error') : 'disabled',
		})
	}
	for (const [id, entry] of Object.entries(store.entries)) {
		if (PLUGIN_CATALOG.some((x) => x.id === id)) continue
		const moduleName = String(entry.moduleName || id)
		const loaded = moduleRegistry.isLoaded(moduleName)
		const enabled = entry.enabled !== false
		out.push({
			id,
			name: entry.name || id,
			moduleName,
			enabled,
			loaded,
			source: entry.source || 'local',
			version: entry.version || '',
			repoUrl: entry.repoUrl || '',
			pinnedRef: entry.pinnedRef || '',
			status: enabled ? (loaded ? 'enabled' : 'not-installed') : 'disabled',
		})
	}
	return out
}

function resolvePlugin(config, id) {
	const listed = listPlugins(config)
	return listed.find((p) => p.id === id) || null
}

function loadEnabledPlugins(config, log) {
	const items = listPlugins(config)
	for (const p of items) {
		if (!p.enabled) {
			if (log) log('info', `[plugins] "${p.id}" disabled`)
			continue
		}
		const ok = moduleRegistry.tryLoad(p.moduleName, log)
		if (!ok && log) log('warn', `[plugins] "${p.id}" failed to load module "${p.moduleName}"`)
	}
}

function enablePluginNow(config, id, ctx) {
	const p = resolvePlugin(config, id)
	if (!p) return { ok: false, error: 'not_found' }
	const log = ctx && typeof ctx.log === 'function' ? ctx.log : null
	const loaded = moduleRegistry.isLoaded(p.moduleName) || moduleRegistry.tryLoad(p.moduleName, log)
	if (!loaded) {
		return { ok: false, error: 'load_failed' }
	}
	const booted = moduleRegistry.bootOne(p.moduleName, ctx)
	return { ok: !!booted, error: booted ? '' : 'boot_failed' }
}

async function disablePluginNow(config, id, ctx) {
	const p = resolvePlugin(config, id)
	if (!p) return { ok: false, error: 'not_found' }
	const log = ctx && typeof ctx.log === 'function' ? ctx.log : null
	const shutdownOk = await moduleRegistry.shutdownOne(p.moduleName, log)
	const unloaded = moduleRegistry.tryUnload(p.moduleName, log)
	return {
		ok: shutdownOk && unloaded,
		shutdownOk,
		unloaded,
		requiresRestart: false,
		requiresBrowserRefresh: true,
	}
}

module.exports = {
	getKnownPluginIds,
	normalizeStore,
	setEntry,
	listPlugins,
	loadEnabledPlugins,
	enablePluginNow,
	disablePluginNow,
	validatePluginInput,
}

