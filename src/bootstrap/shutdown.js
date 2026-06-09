/**
 * Graceful shutdown handler for HighAsCG.
 */
'use strict'

const { clearPeriodicSyncTimer } = require('../utils/periodic-sync')
const { stopHttpServer } = require('../server/http-server')
const { flushProjectSyncBroadcast } = require('../api/routes-data')
const { clearStartupLedTestTimers } = require('./startup-led-test-pattern')

function createShutdownHandler({ logger, appCtx, moduleRegistry, stopStreamingSubsystem, stopOscSubsystem, wsHandle, httpServer, persistence }) {
	let shutdownStarted = false

	return async function shutdown() {
		if (shutdownStarted) return
		shutdownStarted = true

		const failsafe = setTimeout(() => {
			logger.warn('[Shutdown] Failsafe exit after 8s')
			process.exit(0)
		}, 8000)
		if (failsafe.unref) failsafe.unref()

		try {
			clearStartupLedTestTimers()
			clearPeriodicSyncTimer(appCtx)
			if (appCtx._systemVarsInterval) clearInterval(appCtx._systemVarsInterval)
			if (appCtx._startupInventoryInterval) clearInterval(appCtx._startupInventoryInterval)
			if (appCtx.clipEndFadeWatcher) appCtx.clipEndFadeWatcher.cancelAll()
			if (appCtx.artnetReceiver && typeof appCtx.artnetReceiver.stop === 'function') {
				try {
					appCtx.artnetReceiver.stop()
				} catch (e) {
					appCtx.log('warn', `[Shutdown] artnet: ${e?.message || e}`)
				}
			}

			await moduleRegistry.shutdownAll(appCtx.log).catch((e) => appCtx.log('warn', `[Shutdown] modules: ${e.message}`))

			try {
				await Promise.race([
					stopStreamingSubsystem(),
					new Promise((_, reject) => setTimeout(() => reject(new Error('Streaming stop timeout')), 3000)),
				])
			} catch (e) {
				appCtx.log('warn', `[Shutdown] streaming: ${e.message}`)
			}

			if (appCtx.samplingManager) {
				try {
					await Promise.race([
						appCtx.samplingManager.stop(),
						new Promise((_, reject) => setTimeout(() => reject(new Error('DMX stop timeout')), 3000)),
					])
				} catch (e) {
					appCtx.log('warn', `[Shutdown] dmx: ${e.message}`)
				}
			}
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

			const forceExit = setTimeout(() => {
				process.exit(0)
			}, 2000)
			if (forceExit.unref) forceExit.unref()
			stopHttpServer(httpServer, () => {
				clearTimeout(forceExit)
				clearTimeout(failsafe)
				process.exit(0)
			})
		} catch (e) {
			logger.error(`[Shutdown] Error: ${e.message}`)
			process.exit(1)
		}
	}
}

module.exports = { createShutdownHandler }
