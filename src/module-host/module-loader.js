'use strict'

/**
 * WO-1076 — external modules: discovery, load, runtime enable / disable. docs/MODULES.md "External modules".
 *
 * A module is INSTALLED when `<dir>/<name>/module.json` exists in the repo `modules/` (dev checkout) or in
 * ~/.highascg/modules/ (POST /api/modules/install); the repo copy wins when both exist. It is ENABLED when
 * modules.json says so (module-state.js; default = manifest.defaultEnabled, false unless set). Installed-but-disabled
 * modules are never require()d. Loading = require `<dir>/<main>`; the export is a descriptor or a factory
 * `(host) => descriptor` (host.requireCore reaches core files / core npm deps from an installed copy, which cannot
 * resolve them by relative path). The descriptor goes into src/module-registry.js like an in-tree module, so every
 * hook (routes, public paths, WS, static, boot / shutdown) is dispatched there; disable = onShutdown + unregister +
 * the module's files dropped from the require cache, so a re-enable (or an upgrade) loads fresh code.
 */

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const moduleRegistry = require('../module-registry')
const { repoModulesDir, installedModulesDir } = require('./module-paths')
const { readManifest, isValidModuleName, satisfiesCore, coreVersion } = require('./module-manifest')
const { readModulesState, setModuleEnabled } = require('./module-state')
const { isAllowedMountPrefix } = require('./module-static')

/** Core API families a module may never claim (its prefix may not be one of these or below one). */
const RESERVED_API = ['/api/modules', '/api/plugins', '/api/auth', '/api/settings', '/api/config', '/api/system', '/api/ws', '/api/ping', '/api/cluster', '/api/replication']
const API_PREFIX_RE = /^\/api\/[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9._-]*)*$/

let _chain = Promise.resolve()
/** Run enable / disable / install / uninstall one at a time. @template T @param {() => Promise<T>|T} fn @returns {Promise<T>} */
function serial(fn) {
	const p = _chain.then(fn, fn)
	_chain = p.catch(() => {})
	return p
}

/** Names the in-tree registry / plugin catalog already uses (src/<name>/register.js) — never shadowed. */
function isInTreeName(name) {
	if (require('../plugins/plugin-manager').getKnownPluginIds().includes(name)) return true
	return fs.existsSync(path.join(REPO_ROOT, 'src', name, 'register.js'))
}

/** @param {string} root @param {'repo'|'installed'} kind */
function scanDir(root, kind) {
	let names
	try {
		names = fs.readdirSync(root, { withFileTypes: true })
	} catch {
		return [] // no modules dir: the lean base install
	}
	const out = []
	for (const d of names) {
		if (d.name.startsWith('.')) continue // .staging-* / .old-* of a running install
		const dir = path.join(root, d.name)
		// installed copies are plain directories (the installer never writes links); a dev checkout may symlink one in
		const isDir = d.isDirectory() || (kind === 'repo' && d.isSymbolicLink() && safeIsDir(dir))
		if (!isDir) continue
		if (!isValidModuleName(d.name)) {
			out.push({ name: d.name, kind, dir, manifest: null, error: 'directory name is not a valid module name' })
			continue
		}
		const r = readManifest(dir)
		let error = r.ok ? null : r.error
		if (r.ok && r.manifest.name !== d.name) error = `module.json name "${r.manifest.name}" does not match directory "${d.name}"`
		else if (!error && isInTreeName(d.name)) error = `"${d.name}" is an in-tree module name`
		out.push({ name: d.name, kind, dir, manifest: r.ok ? r.manifest : null, error })
	}
	return out
}

function safeIsDir(p) {
	try {
		return fs.statSync(p).isDirectory()
	} catch {
		return false
	}
}

/** @returns {Array<{ name: string, kind: 'repo'|'installed', dir: string, manifest: object|null, error: string|null, shadowsInstalled?: boolean }>} */
function discoverModules() {
	const byName = new Map()
	for (const e of scanDir(repoModulesDir(), 'repo')) byName.set(e.name, e)
	for (const e of scanDir(installedModulesDir(), 'installed')) {
		const repo = byName.get(e.name)
		if (repo) repo.shadowsInstalled = true
		else byName.set(e.name, e)
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const findModule = (name) => discoverModules().find((e) => e.name === name) || null

function isEnabledEntry(e, state = readModulesState()) {
	if (!e.manifest) return false
	return typeof state[e.name]?.enabled === 'boolean' ? state[e.name].enabled : e.manifest.defaultEnabled === true
}

/** GET /api/modules `available`. */
function listAvailable() {
	const state = readModulesState()
	const core = coreVersion()
	return discoverModules().map((e) => {
		const m = e.manifest
		const compatible = m ? satisfiesCore(m.requiresCore, core) : false
		return {
			name: e.name,
			title: m?.title || e.name,
			version: m?.version || '',
			description: m?.description || '',
			source: e.kind,
			enabled: isEnabledEntry(e, state),
			loaded: moduleRegistry.isLoaded(e.name) && !!moduleRegistry.externalInfo(e.name),
			requiresCore: m?.requiresCore || '',
			compatible,
			error: e.error || (m && !compatible ? `needs core ${m.requiresCore}, this core is ${core}` : null),
			...(e.shadowsInstalled ? { shadowsInstalled: true } : {}),
		}
	})
}

/** Drop every cached file of the module so the next load reads fresh code. */
function purgeRequireCache(dir) {
	let real
	try {
		real = fs.realpathSync(dir)
	} catch {
		return
	}
	for (const k of Object.keys(require.cache)) if (k.startsWith(real + path.sep)) delete require.cache[k]
}

function makeHost(e, log) {
	const srcRoot = path.join(REPO_ROOT, 'src') + path.sep
	return Object.freeze({
		name: e.name,
		version: e.manifest.version,
		moduleDir: e.dir,
		coreRoot: REPO_ROOT,
		coreVersion: coreVersion(),
		/** `src/…` → a core file; anything else → a package from the core's node_modules (ws, three, …). */
		requireCore(id) {
			if (typeof id !== 'string' || !id || id.startsWith('.') || path.isAbsolute(id)) throw new Error(`requireCore: bad id "${id}"`)
			if (id.startsWith('src/')) {
				const file = path.resolve(REPO_ROOT, id)
				if (!file.startsWith(srcRoot)) throw new Error(`requireCore: "${id}" is outside src/`)
				return require(file)
			}
			return require(require.resolve(id, { paths: [REPO_ROOT] }))
		},
		log: (level, msg) => log?.(level, `[module:${e.name}] ${msg}`),
	})
}

/** Hooks of an external descriptor that must stay inside their lane. @returns {string|null} error */
function checkDescriptor(desc, e) {
	if (!desc || typeof desc !== 'object') return 'main did not export a descriptor (or a factory returning one)'
	if (desc.name !== e.name) return `descriptor name "${desc.name}" does not match module "${e.name}"`
	if (desc.apiPathPrefixes !== undefined) {
		if (!Array.isArray(desc.apiPathPrefixes)) return 'apiPathPrefixes must be an array'
		for (const p of desc.apiPathPrefixes) {
			if (typeof p !== 'string' || !API_PREFIX_RE.test(p)) return `apiPathPrefixes: "${p}" is not an /api/<name> path`
			if (RESERVED_API.some((r) => p === r || p.startsWith(r + '/') || r.startsWith(p + '/'))) return `apiPathPrefixes: "${p}" is a core API path`
		}
	}
	if (desc.staticMounts !== undefined) {
		if (!desc.staticMounts || typeof desc.staticMounts !== 'object') return 'staticMounts must be an object'
		for (const p of Object.keys(desc.staticMounts)) if (!isAllowedMountPrefix(p)) return `staticMounts: "${p}" is not an allowed prefix`
	}
	return null
}

/**
 * Require + register one discovered module (no onBoot — bootAll / bootOne do that).
 * @returns {{ ok: boolean, error?: string }}
 */
function loadModule(e, log) {
	if (moduleRegistry.isLoaded(e.name)) {
		return moduleRegistry.externalInfo(e.name) ? { ok: true } : { ok: false, error: `"${e.name}" is already a loaded in-tree module` }
	}
	if (e.error || !e.manifest) return { ok: false, error: e.error || 'module.json missing' }
	const core = coreVersion()
	if (!satisfiesCore(e.manifest.requiresCore, core)) return { ok: false, error: `needs core ${e.manifest.requiresCore}, this core is ${core}` }
	try {
		const realDir = fs.realpathSync(e.dir)
		const main = fs.realpathSync(path.join(realDir, e.manifest.main))
		if (!main.startsWith(realDir + path.sep)) return { ok: false, error: 'main resolves outside the module directory' }
		const exp = require(main)
		const desc = typeof exp === 'function' ? exp(makeHost(e, log)) : exp
		const bad = checkDescriptor(desc, e)
		if (bad) throw new Error(bad)
		moduleRegistry.register(desc, { external: { source: e.kind, version: e.manifest.version, title: e.manifest.title, dir: realDir } })
		if (log) log('info', `[modules] loaded external "${e.name}" ${e.manifest.version} (${e.kind})`)
		return { ok: true }
	} catch (err) {
		purgeRequireCache(e.dir)
		const msg = err?.message || String(err)
		if (log) log('warn', `[modules] external "${e.name}" failed to load: ${msg}`)
		return { ok: false, error: msg }
	}
}

/** Boot: register every installed + enabled + compatible module (index.js bootAll boots them). Never throws. */
function loadEnabledExternalModules(log) {
	const loaded = []
	try {
		const state = readModulesState()
		for (const e of discoverModules()) {
			if (!isEnabledEntry(e, state)) {
				if (e.manifest && log) log('info', `[modules] external "${e.name}" installed, disabled`)
				continue
			}
			if (loadModule(e, log).ok) loaded.push(e.name)
		}
	} catch (err) {
		if (log) log('warn', `[modules] external module scan failed: ${err?.message || err}`)
	}
	return loaded
}

const logOf = (ctx) => (ctx && typeof ctx.log === 'function' ? ctx.log : null)

/** Runtime enable: persist, load, boot. Not persisted when it does not load / boot. */
const enableModule = (name, ctx) => serial(() => enableModuleNow(name, ctx))

/** enableModule without the lock — for callers already inside serial() (install). */
function enableModuleNow(name, ctx) {
	const e = isValidModuleName(name) ? findModule(name) : null
	if (!e) return { ok: false, status: 404, error: 'not_installed' }
	if (moduleRegistry.externalInfo(name)) {
		setModuleEnabled(name, true) // already running: no second onBoot
		return { ok: true, status: 200, alreadyLoaded: true }
	}
	const r = loadModule(e, logOf(ctx))
	if (!r.ok) return { ok: false, status: 409, error: r.error }
	if (!moduleRegistry.bootOne(name, ctx)) {
		moduleRegistry.unregister(name)
		purgeRequireCache(e.dir)
		return { ok: false, status: 409, error: 'boot_failed' }
	}
	setModuleEnabled(name, true)
	return { ok: true, status: 200 }
}

/** Unload without touching the persisted flag (disable + uninstall + upgrade use it). */
async function unloadModule(name, ctx) {
	const info = moduleRegistry.externalInfo(name)
	if (!info) return false
	const log = logOf(ctx)
	await moduleRegistry.shutdownOne(name, log)
	moduleRegistry.unregister(name)
	purgeRequireCache(info.dir)
	if (log) log('info', `[modules] unloaded external "${name}"`)
	return true
}

/** Runtime disable: persist, onShutdown, unregister (routes / static / WS / public paths stop answering). */
function disableModule(name, ctx) {
	return serial(async () => {
		if (!isValidModuleName(name)) return { ok: false, status: 400, error: 'invalid module name' }
		const e = findModule(name)
		if (!e && !moduleRegistry.externalInfo(name)) return { ok: false, status: 404, error: 'not_installed' }
		const wasLoaded = await unloadModule(name, ctx)
		setModuleEnabled(name, false)
		return { ok: true, status: 200, wasLoaded }
	})
}

module.exports = {
	listAvailable,
	loadEnabledExternalModules,
	enableModule,
	enableModuleNow,
	disableModule,
	unloadModule,
	isInTreeName,
	serial,
}
