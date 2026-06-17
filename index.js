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
const { resolveCaptureTier } = require('./src/streaming/stream-capture-tier')
const { addStreamingConsumers, removeStreamingConsumers } = require('./src/streaming/caspar-ffmpeg-setup')
const { resolveFreeStreamingBasePort } = require('./src/streaming/streaming-udp-ports'); const { prepareNdiStreaming } = require('./src/streaming/ndi-resolve')
const { startPeriodicSync, startOscPlaybackInfoSupplement } = require('./src/utils/periodic-sync')
const { ConfigManager } = require('./src/config/config-manager'); const { refreshConfigComparison } = require('./src/config/config-compare')
const { hashSubsystemReload } = require('./src/config/config-reload-signature')
const { SamplingManager } = require('./src/sampling/dmx-sampling')
const { getChannelMap, setupAllRouting } = require('./src/config/routing')
const { reconcileAfterInfoGather } = require('./src/state/live-scene-reconcile'); const { createStreamingLifecycle } = require('./src/bootstrap/streaming-lifecycle')
const { createOscLifecycle } = require('./src/bootstrap/osc-lifecycle'); const { createFetchServerInfoConfigAndBroadcast } = require('./src/bootstrap/fetch-server-info-config')
const { notifyWebSocketClientConnected, tryClearStartupLedTestForWebUi } = require('./src/bootstrap/startup-led-test-pattern'); const { writeSystemInventoryFile } = require('./src/bootstrap/system-inventory-file')
const { startOsLayoutWatchdog } = require('./src/bootstrap/os-layout-watchdog')
const { parseInfoConfigForDecklinks } = require('./src/utils/decklink-enum')
const { runConnectionQueryCycle } = require('./src/utils/query-cycle')
const moduleRegistry = require('./src/module-registry')
const { applyUiSelectionPayloadToVariables } = require('./src/api/apply-ui-selection-variables')
const { ArtnetReceiver } = require('./src/artnet/artnet-receiver')

const Args = require('./src/bootstrap/args'); const Config = require('./src/bootstrap/config'); const Modules = require('./src/bootstrap/modules'); const Shutdown = require('./src/bootstrap/shutdown')
const { REPO_ROOT, resolveWebDir } = require('./src/repo-paths')
const { isHeadlessMode } = require('./src/server/headless-mode')

/** Load repo `.env` when vars are unset (deploy / dev convenience; no dependency). */
function loadRepoDotEnv() {
	const envPath = path.join(REPO_ROOT, '.env')
	if (!fs.existsSync(envPath)) return
	for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq <= 0) continue
		const key = trimmed.slice(0, eq).trim()
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] != null) continue
		let val = trimmed.slice(eq + 1).trim()
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1)
		}
		process.env[key] = val
	}
}
loadRepoDotEnv()

const WEB_DIR = resolveWebDir(REPO_ROOT)

const logger = createLogger({ minLevel: 'info', onLine: logBuffer.appendHighasLine }); const debugLog = createLogger({ minLevel: 'debug', onLine: logBuffer.appendHighasLine })

function main() {
	const cli = Args.parseArgs(process.argv); if (cli.help) { Args.printHelp(); process.exit(0) }
	let configPath = process.env.HIGHASCG_CONFIG_PATH ? path.resolve(process.env.HIGHASCG_CONFIG_PATH) : path.join(REPO_ROOT, 'highascg.config.json')
	const modularDir = path.join(REPO_ROOT, 'config')
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
			log: (level, msg) => { const l = level === 'error' ? logger.error : (level === 'warn' ? logger.warn : (level === 'info' ? logger.info : debugLog.debug)); l(msg) },
			setUiSelection: (ctx, data) => {
				try {
					if (!ctx?.state || typeof applyUiSelectionPayloadToVariables !== 'function') return
					applyUiSelectionPayloadToVariables(ctx.state, data && typeof data === 'object' ? data : {})
				} catch (e) {
					const m = e instanceof Error ? e.message : String(e)
					ctx.log?.('warn', `[selection] ${m}`)
				}
			},
		}
		writeSystemInventoryFile(appCtx.log, config, { configManager }); const invSec = Math.max(0, parseInt(process.env.HIGHASCG_SYSTEM_INVENTORY_REFRESH_SEC || '0', 10) || 0)
		if (invSec > 0) {
			appCtx._startupInventoryInterval = setInterval(
				() => writeSystemInventoryFile(appCtx.log, config, { configManager }),
				invSec * 1000,
			)
		}

		appCtx.timelineEngine = new TimelineEngine(appCtx); appCtx.clipEndFadeWatcher = new ClipEndFadeWatcher(appCtx)
		appCtx.getState = () => getState(appCtx)
		appCtx.getStateWsBootstrap = () => getState(appCtx, { slimCatalog: true })
		appCtx.startPeriodicSync = (self) => startPeriodicSync(self || appCtx)
		appCtx.refreshConfigComparison = refreshConfigComparison; appCtx.samplingManager = new SamplingManager(appCtx)
		appCtx.parseInfoConfigForDecklinks = parseInfoConfigForDecklinks
		appCtx.setupAllRouting = setupAllRouting
		appCtx.reconcileAfterInfoGather = reconcileAfterInfoGather
		
		appCtx.artnetReceiver = new ArtnetReceiver(appCtx)
		if (config.dmx?.artnetInputEnabled !== false) {
			appCtx.artnetReceiver.init()
		}
		Modules.loadOptionalModules(config, appCtx.log)

		const startTime = Date.now(); appCtx._systemVarsInterval = setInterval(() => {
			const uptime = Math.floor((Date.now() - startTime) / 1000); const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
			appCtx.state.setVariable('app_uptime', `${uptime}s`); appCtx.state.setVariable('app_memory_usage', `${mem}MB`)
		}, 5000)

		const { stopStreamingSubsystem, toggleStreaming, restartStreaming, enqueueStreaming, handleCasparConnected, handleConfigReload } = createStreamingLifecycle({ appCtx, config, logger, getChannelMap, addStreamingConsumers, removeStreamingConsumers, resolveFreeStreamingBasePort, prepareNdiStreaming, resolveCaptureTier })
		appCtx.toggleStreaming = toggleStreaming; appCtx.restartStreaming = restartStreaming; appCtx.enqueueStreaming = enqueueStreaming
		const fetchInfo = createFetchServerInfoConfigAndBroadcast({
			appCtx,
			config,
			onAfterInfoConfigReady: () => {
				handleCasparConnected()
				void setupAllRouting(appCtx).catch((e) => {
					appCtx.log('warn', 'Routing setup: ' + (e?.message || e))
				})
				void reconcileAfterInfoGather(appCtx).catch((e) => {
					appCtx.log('debug', 'Live scene reconcile: ' + (e?.message || e))
				})
			},
		})
		if (!config.streaming.enabled) void enqueueStreaming(async () => await stopStreamingSubsystem())

		/** Subsystem recycle hash — null until first config change after boot. */
		let subsystemReloadSig = null

		configManager.on('change', () => {
			syncRuntimeConfigFromManager()
			const forceReload =
				process.env.HIGHASCG_CONFIG_FORCE_RELOAD === '1' ||
				String(process.env.HIGHASCG_CONFIG_FORCE_RELOAD || '').toLowerCase() === 'true'
			const nextSig = hashSubsystemReload(config)
			if (!forceReload && subsystemReloadSig !== null && nextSig === subsystemReloadSig) {
				logger.info('[Config] Applied file change; subsystem recycle skipped (Caspar / OSC / streaming / DMX signature unchanged).')
				return
			}
			subsystemReloadSig = nextSig
			logger.info('[Config] Reloading subsystems...')
			if (appCtx.restartOscSubsystem) appCtx.restartOscSubsystem(); handleConfigReload()
			if (appCtx.samplingManager) appCtx.samplingManager.updateConfig(config.dmx).catch(e => appCtx.log('error', '[DMX] update failed: ' + (e.message || e)))
			if (appCtx.artnetReceiver) appCtx.artnetReceiver.reconfigure()
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
			casparConn.context.parseInfoConfigForDecklinks = parseInfoConfigForDecklinks
			casparConn.context.gatheredInfo = appCtx.gatheredInfo
		}

		if (!isHeadlessMode()) {
			logger.warn(
				'[HTTP] Serving Web UI from Node is deprecated for production playout. ' +
					'Set HIGHASCG_HEADLESS=true on the server and use the Electron launcher (npm run launcher). ' +
					'See docs/PLAN_SERVER_CLIENT_SPLIT.md'
			)
			if (process.env.HIGHASCG_WEB_DIR) {
				logger.warn('[HTTP] HIGHASCG_WEB_DIR is deprecated; prefer headless server + launcher or Vite dev.')
			}
		}

		const httpServer = startHttpServer({
			port: config.server.httpPort,
			bindAddress: config.server.bindAddress,
			webDir: WEB_DIR,
			templatesDir: path.join(REPO_ROOT, 'template'),
			vendorDirs: Modules.buildVendorDirs(logger),
			routeApi: (m, p, b, r) => routeRequest(m, p, b, appCtx, r),
			log: m => logger.info(m),
		})
		logger.info(`[HTTP] Static UI: ${WEB_DIR}`)
		const wsBroadcastMs = cli.wsBroadcastMs || parseInt(process.env.HIGHASCG_WS_BROADCAST_MS || '0', 10) || 0
		appCtx.onFirstWebSocketClient = (ctx) => notifyWebSocketClientConnected(ctx)
		const wsHandle = attachWebSocketServer(httpServer, appCtx, { log: m => logger.info(m), stateBroadcastIntervalMs: wsBroadcastMs })
		appCtx._stopUsbHotplugWatcher = startUsbHotplugWatcher(appCtx)

		logBuffer.setOnNewLine(line => { try { if (typeof appCtx._wsBroadcast === 'function') appCtx._wsBroadcast('log_line', line) } catch (_) {} })
		appCtx.timelineEngine.on('playback', pb => { if (typeof appCtx._wsBroadcast === 'function') appCtx._wsBroadcast('timeline.playback', pb) })
		moduleRegistry.bootAll(appCtx)
		appCtx._stopOsLayoutWatchdog = startOsLayoutWatchdog(appCtx)

		if (casparConn) {
			let wasConnected = false; casparConn.on('status', payload => {
				appCtx._casparStatus = { ...appCtx._casparStatus, ...payload }
				if (payload.connected !== undefined) appCtx.state.setVariable('caspar_connected', payload.connected ? 'true' : 'false')
				if (payload.version) appCtx.state.setVariable('caspar_version', payload.version)
				if (typeof appCtx._wsBroadcast === 'function') appCtx._wsBroadcast('change', { path: 'caspar.connection', value: appCtx._casparStatus })
				if (payload.connected === true && !wasConnected) {
					wasConnected = true
					const infoDelayMs = Math.max(
						0,
						parseInt(process.env.HIGHASCG_INFO_CONFIG_DELAY_MS || '800', 10) || 800,
					)
					setTimeout(() => void fetchInfo(), infoDelayMs)
					setTimeout(() => void tryClearStartupLedTestForWebUi(appCtx), 1500)
					runConnectionQueryCycle(appCtx)
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

		const shutdown = Shutdown.createShutdownHandler({ logger, appCtx, moduleRegistry, stopStreamingSubsystem, stopOscSubsystem, wsHandle, httpServer, persistence })
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
				webDir: WEB_DIR,
				templatesDir: path.join(REPO_ROOT, 'template'), 
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
