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
	const world = require('./server/rc-world') // WO-1101 Game World: a descriptor in the process-global registry (no require of the world module)
	let bootCtx = null
	world.register(() => require('./server/rc-game').getRcGame(bootCtx))
	return {
		name: 'rc-game',
		gameDescriptor: () => world.descriptor(), // WO-1105 Settings ▸ Games (the core never reads the Game World registry)
		apiPathPrefixes: ['/api/game/rc'],
		registerRoutes: (routes) => require('./server/routes-rc-game').register(routes),
		publicPaths: (m, p) => isRcPublicPath(m, p),
		onHttpServer: (server, ctx) => attachRcGameWs(server, ctx),
		handleStatic: ({ method, path, search }) => (isRcStaticPath(path) ? serveRcStatic(path, { method, query: search }) : null),
		onBoot(ctx) {
			bootCtx = ctx
			require('./server/rc-scene').setSceneCtx(ctx) // WO-1082: Stage Skirmish's bake (same file) finds the venue .glb too
		},
		/** Module disabled / server stopping: end the running session (sockets, lights, wall feed) and close the public paths. */
		async onShutdown() {
			try {
				if (bootCtx) require('./server/rc-game').getRcGame(bootCtx).disable()
			} catch {}
			setRcGameEnabled(false)
			world.unregister()
		},
	}
}
