'use strict'

/**
 * WO-1081 — Stage Skirmish, a toy-soldier top-down arena shooter in the show's room, as an opt-in module
 * (docs/MODULES.md, work/notes/skirmish-game-contract.md). Loaded only when the module is enabled
 * (`POST /api/modules/enable {"name":"toy-skirmish"}`); a session is then started by its host
 * (`POST /api/game/sk/host {"action":"enable"}`). Needs the sibling module `rc-game` INSTALLED (not necessarily
 * enabled): its world code is reused through server/sk-kit.js. The core never requires anything in this folder.
 */

module.exports = (h) => {
	const kitHost = require('./server/sk-kit')
	kitHost.init(h) // throws `Stage Skirmish needs the "rc-game" module installed`
	kitHost.kit()
	const { attachSkWs } = require('./server/sk-ws')
	const { serveSkStatic, isSkStaticPath } = require('./server/sk-static')
	const { isSkPublicPath, setSkGameEnabled } = require('./server/sk-public')
	const world = require('./server/sk-world') // WO-1101 Game World: a descriptor in the process-global registry (no require of the world module)
	let bootCtx = null
	world.register(() => require('./server/sk-game').getSkGame(bootCtx))
	return {
		name: 'toy-skirmish',
		apiPathPrefixes: ['/api/game/sk'],
		registerRoutes: (routes) => require('./server/routes-sk').register(routes),
		publicPaths: (m, p) => isSkPublicPath(m, p),
		onHttpServer: (server, ctx) => ((bootCtx = ctx), attachSkWs(server, ctx)),
		handleStatic: ({ method, path, search }) => (isSkStaticPath(path) ? serveSkStatic(path, { method, query: search }) : null),
		/** Module disabled / server stopping: end the running session (sockets, lights, wall feed), close the public paths. */
		async onShutdown() {
			try {
				require('./server/sk-game').shutdownSkGame()
			} catch {}
			setSkGameEnabled(false)
			world.unregister()
			kitHost.release()
		},
	}
}
