const path = require('path')
const fs = require('fs')
const { app } = require('electron')

const REGISTRY_PATH = path.join(__dirname, '../../lib/optional-modules-registry.json')

/** @type {string[] | null} */
let cachedEnabled = null

function loadRegistry() {
	try {
		const raw = fs.readFileSync(REGISTRY_PATH, 'utf8')
		const data = JSON.parse(raw)
		return Array.isArray(data.modules) ? data.modules : []
	} catch (e) {
		console.warn('[launcher-modules] Could not read registry:', e.message)
		return []
	}
}

/** Modules shown in the launcher Modules tab (excludes WIP / undeveloped). */
function getLauncherVisibleRegistry() {
	return loadRegistry().filter((m) => m.launcherHidden !== true)
}

function filterToLauncherVisibleIds(ids) {
	const visible = new Set(getLauncherVisibleRegistry().map((m) => m.id))
	return (Array.isArray(ids) ? ids : [])
		.map((id) => String(id || '').trim())
		.filter((id) => visible.has(id))
}

function prefsFilePath() {
	return path.join(app.getPath('userData'), 'launcher-optional-modules.json')
}

function defaultEnabledIds() {
	return getLauncherVisibleRegistry()
		.filter((m) => m.defaultEnabled)
		.map((m) => m.id)
}

function readPrefsFile() {
	try {
		const raw = fs.readFileSync(prefsFilePath(), 'utf8')
		const data = JSON.parse(raw)
		if (!Array.isArray(data.enabled)) return null
		return filterToLauncherVisibleIds(data.enabled)
	} catch {
		return null
	}
}

function getEnabledModuleIds() {
	if (cachedEnabled) return filterToLauncherVisibleIds(cachedEnabled)
	const fromFile = readPrefsFile()
	cachedEnabled = filterToLauncherVisibleIds(fromFile != null ? fromFile : defaultEnabledIds())
	return cachedEnabled.slice()
}

/** @param {string[]} enabledIds */
function setEnabledModuleIds(enabledIds) {
	cachedEnabled = filterToLauncherVisibleIds(enabledIds)
	try {
		fs.mkdirSync(path.dirname(prefsFilePath()), { recursive: true })
		fs.writeFileSync(prefsFilePath(), JSON.stringify({ enabled: cachedEnabled }, null, 2), 'utf8')
	} catch (e) {
		console.warn('[launcher-modules] Could not save prefs:', e.message)
	}
}

function getRegistryModules() {
	return getLauncherVisibleRegistry()
}

function buildModulesApiPayload() {
	const allowed = new Set(getEnabledModuleIds())
	const enabled = []
	const bundles = []
	const styles = []
	for (const mod of getLauncherVisibleRegistry()) {
		if (!allowed.has(mod.id)) continue
		enabled.push(mod.id)
		if (mod.bundle && !bundles.includes(mod.bundle)) bundles.push(mod.bundle)
		for (const href of mod.styles || []) {
			if (!styles.includes(href)) styles.push(href)
		}
	}
	return {
		enabled,
		bundles,
		styles,
		wsNamespaces: enabled.filter((id) => id !== 'cg-studio'),
	}
}

module.exports = {
	getEnabledModuleIds,
	setEnabledModuleIds,
	getRegistryModules,
	buildModulesApiPayload,
}
