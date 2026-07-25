/**
 * Graceful shutdown handler for HighAsCG.
 */
'use strict'

const { clearPeriodicSyncTimer } = require('../utils/periodic-sync')
const { stopHttpServer } = require('../server/http-server')
const { flushProjectSyncBroadcast } = require('../api/routes-data')
const { flushDeckSyncPersist } = require('../engine/project-scenes')
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
			if (appCtx._composePreviewLifecycle) appCtx._composePreviewLifecycle.onShutdown()
			if (appCtx._guiStreamLifecycle) appCtx._guiStreamLifecycle.onShutdown()
			if (appCtx._v4l2BridgeLifecycle) appCtx._v4l2BridgeLifecycle.onShutdown()
			if (appCtx._audioCaptureLifecycle) appCtx._audioCaptureLifecycle.onShutdown()
			try {
				const { stopAllLiveAudioBridges } = require('../audio/live-audio-bridge')
				stopAllLiveAudioBridges()
			} catch (_) {}
			try {
				const { stopAllV4l2InputBridges } = require('../capture/v4l2-input-bridge')
				stopAllV4l2InputBridges()
			} catch (_) {}
			try {
				const { stopAllBrowserCaptureBridges } = require('../capture/browser-capture-bridge')
				stopAllBrowserCaptureBridges()
				const { stopAllBrowserSources } = require('../system/browser-source-session')
				stopAllBrowserSources()
			} catch (_) {}
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
			if (typeof appCtx._stopOsLayoutWatchdog === 'function') appCtx._stopOsLayoutWatchdog()
			if (typeof appCtx._stopCasparAmcpWatchdog === 'function') appCtx._stopCasparAmcpWatchdog()
			if (typeof appCtx._stopReplicationService === 'function') appCtx._stopReplicationService()
			try {
				const { stopOperatorShapeOverlay } = require('../system/operator-shape-overlay')
				stopOperatorShapeOverlay()
			} catch (_) {}
			try {
				const { stopPointerConfine } = require('../system/pointer-confine')
				stopPointerConfine()
			} catch (_) {}

			try {
				flushDeckSyncPersist()
			} catch (e) {
				logger.warn(`[Shutdown] deck sync flush: ${e.message}`)
			}
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
