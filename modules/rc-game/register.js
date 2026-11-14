'use strict'

/**
 * WO-1074 / WO-1076 — the RC car game as an opt-in module (docs/MODULES.md). Loaded only when the module is enabled
 * (`POST /api/modules/enable {"name":"rc-game"}`); a game session is then started by its host
 * (`POST /api/game/rc/host {"action":"enable"}`). The core never requires anything in this folder.
 */

module.exports = (h) => {
	require('./server/host').set(h)
	const { attachRcGameWs } = require('./server/rc-ws')
	const { serveRcStatic, isRcStaticPath } = require('./server/rc-static')
	const { isRcPublicPath, setRcGameEnabled } = require('./server/rc-public')
	let bootCtx = null
	return {
		name: 'rc-game',
		apiPathPrefixes: ['/api/game/rc'],
		registerRoutes: (routes) => require('./server/routes-rc-game').register(routes),
		publicPaths: (m, p) => isRcPublicPath(m, p),
		onHttpServer: (server, ctx) => attachRcGameWs(server, ctx),
		handleStatic: ({ method, path, search }) => (isRcStaticPath(path) ? serveRcStatic(path, { method, query: search }) : null),
		onBoot(ctx) {
			bootCtx = ctx
		},
		/** Module disabled / server stopping: end the running session (sockets, lights, wall feed) and close the public paths. */
		async onShutdown() {
			try {
				if (bootCtx) require('./server/rc-game').getRcGame(bootCtx).disable()
			} catch {}
			setRcGameEnabled(false)
		},
	}
}
