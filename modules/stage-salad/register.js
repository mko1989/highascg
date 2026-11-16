'use strict'

/**
 * WO-1089 — Stage Salad: fire vegetables from big slingshots at the presenter's friendly avatar on the show's stage, as
 * an opt-in module (docs/MODULES.md, work/notes/stage-salad-contract.md). Loaded only when the module is enabled
 * (`POST /api/modules/enable {"name":"stage-salad"}`); a session is then started by its host
 * (`POST /api/game/salad/host {"action":"enable"}`). Needs the sibling module `rc-game` INSTALLED (not necessarily
 * enabled): its world code is reused through server/salad-kit.js. The core never requires anything in this folder.
 */

module.exports = (h) => {
	const kitHost = require('./server/salad-kit')
	kitHost.init(h) // throws `Stage Salad needs the "rc-game" module installed`
	kitHost.kit()
	kitHost.shared()
	const { attachSaladWs } = require('./server/salad-ws')
	const { serveSaladStatic, isSaladStaticPath } = require('./server/salad-static')
	const { isSaladPublicPath, setSaladEnabled } = require('./server/salad-public')
	const world = require('./server/salad-world') // WO-1101 Game World: a descriptor in the process-global registry (no require of the world module)
	let bootCtx = null
	world.register(() => require('./server/salad-game').getSaladGame(bootCtx))
	return {
		name: 'stage-salad',
		apiPathPrefixes: ['/api/game/salad'],
		registerRoutes: (routes) => require('./server/routes-salad').register(routes),
		publicPaths: (m, p) => isSaladPublicPath(m, p),
		onHttpServer: (server, ctx) => ((bootCtx = ctx), attachSaladWs(server, ctx)),
		handleStatic: ({ method, path, search }) => (isSaladStaticPath(path) ? serveSaladStatic(path, { method, query: search }) : null),
		/** Module disabled / server stopping: end the running session (sockets, timers, lights, wall feed), close the public paths. */
		async onShutdown() {
			try {
				require('./server/salad-game').shutdownSaladGame()
			} catch {}
			setSaladEnabled(false)
			world.unregister()
			kitHost.release()
		},
	}
}
