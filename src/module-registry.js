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
 *     handleWs: (msg, { ws, ctx }) => bool, // WO-616: inbound client messages whose type is in a namespace
 *     webBundles: ['/assets/modules/previs/entry.js'],  // dynamic-import URLs for the web client
 *     webStyles:  ['/assets/modules/previs/previs.css'], // stylesheets to inject
 *     // WO-1076 (installable modules, docs/MODULES.md):
 *     registerRoutes(routes) {},          // a private RouteRegistry, dispatched under apiPathPrefixes
 *     publicPaths(method, path) => bool,  // no API password for these (only under the module's apiPathPrefixes)
 *     onHttpServer(httpServer, ctx) => { close() } | void, // own `upgrade` listener (a WS path); close() on unregister
 *     handleStatic({ method, path, search, req }) => response | null, // non-API paths, before the operator UI
 *   }
 *
 * See WO-30 for the module boundary rules.
 */

'use strict'

/** @type {Array<any>} */
const _modules = []
/** WO-1076: per-module side state — `{ external?: object, routes?: RouteRegistry, http?: { close() } }` by name. */
const _meta = new Map()
/** WO-1076: the HTTP server + ctx `onHttpServer` hooks attach to (index.js setHttpServer). */
let _http = null

function attachHttp(mod) {
	const meta = _meta.get(mod.name)
	if (!_http || !meta || meta.http || typeof mod.onHttpServer !== 'function') return
	try {
		const h = mod.onHttpServer(_http.server, _http.ctx)
		meta.http = h && typeof h.close === 'function' ? h : { close() {} }
	} catch (e) {
		if (typeof _http.ctx?.log === 'function') _http.ctx.log('warn', `[modules] onHttpServer("${mod.name}") failed: ${e?.message || e}`)
	}
}

function detachHttp(name) {
	const meta = _meta.get(name)
	if (!meta?.http) return
	try {
		meta.http.close()
	} catch {}
	meta.http = null
}

/**
 * Register a module descriptor. Idempotent on `name`: re-registering the same name replaces
 * the prior entry (useful for hot-reload during development).
 * @param {any} mod
 * @param {{ external?: object }} [opts] WO-1076: the external-module loader marks its modules (manifest info)
 */
function register(mod, opts = {}) {
	if (!mod || typeof mod !== 'object' || typeof mod.name !== 'string' || !mod.name) {
		throw new Error('module-registry: descriptor must be an object with a non-empty `name`')
	}
	const existingIdx = _modules.findIndex((m) => m.name === mod.name)
	if (existingIdx >= 0) detachHttp(mod.name)
	const meta = { external: opts.external || null, routes: null, http: null }
	if (typeof mod.registerRoutes === 'function') {
		const { RouteRegistry } = require('./api/route-registry')
		meta.routes = new RouteRegistry()
		mod.registerRoutes(meta.routes)
	}
	_meta.set(mod.name, meta)
	if (existingIdx >= 0) _modules[existingIdx] = mod
	else _modules.push(mod)
	attachHttp(mod)
}

/**
 * WO-1076: give `onHttpServer` hooks the server — modules registered before it existed attach now, later ones on
 * register(). Called once by index.js after startHttpServer.
 * @param {import('http').Server} server
 * @param {any} ctx
 */
function setHttpServer(server, ctx) {
	_http = server ? { server, ctx } : null
	if (_http) for (const m of _modules) attachHttp(m)
}

/** @param {string} name @returns {object|null} the loader's manifest info when the module is an external one */
function externalInfo(name) {
	return _meta.get(name)?.external || null
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

/**
 * @param {string} name
 * @returns {boolean}
 */
function isLoaded(name) {
	return _modules.some((m) => m.name === name)
}

/**
 * Remove one module descriptor from registry.
 * @param {string} name
 * @returns {boolean}
 */
function unregister(name) {
	const i = _modules.findIndex((m) => m.name === name)
	if (i < 0) return false
	detachHttp(name) // WO-1076: its WS / upgrade listener goes with it
	_meta.delete(name)
	_modules.splice(i, 1)
	return true
}

/**
 * Try to remove a module from runtime and clear require cache for its register entry.
 * @param {string} name
 * @param {(level:'warn'|'info',msg:string)=>void} [log]
 * @returns {boolean}
 */
function tryUnload(name, log) {
	const removed = unregister(name)
	try {
		const modulePath = require.resolve(`./${name}/register`)
		if (require.cache[modulePath]) delete require.cache[modulePath]
	} catch {}
	if (log) log('info', removed ? `[modules] unloaded "${name}"` : `[modules] unload skipped "${name}" (not loaded)`)
	return removed
}

/**
 * @param {string} name
 * @returns {any|null}
 */
function get(name) {
	const mod = _modules.find((m) => m.name === name)
	return mod || null
}

function observeBoot(m, ctx) {
	const result = m.onBoot(ctx)
	if (result && typeof result.then === 'function') {
		Promise.resolve(result).catch((e) => {
			if (ctx && typeof ctx.log === 'function') ctx.log('warn', `[modules] onBoot("${m.name}") failed: ${e?.message || String(e)}`)
		})
	}
}

/**
 * Call onBoot for one module if present.
 * @param {string} name
 * @param {any} ctx
 * @returns {boolean}
 */
function bootOne(name, ctx) {
	const m = get(name)
	if (!m) return false
	if (typeof m.onBoot !== 'function') return true
	try {
		observeBoot(m, ctx)
		return true
	} catch (e) {
		const msg = e && e.message ? e.message : String(e)
		if (ctx && typeof ctx.log === 'function') ctx.log('warn', `[modules] onBoot("${m.name}") failed: ${msg}`)
		return false
	}
}

/**
 * Call onShutdown for one module if present.
 * @param {string} name
 * @param {(level:'warn'|'info',msg:string)=>void} [log]
 * @returns {Promise<boolean>}
 */
async function shutdownOne(name, log) {
	const m = get(name)
	if (!m) return false
	if (typeof m.onShutdown !== 'function') return true
	try {
		await m.onShutdown()
		return true
	} catch (e) {
		const msg = e && e.message ? e.message : String(e)
		if (log) log('warn', `[modules] onShutdown("${m.name}") failed: ${msg}`)
		return false
	}
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
			observeBoot(m, ctx)
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

/** Is `path` one of the module's `apiPathPrefixes` or below one? */
function underPrefixes(m, path) {
	if (!Array.isArray(m.apiPathPrefixes)) return false
	return m.apiPathPrefixes.some((prefix) => typeof prefix === 'string' && prefix && (path === prefix || path.startsWith(prefix + '/')))
}

/**
 * WO-1076: does a loaded module declare this API path public (no API password)? Consulted by src/server/auth.js.
 * Only paths under the module's own apiPathPrefixes count, so a careless `() => true` cannot open core routes. A
 * disabled module is unregistered, so its public paths close with it.
 * @param {string} method @param {string} path path without query
 */
function isPublicPath(method, path) {
	for (const m of _modules) {
		if (typeof m.publicPaths !== 'function' || !underPrefixes(m, path)) continue
		try {
			if (m.publicPaths(String(method || 'GET').toUpperCase(), path) === true) return true
		} catch {}
	}
	return false
}

/**
 * WO-1076: non-API request paths a module serves itself — `handleStatic` first, then the live `staticMounts` of
 * external modules (in-tree modules' mounts keep going through the boot-time vendorDirs). Null = not a module path.
 * @param {{ method: string, path: string, search?: string, req?: any }} args
 */
async function handleStatic(args) {
	for (const m of _modules) {
		if (typeof m.handleStatic !== 'function') continue
		try {
			const r = await m.handleStatic(args)
			if (r) return r
		} catch (e) {
			return { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: `module "${m.name}" failed: ${e?.message || e}` }
		}
	}
	for (const m of _modules) {
		if (!externalInfo(m.name) || !m.staticMounts || typeof m.staticMounts !== 'object') continue
		const r = await require('./module-host/module-static').serveMounts(m.staticMounts, args)
		if (r) return r
	}
	return null
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
		const routes = _meta.get(m.name)?.routes
		if (!Array.isArray(m.apiPathPrefixes) || (typeof m.handleApi !== 'function' && !routes)) continue
		if (!underPrefixes(m, path)) continue
		try {
			// WO-1076: routes the module registered (registerRoutes) first, then its catch-all handleApi
			const rr = routes ? await routes.dispatch(method, path, body, ctx, req, query) : null
			if (rr) return rr
			const r = typeof m.handleApi === 'function' ? await m.handleApi({ method, path, body, ctx, req, query }) : null
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

/**
 * WO-616: hand an inbound WS client message to the module whose `wsNamespaces` prefix its `type` (e.g.
 * `tracking:marker` → the tracking module). True when a module took it; false leaves it to core (unknown types are
 * ignored there as before). A throwing handler is logged and counts as taken.
 * @param {any} ws
 * @param {any} ctx
 * @param {{ type?: unknown }} msg
 * @returns {boolean}
 */
function handleWs(ws, ctx, msg) {
	const type = typeof msg?.type === 'string' ? msg.type : ''
	if (!type) return false
	for (const m of _modules) {
		if (typeof m.handleWs !== 'function' || !Array.isArray(m.wsNamespaces)) continue
		if (!m.wsNamespaces.some((ns) => typeof ns === 'string' && ns && type.startsWith(ns))) continue
		try {
			if (m.handleWs(msg, { ws, ctx })) return true
		} catch (e) {
			const err = e && e.message ? e.message : String(e)
			if (ctx && typeof ctx.log === 'function') ctx.log('warn', `[modules] handleWs("${m.name}") threw: ${err}`)
			return true
		}
	}
	return false
}

/**
 * Merge every loaded module's `staticMounts` (URL prefix -> on-disk dir, WO-265) into one map,
 * suitable for spreading into the `vendorDirs` option of `serveWebApp`. First registration of a
 * prefix wins; duplicates are logged and skipped so one module can't silently shadow another.
 * @param {(level:'warn'|'info',msg:string)=>void} [log]
 * @returns {Record<string, string>}
 */
function collectStaticMounts(log) {
	/** @type {Record<string, string>} */
	const out = {}
	for (const m of _modules) {
		if (!m.staticMounts || typeof m.staticMounts !== 'object') continue
		if (externalInfo(m.name)) continue // WO-1076: served live by handleStatic (enable/disable without a restart)
		for (const [prefix, dir] of Object.entries(m.staticMounts)) {
			if (typeof prefix !== 'string' || !prefix.startsWith('/') || !prefix.endsWith('/')) continue
			if (typeof dir !== 'string' || !dir) continue
			if (out[prefix]) {
				if (log) log('warn', `[modules] staticMounts prefix "${prefix}" from "${m.name}" already taken — skipped`)
				continue
			}
			out[prefix] = dir
		}
	}
	return out
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
	unregister,
	tryLoad,
	tryUnload,
	isLoaded,
	get,
	bootOne,
	shutdownOne,
	bootAll,
	shutdownAll,
	handleApi,
	handleWs,
	collectStaticMounts,
	describe,
	setHttpServer, // WO-1076
	externalInfo,
	isPublicPath,
	handleStatic,
}
