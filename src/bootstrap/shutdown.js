/**
 * Graceful shutdown handler for HighAsCG.
 */
'use strict'

const { clearPeriodicSyncTimer } = require('../utils/periodic-sync')
const { stopHttpServer } = require('../server/http-server')
const { flushProjectSyncBroadcast } = require('../api/routes-data')

function createShutdownHandler({ logger, appCtx, moduleRegistry, stopStreamingSubsystem, stopOscSubsystem, wsHandle, httpServer, persistence }) {
	let shutdownStarted = false

	return async function shutdown() {
		if (shutdownStarted) return
		shutdownStarted = true

		const failsafe = setTimeout(() => {
			logger.warn('[Shutdown] Failsafe exit after 12s')
			process.exit(0)
		}, 12000)

		try {
			clearPeriodicSyncTimer(appCtx)
			if (appCtx._systemVarsInterval) clearInterval(appCtx._systemVarsInterval)
			if (appCtx._startupInventoryInterval) clearInterval(appCtx._startupInventoryInterval)

			await moduleRegistry.shutdownAll(appCtx.log).catch(e => appCtx.log('warn', `[Shutdown] modules: ${e.message}`))

			try {
				await Promise.race([
					stopStreamingSubsystem(),
					new Promise((_, reject) => setTimeout(() => reject(new Error('Streaming stop timeout')), 5000))
				])
			} catch (e) { appCtx.log('warn', `[Shutdown] streaming: ${e.message}`) }

			if (appCtx.samplingManager) await appCtx.samplingManager.stop()
			stopOscSubsystem()
			if (typeof appCtx._stopUsbHotplugWatcher === 'function') appCtx._stopUsbHotplugWatcher()

			try {
				flushProjectSyncBroadcast()
			} catch (e) {
				logger.warn(`[Shutdown] project sync flush: ${e.message}`)
			}

			wsHandle.stop()
			if (appCtx.casparConnection) {
				appCtx.casparConnection.destroy()
				appCtx.casparConnection = null
				appCtx.amcp = null
			}

			if (persistence && typeof persistence.flushSync === 'function') {
				try {
					persistence.flushSync()
				} catch (e) {
					logger.warn(`[Shutdown] persistence flush: ${e.message}`)
				}
			}

			const forceExit = setTimeout(() => { process.exit(0) }, 5000)
			stopHttpServer(httpServer, () => {
				clearTimeout(forceExit); clearTimeout(failsafe); process.exit(0)
			})
		} catch (e) {
			logger.error(`[Shutdown] Error: ${e.message}`); process.exit(1)
		}
	}
}

module.exports = { createShutdownHandler }
