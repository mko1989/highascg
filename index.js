#!/usr/bin/env node
/**
 * HighAsCG — Orchestrator entry point.
 */
'use strict'

const path = require('path'); const os = require('os'); const fs = require('fs')
const { createLogger } = require('./src/utils/logger'); const logBuffer = require('./src/utils/log-buffer')
const { StateManager } = require('./src/state/state-manager')
const { startHttpServer } = require('./src/server/http-server'); const { attachWebSocketServer } = require('./src/server/ws-server')
const { startUsbHotplugWatcher } = require('./src/media/usb-drives'); const { routeRequest, getState } = require('./src/api/router')
const persistence = require('./src/utils/persistence'); const { TimelineEngine } = require('./src/engine/timeline-engine')
const { ClipEndFadeWatcher } = require('./src/engine/clip-end-fade'); const { ConnectionManager } = require('./src/caspar/connection-manager')
const { normalizeOscConfig } = require('./src/osc/osc-config'); const { OscState } = require('./src/osc/osc-state')
const { OscListener } = require('./src/osc/osc-listener'); const { applyOscSnapshotToVariables, clearOscVariables } = require('./src/osc/osc-variables')
const { go2rtcManager, resolveCaptureTier } = require('./src/streaming/go2rtc-manager')
const { addStreamingConsumers, removeStreamingConsumers } = require('./src/streaming/caspar-ffmpeg-setup')
const { resolveFreeStreamingBasePort } = require('./src/streaming/streaming-udp-ports'); const { prepareNdiStreaming } = require('./src/streaming/ndi-resolve')
const { startPeriodicSync, startOscPlaybackInfoSupplement } = require('./src/utils/periodic-sync')
const { ConfigManager } = require('./src/config/config-manager'); const { refreshConfigComparison } = require('./src/config/config-compare')
const { applyCasparConfigToDiskAndRestart } = require('./src/api/routes-caspar-config'); const { SamplingManager } = require('./src/sampling/dmx-sampling')
const { getChannelMap } = require('./src/config/routing'); const { createStreamingLifecycle } = require('./src/bootstrap/streaming-lifecycle')
const { createOscLifecycle } = require('./src/bootstrap/osc-lifecycle'); const { createFetchServerInfoConfigAndBroadcast } = require('./src/bootstrap/fetch-server-info-config')
const { notifyWebSocketClientConnected } = require('./src/bootstrap/startup-led-test-pattern'); const { writeSystemInventoryFile } = require('./src/bootstrap/system-inventory-file')
const moduleRegistry = require('./src/module-registry')

const Args = require('./src/bootstrap/args'); const Config = require('./src/bootstrap/config'); const Modules = require('./src/bootstrap/modules'); const Shutdown = require('./src/bootstrap/shutdown')

const logger = createLogger({ minLevel: 'info', onLine: logBuffer.appendHighasLine }); const debugLog = createLogger({ minLevel: 'debug', onLine: logBuffer.appendHighasLine })

function main() {
	const cli = Args.parseArgs(process.argv); if (cli.help) { Args.printHelp(); process.exit(0) }
	let configPath = process.env.HIGHASCG_CONFIG_PATH ? path.resolve(process.env.HIGHASCG_CONFIG_PATH) : path.join(__dirname, 'highascg.config.json')
	const modularDir = path.join(__dirname, 'config')
	if (!process.env.HIGHASCG_CONFIG_PATH && fs.existsSync(modularDir) && fs.statSync(modularDir).isDirectory()) {
		configPath = modularDir
	}

	const configManager = new ConfigManager(configPath, logger)
	let config
	try {
		configManager.load()
		config = Config.buildConfig(cli, configManager)
	} catch (e) {
		logger.error(`[Main] Configuration failed to load: ${e.message}. Falling back to hardcoded defaults (Safe Mode).`)
		config = { ...require('./src/config/defaults') }
	}

	logger.info('Config: ' + JSON.stringify(config, null, 2))
	if (cli.noHttp) { logger.info('Exiting (--no-http).'); process.exit(0) }

	try {
		function syncRuntimeConfigFromManager() {
			Object.assign(config, Config.buildConfig(cli, configManager))
		}

		const state = new StateManager({ logger: debugLog })
		const pBanks = persistence.get('programLayerBankByChannel'); const pSceneDeck = persistence.get('scene_deck')
		const appCtx = {
			config, state, variables: state.variables, gatheredInfo: { channelIds: [], channelStatusLines: {}, channelXml: {}, infoConfig: '', infoPaths: '', infoSystem: '', decklinkFromConfig: {} },
			CHOICES_MEDIAFILES: [], CHOICES_TEMPLATES: [], mediaDetails: {}, programLayerBankByChannel: (pBanks && typeof pBanks === 'object' && !Array.isArray(pBanks)) ? { ...pBanks } : {},
			_multiviewLayout: persistence.get('multiviewLayout') || null,
			sceneDeck: (pSceneDeck && typeof pSceneDeck === 'object' && Array.isArray(pSceneDeck.looks)) ? { looks: pSceneDeck.looks, previewSceneId: String(pSceneDeck.previewSceneId || '').trim() || null, layerPresets: pSceneDeck.layerPresets || [], lookPresets: pSceneDeck.lookPresets || [] } : { looks: [], previewSceneId: null, layerPresets: [], lookPresets: [] },
			persistence, amcp: null, timelineEngine: null, oscState: null, _casparStatus: { connected: false, host: config.caspar.host, port: config.caspar.port }, configManager, samplingManager: null,
			resetConfigToDefaults: () => configManager.factoryReset(),
			log: (level, msg) => { const l = level === 'error' ? logger.error : (level === 'warn' ? logger.warn : (level === 'info' ? logger.info : debugLog.debug)); l(msg) }
		}
		writeSystemInventoryFile(appCtx.log, config); const invSec = Math.max(0, parseInt(process.env.HIGHASCG_SYSTEM_INVENTORY_REFRESH_SEC || '0', 10) || 0)
		if (invSec > 0) appCtx._startupInventoryInterval = setInterval(() => writeSystemInventoryFile(appCtx.log, config), invSec * 1000)

		appCtx.timelineEngine = new TimelineEngine(appCtx); appCtx.clipEndFadeWatcher = new ClipEndFadeWatcher(appCtx)
		appCtx.getState = () => getState(appCtx); appCtx.startPeriodicSync = (self) => startPeriodicSync(self || appCtx)
		appCtx.refreshConfigComparison = refreshConfigComparison; appCtx.samplingManager = new SamplingManager(appCtx)
		Modules.loadOptionalModules(config, appCtx.log)

		const startTime = Date.now(); appCtx._systemVarsInterval = setInterval(() => {
			const uptime = Math.floor((Date.now() - startTime) / 1000); const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
			appCtx.state.setVariable('app_uptime', `${uptime}s`); appCtx.state.setVariable('app_memory_usage', `${mem}MB`)
		}, 5000)

		const { stopStreamingSubsystem, toggleStreaming, restartStreaming, enqueueStreaming, handleCasparConnected, handleConfigReload } = createStreamingLifecycle({ appCtx, config, logger, getChannelMap, go2rtcManager, addStreamingConsumers, removeStreamingConsumers, resolveFreeStreamingBasePort, prepareNdiStreaming, resolveCaptureTier })
		appCtx.toggleStreaming = toggleStreaming; appCtx.restartStreaming = restartStreaming; appCtx.enqueueStreaming = enqueueStreaming
		const fetchInfo = createFetchServerInfoConfigAndBroadcast({ appCtx, config, onAfterInfoConfigReady: () => handleCasparConnected() })
		if (!config.streaming.enabled) void enqueueStreaming(async () => await stopStreamingSubsystem())

		configManager.on('change', () => {
			logger.info('[Config] Reloading subsystems...'); syncRuntimeConfigFromManager()
			if (appCtx.restartOscSubsystem) appCtx.restartOscSubsystem(); handleConfigReload()
			if (appCtx.samplingManager) appCtx.samplingManager.updateConfig(config.dmx).catch(e => appCtx.log('error', '[DMX] update failed: ' + (e.message || e)))
			if (casparConn) {
				if (config.offline_mode) {
					casparConn.stop()
					appCtx.state.setVariable('caspar_connected', 'true')
				} else {
					casparConn.start()
				}
			}
			appCtx.state.setVariable('offline_mode', config.offline_mode ? 'true' : 'false')
		})

		let casparConn = null; if (!cli.noCaspar) {
			const hMs = parseInt(process.env.HIGHASCG_AMCP_HEALTH_MS || '0', 10) || 0; const sMs = parseInt(process.env.HIGHASCG_AMCP_CONNECT_SETTLE_MS || '600', 10) || 600
			casparConn = new ConnectionManager({ host: config.caspar.host, port: config.caspar.port, config, log: appCtx.log, healthIntervalMs: hMs, healthConnectDelayMs: sMs })
			appCtx.amcp = casparConn.amcp; appCtx.casparConnection = casparConn
		}

		const httpServer = startHttpServer({ port: config.server.httpPort, bindAddress: config.server.bindAddress, webDir: path.join(__dirname, 'web'), templatesDir: path.join(__dirname, 'templates'), vendorDirs: Modules.buildVendorDirs(logger), routeApi: (m, p, b, r) => routeRequest(m, p, b, appCtx, r), log: m => logger.info(m) })
		const wsBroadcastMs = cli.wsBroadcastMs || parseInt(process.env.HIGHASCG_WS_BROADCAST_MS || '0', 10) || 0
		appCtx.onFirstWebSocketClient = (ctx) => notifyWebSocketClientConnected(ctx)
		const wsHandle = attachWebSocketServer(httpServer, appCtx, { log: m => logger.info(m), stateBroadcastIntervalMs: wsBroadcastMs })
		appCtx._stopUsbHotplugWatcher = startUsbHotplugWatcher(appCtx)

		logBuffer.setOnNewLine(line => { try { if (typeof appCtx._wsBroadcast === 'function') appCtx._wsBroadcast('log_line', line) } catch (_) {} })
		appCtx.timelineEngine.on('playback', pb => { if (typeof appCtx._wsBroadcast === 'function') appCtx._wsBroadcast('timeline.playback', pb) })
		moduleRegistry.bootAll(appCtx)

		if (casparConn) {
			let wasConnected = false; casparConn.on('status', payload => {
				appCtx._casparStatus = { ...appCtx._casparStatus, ...payload }
				if (payload.connected !== undefined) appCtx.state.setVariable('caspar_connected', payload.connected ? 'true' : 'false')
				if (payload.version) appCtx.state.setVariable('caspar_version', payload.version)
				if (typeof appCtx._wsBroadcast === 'function') appCtx._wsBroadcast('change', { path: 'caspar.connection', value: appCtx._casparStatus })
				if (payload.connected === true && !wasConnected) {
					wasConnected = true
					setTimeout(() => void fetchInfo(), 800)
					if (typeof appCtx.startPeriodicSync === 'function') appCtx.startPeriodicSync(appCtx)
					startOscPlaybackInfoSupplement(appCtx)
					if (appCtx.samplingManager) appCtx.samplingManager.updateConfig(config.dmx).catch(e => appCtx.log('error', '[DMX] Initial failed: ' + (e.message || e)))
				} else if (payload.connected === false) { wasConnected = false; (require('./src/utils/periodic-sync')).clearPeriodicSyncTimer(appCtx); if (appCtx.clipEndFadeWatcher) appCtx.clipEndFadeWatcher.cancelAll() }
				if (config.offline_mode) appCtx.state.setVariable('caspar_connected', 'true')
			}); casparConn.on('error', err => appCtx.log('warn', 'Caspar TCP: ' + (err.message || err)))
			
			if (!config.offline_mode) {
				casparConn.start()
			}
		}

		const { startOscSubsystem, stopOscSubsystem, restartOscSubsystem, getOscReceiverStats } = createOscLifecycle({ appCtx, config, cli, logger, normalizeOscConfig, OscState, OscListener, applyOscSnapshotToVariables, clearOscVariables, startOscPlaybackInfoSupplement })
		startOscSubsystem(); appCtx.restartOscSubsystem = restartOscSubsystem; appCtx.getOscReceiverStats = getOscReceiverStats

		const shutdown = Shutdown.createShutdownHandler({ logger, appCtx, moduleRegistry, stopStreamingSubsystem, stopOscSubsystem, wsHandle, httpServer })
		process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
	} catch (e) {
		logger.error(`[Main] CRITICAL STARTUP ERROR: ${e.message}\n${e.stack}`)
		logger.info('[Main] Attempting to start minimal Safe Mode UI...')
		try {
			// Minimal Context for UI
			const safeCtx = { config, log: (l, m) => logger.info(`[SafeMode] ${m}`), configManager }
			const httpServer = startHttpServer({ 
				port: config.server.httpPort, 
				bindAddress: config.server.bindAddress, 
				webDir: path.join(__dirname, 'web'), 
				templatesDir: path.join(__dirname, 'templates'), 
				vendorDirs: [], 
				routeApi: (m, p, b, r) => routeRequest(m, p, b, safeCtx, r), 
				log: m => logger.info(`[SafeMode HTTP] ${m}`) 
			})
			logger.info(`[SafeMode] UI active on port ${config.server.httpPort}. Use the web interface to fix configuration.`)
		} catch (inner) {
			logger.error(`[Main] Safe Mode fallback also failed: ${inner.message}. Exiting.`)
			process.exit(1)
		}
	}
}
main()
