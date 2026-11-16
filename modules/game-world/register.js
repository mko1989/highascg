'use strict'

/**
 * WO-1101 / WO-1102 — the Game World as an opt-in module (docs/MODULES.md "External modules",
 * work/notes/game-world-contract.md). Loaded only when enabled (`POST /api/modules/enable {"name":"game-world"}`). It
 * requires no game and no game requires it: they meet in the process-global registry (server/world-link.js). At load
 * the hub becomes `reg.hub` and attaches every game whose session already runs; onShutdown sets `reg.hub = null` and
 * disposes it (timer, viewers — `wst off` to every game viewer that had the world). The core never requires anything
 * in this folder and names no game; the world never puts anything on a screen.
 */

module.exports = (h) => {
	const host = require('./server/host')
	host.set(h)
	const { registry } = require('./server/world-link')
	const { createHub } = require('./server/world-hub')
	const { createWorldService } = require('./server/world-service')
	const { attachWorldWs } = require('./server/world-ws')
	const { isWorldPublicPath } = require('./server/world-public')
	const { serveWorldStatic, isWorldStaticPath } = require('./server/world-static')
	const reg = registry()
	const hub = createHub({ registry: reg, log: host.log })
	reg.hub = hub
	hub.sync()
	const service = createWorldService({ hub, registry: reg })
	return {
		name: 'game-world',
		apiPathPrefixes: ['/api/game/world'],
		registerRoutes: (routes) => require('./server/routes-world').register(routes, { service }),
		publicPaths: (m, p) => isWorldPublicPath(m, p, reg),
		onHttpServer: (server, ctx) => attachWorldWs(server, ctx, { hub, service, registry: reg }),
		handleStatic: ({ method, path, search }) => (isWorldStaticPath(path) ? serveWorldStatic(path, { method, query: search }) : null),
		hub,
		service,
		/** Module disabled / server stopping: the hub leaves the registry first (games stop calling it), then stops. */
		async onShutdown() {
			try {
				if (reg.hub === hub) reg.hub = null
			} catch {}
			try {
				hub.dispose()
			} catch {}
		},
	}
}
