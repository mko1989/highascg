/**
 * Optional-module registry (see WO-30).
 *
 * Core code never imports from `src/previs/`, `src/tracking/`, `src/autofollow/`, or
 * `web/components/{previs,tracking,autofollow}-*` directly. Instead, each optional module
 * ships a single `src/<name>/register.js` that exports a descriptor, and `index.js` attempts
 * to require it behind a feature flag at boot. If the module's directory has been deleted,
 * the require throws and is swallowed; the rest of the app continues booting normally.
 *
 * Module descriptor shape (all fields optional except `name`):
 *
 *   module.exports = {
 *     name: 'previs',                     // unique, appears in GET /api/modules
 *     onBoot(ctx) {},                     // called once after core is ready
 *     onShutdown() {},                    // called on SIGINT/SIGTERM
 *     apiPathPrefixes: ['/api/previs'],   // paths dispatched to handleApi
 *     handleApi: async ({ method, path, body, ctx, req, query }) => response | null,
 *     wsNamespaces: ['previs:'],          // WS event name prefixes this module broadcasts on
 *     webBundles: ['/assets/modules/previs/entry.js'],  // dynamic-import URLs for the web client
 *     webStyles:  ['/assets/modules/previs/previs.css'], // stylesheets to inject
 *   }
 *
 * See WO-30 for the module boundary rules.
 */

'use strict'

/** @type {Array<any>} */
const _modules = []

/**
 * Register a module descriptor. Idempotent on `name`: re-registering the same name replaces
 * the prior entry (useful for hot-reload during development).
 * @param {any} mod
 */
function register(mod) {
	if (!mod || typeof mod !== 'object' || typeof mod.name !== 'string' || !mod.name) {
		throw new Error('module-registry: descriptor must be an object with a non-empty `name`')
	}
	const existingIdx = _modules.findIndex((m) => m.name === mod.name)
	if (existingIdx >= 0) _modules[existingIdx] = mod
	else _modules.push(mod)
}

/**
 * Attempt to load and register a module from `src/<name>/register.js`. If the file is missing
 * (module deleted) or throws, log at `warn` and return `false`. Never rethrows.
 * @param {string} name
 * @param {(level:'warn'|'info',msg:string)=>void} [log]
 * @returns {boolean}
 */
function tryLoad(name, log) {
	try {
		const modulePath = `./${name}/register`
		const mod = require(modulePath)
		register(mod)
		if (log) log('info', `[modules] loaded "${name}"`)
		return true
	} catch (e) {
		const msg = e && e.message ? e.message : String(e)
		if (log) log('warn', `[modules] skipped "${name}" (${msg})`)
		return false
	}
}

/** @returns {string[]} names of currently-registered modules */
function listNames() {
	return _modules.map((m) => m.name)
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isLoaded(name) {
	return _modules.some((m) => m.name === name)
}

/**
 * Call `onBoot(ctx)` on every registered module, swallowing errors per-module so one bad
 * module can't stop the rest of the app.
 * @param {any} ctx
 */
function bootAll(ctx) {
	for (const m of _modules) {
		if (typeof m.onBoot !== 'function') continue
		try {
			m.onBoot(ctx)
		} catch (e) {
			const msg = e && e.message ? e.message : String(e)
			if (ctx && typeof ctx.log === 'function') ctx.log('warn', `[modules] onBoot("${m.name}") failed: ${msg}`)
		}
	}
}

/**
 * Call `onShutdown()` on every registered module. Awaits promises; swallows per-module errors.
 * @param {(level:'warn'|'info',msg:string)=>void} [log]
 */
async function shutdownAll(log) {
	for (const m of _modules) {
		if (typeof m.onShutdown !== 'function') continue
		try {
			await m.onShutdown()
		} catch (e) {
			const msg = e && e.message ? e.message : String(e)
			if (log) log('warn', `[modules] onShutdown("${m.name}") failed: ${msg}`)
		}
	}
}

/**
 * Dispatch an API request to any module whose `apiPathPrefixes` match the path. Returns the
 * module's response, or `null` if no module claimed the path.
 * @param {string} method
 * @param {string} path
 * @param {string} body
 * @param {any} ctx
 * @param {import('http').IncomingMessage} [req]
 * @param {any} [query]
 * @returns {Promise<any|null>}
 */
async function handleApi(method, path, body, ctx, req, query) {
	for (const m of _modules) {
		if (!Array.isArray(m.apiPathPrefixes) || typeof m.handleApi !== 'function') continue
		let matched = false
		for (const prefix of m.apiPathPrefixes) {
			if (typeof prefix !== 'string' || !prefix) continue
			if (path === prefix || path.startsWith(prefix + '/')) {
				matched = true
				break
			}
		}
		if (!matched) continue
		try {
			const r = await m.handleApi({ method, path, body, ctx, req, query })
			if (r) return r
		} catch (e) {
			const msg = e && e.message ? e.message : String(e)
			if (ctx && typeof ctx.log === 'function') ctx.log('warn', `[modules] handleApi("${m.name}") threw: ${msg}`)
			return {
				status: 500,
				headers: { 'Content-Type': 'application/json; charset=utf-8' },
				body: JSON.stringify({ error: `module "${m.name}" failed: ${msg}` }),
			}
		}
	}
	return null
}

/** @returns {{ modules: string[], bundles: string[], styles: string[], wsNamespaces: string[] }} */
function describe() {
	const modules = []
	const bundles = []
	const styles = []
	const wsNamespaces = []
	for (const m of _modules) {
		modules.push(m.name)
		if (Array.isArray(m.webBundles)) for (const b of m.webBundles) if (typeof b === 'string' && b) bundles.push(b)
		if (Array.isArray(m.webStyles)) for (const s of m.webStyles) if (typeof s === 'string' && s) styles.push(s)
		if (Array.isArray(m.wsNamespaces))
			for (const ns of m.wsNamespaces) if (typeof ns === 'string' && ns) wsNamespaces.push(ns)
	}
	return { modules, bundles, styles, wsNamespaces }
}

module.exports = {
	register,
	tryLoad,
	listNames,
	isLoaded,
	bootAll,
	shutdownAll,
	handleApi,
	describe,
}
