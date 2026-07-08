#!/usr/bin/env node
/**
 * HighAsCG — Orchestrator entry point.
 */
'use strict'

const path = require('path'); const os = require('os'); const fs = require('fs')
const { createLogger } = require('./src/utils/logger'); const logBuffer = require('./src/utils/log-buffer')
const { config: configLogger } = require('./src/utils/buffered-logger')
const { StateManager } = require('./src/state/state-manager')
const { startHttpServer, stopHttpServer } = require('./src/server/http-server'); const { attachWebSocketServer } = require('./src/server/ws-server')
const { startUsbHotplugWatcher } = require('./src/media/usb-drives'); const { routeRequest, getState } = require('./src/api/router')
const persistence = require('./src/utils/persistence'); const { TimelineEngine } = require('./src/engine/timeline-engine')
const { ClipEndFadeWatcher } = require('./src/engine/clip-end-fade'); const { ConnectionManager } = require('./src/caspar/connection-manager')
const { normalizeOscConfig } = require('./src/osc/osc-config'); const { OscState } = require('./src/osc/osc-state')
const { OscListener } = require('./src/osc/osc-listener'); const { applyOscSnapshotToVariables, clearOscVariables } = require('./src/osc/osc-variables')
const { startPeriodicSync, startOscPlaybackInfoSupplement } = require('./src/utils/periodic-sync')
const { ConfigManager } = require('./src/config/config-manager'); const { refreshConfigComparison } = require('./src/config/config-compare')
const { hashSubsystemReload } = require('./src/config/config-reload-signature')
const { SamplingManager } = require('./src/sampling/dmx-sampling')
const { getChannelMap, setupAllRouting, setupInputsChannel } = require('./src/config/routing')
const { reconcileAfterInfoGather } = require('./src/state/live-scene-reconcile'); const { createStreamingLifecycle } = require('./src/bootstrap/streaming-lifecycle')
const { createOscLifecycle } = require('./src/bootstrap/osc-lifecycle'); const { createFetchServerInfoConfigAndBroadcast } = require('./src/bootstrap/fetch-server-info-config')
const { createComposePreviewLifecycle } = require('./src/bootstrap/compose-preview-lifecycle')
const { createV4l2BridgeLifecycle } = require('./src/bootstrap/v4l2-bridge-lifecycle')
const { notifyWebSocketClientConnected, tryClearStartupLedTestForWebUi } = require('./src/bootstrap/startup-led-test-pattern'); const { writeSystemInventoryFile } = require('./src/bootstrap/system-inventory-file')
const { startReplicationService, stopReplicationService } = require('./src/replication/replication-service')
const { startOsLayoutWatchdog } = require('./src/bootstrap/os-layout-watchdog')
const { startCasparAmcpWatchdog } = require('./src/bootstrap/caspar-amcp-watchdog')
const { parseInfoConfigForDecklinks } = require('./src/utils/decklink-enum')
const { runConnectionQueryCycle, runMediaLibraryQueryCycle, bindAppCtxAmcpTransport } = require('./src/utils/query-cycle')
const moduleRegistry = require('./src/module-registry')
const { applyUiSelectionPayloadToVariables } = require('./src/api/apply-ui-selection-variables')
const { ArtnetReceiver } = require('./src/artnet/artnet-receiver')
const { createAppContext } = require('./src/app-context')
const { setSceneLiveBroadcastHooks } = require('./src/state/live-scene-state')
const { onSceneLiveBroadcast } = require('./src/companion-bridge/look-air-frames')

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
const { installProcessGuards } = require('./src/bootstrap/process-guards')

function main() {
	installProcessGuards({ logger, persistence })
	const cli = Args.parseArgs(process.argv); if (cli.help) { Args.printHelp(); process.exit(0) }
	let configPath = process.env.HIGHASCG_CONFIG_PATH ? path.resolve(process.env.HIGHASCG_CONFIG_PATH) : path.join(REPO_ROOT, 'highascg.config.json')
	const modularDir = path.join(REPO_ROOT, 'config')
	if (!process.env.HIGHASCG_CONFIG_PATH && fs.existsSync(modularDir) && fs.statSync(modularDir).isDirectory()) {
		configPath = modularDir
	}

	const configManager = new ConfigManager(configPath, configLogger)
	let config
	const auth = require('./src/server/auth')
	function applyAuthAndBindPolicy(cfg, cliArgs) {
		auth.setAuthRuntime({ enforceAuth: auth.isEnforceAuthActive(cfg) })
		auth.ensureApiToken({
			config: cfg,
			log: (level, msg) => {
				if (level === 'error') logger.error(msg)
				else if (level === 'warn') logger.warn(msg)
				else logger.info(msg)
			},
		})
		const bindLog = (level, msg) => {
			if (level === 'error') logger.error(msg)
			else if (level === 'warn') logger.warn(msg)
			else logger.info(msg)
		}
		if (!auth.validateExposurePolicy(cfg, bindLog)) {
			cfg.server = { ...cfg.server, bindAddress: '127.0.0.1' }
		} else {
			cfg.server = {
				...cfg.server,
				bindAddress: auth.resolveServerBindAddress(cfg, cliArgs.bindAddress),
			}
		}
		return cfg
	}
	try {
		configManager.load()
		config = Config.buildConfig(cli, configManager)
		config = applyAuthAndBindPolicy(config, cli)
	} catch (e) {
		logger.error(`[Main] Configuration failed to load: ${e.message}. Falling back to hardcoded defaults (Safe Mode).`)
		config = { ...require('./src/config/defaults') }
		config = applyAuthAndBindPolicy(config, cli)
	}

	logger.info('Config: ' + JSON.stringify(config, null, 2))
	if (cli.noHttp) { logger.info('Exiting (--no-http).'); process.exit(0) }

	try {
		function syncRuntimeConfigFromManager() {
			Object.assign(config, Config.buildConfig(cli, configManager))
			applyAuthAndBindPolicy(config, cli)
		}

		const state = new StateManager({ logger: debugLog })
		const appCtx = createAppContext({
			config,
			state,
			persistence,
			configManager,
			multiviewLayout: persistence.get('multiviewLayout') || null,
			casparHost: config.caspar.host,
			casparPort: config.caspar.port,
			log: (level, msg) => {
				const l =
					level === 'error'
						? logger.error
						: level === 'warn'
							? logger.warn
							: level === 'info'
								? logger.info
								: debugLog.debug
				l(msg)
			},
			resetConfigToDefaults: () => {
				const ok = configManager.factoryReset()
				if (ok) {
					syncRuntimeConfigFromManager()
					if (appCtx.gatheredInfo && typeof appCtx.gatheredInfo === 'object') {
						appCtx.gatheredInfo.decklinkFromConfig = {}
					}
					try {
						const { resetGpuPhysicalTopologyForFactoryReset } = require('./src/bootstrap/gpu-topology-factory-reset')
						resetGpuPhysicalTopologyForFactoryReset(configManager, (level, msg) => appCtx.log(level, msg))
						syncRuntimeConfigFromManager()
					} catch (e) {
						debugLog.warn(`[Config] Factory reset: GPU layout sync failed: ${e?.message || e}`)
					}
					try {
						const { writeSystemInventoryFile } = require('./src/bootstrap/system-inventory-file')
						writeSystemInventoryFile(appCtx.log, config, { configManager })
					} catch (e) {
						debugLog.warn(`[Config] Factory reset: could not refresh system inventory: ${e?.message || e}`)
					}
					try {
						const { clearPersistedOsLayout } = require('./src/utils/os-config')
						clearPersistedOsLayout({ reason: 'factory reset' })
					} catch (e) {
						debugLog.warn(`[Config] Factory reset: could not clear OS layout script: ${e?.message || e}`)
					}
					void setupInputsChannel(appCtx).catch((e) => {
						appCtx.log('warn', `[Config] Factory reset decklink status: ${e?.message || e}`)
					})
					try {
						const { clearPersistedMultiviewLayout } = require('./src/state/clear-multiview-layout')
						clearPersistedMultiviewLayout(appCtx)
					} catch (e) {
						debugLog.warn(`[Config] Factory reset: could not clear multiview layout: ${e?.message || e}`)
					}
				}
				return ok
			},
			setUiSelection: (ctx, data) => {
				try {
					if (!ctx?.state || typeof applyUiSelectionPayloadToVariables !== 'function') return
					applyUiSelectionPayloadToVariables(ctx.state, data && typeof data === 'object' ? data : {})
				} catch (e) {
					const m = e instanceof Error ? e.message : String(e)
					ctx.log?.('warn', `[selection] ${m}`)
				}
			},
		})
		setSceneLiveBroadcastHooks({ onSceneLiveBroadcast })
		try {
			const { ensureHardwareHostname } = require('./src/system/hardware-identity')
			const hw = ensureHardwareHostname(appCtx)
			if (hw.hostnameApplied) {
				appCtx.log('info', `[hardware-identity] applied hostname ${hw.identity.hostname}`)
			} else if (hw.hostnameError) {
				appCtx.log('warn', `[hardware-identity] hostname not applied: ${hw.hostnameError}`)
			}
		} catch (e) {
			appCtx.log('warn', `[hardware-identity] ${e?.message || e}`)
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
		appCtx.runMediaLibraryQueryCycle = () => runMediaLibraryQueryCycle(appCtx)
		appCtx.startPeriodicSync = (self) => startPeriodicSync(self || appCtx)
		appCtx.refreshConfigComparison = refreshConfigComparison; appCtx.samplingManager = new SamplingManager(appCtx)
		appCtx.parseInfoConfigForDecklinks = parseInfoConfigForDecklinks
		appCtx.setupAllRouting = setupAllRouting
		appCtx.reconcileAfterInfoGather = reconcileAfterInfoGather
		
		appCtx._composePreviewLifecycle = createComposePreviewLifecycle({ appCtx })
		appCtx._v4l2BridgeLifecycle = createV4l2BridgeLifecycle({ appCtx })
		appCtx._loopRestartWatchdog = require('./src/engine/loop-restart-watchdog').startLoopRestartWatchdog(appCtx)
		appCtx.artnetReceiver = new ArtnetReceiver(appCtx)
		if (config.dmx?.artnetInputEnabled !== false) {
			appCtx.artnetReceiver.init()
		}
		Modules.loadOptionalModules(config, appCtx.log)

		const startTime = Date.now(); appCtx._systemVarsInterval = setInterval(() => {
			const uptime = Math.floor((Date.now() - startTime) / 1000); const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
			appCtx.state.setVariable('app_uptime', `${uptime}s`); appCtx.state.setVariable('app_memory_usage', `${mem}MB`)
		}, 5000)

		const { stopStreamingSubsystem, toggleStreaming, restartStreaming, enqueueStreaming, handleCasparConnected, handleConfigReload } = createStreamingLifecycle({ appCtx, config, getChannelMap })
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
				if (appCtx._composePreviewLifecycle) appCtx._composePreviewLifecycle.onConfigChange()
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
			if (appCtx._composePreviewLifecycle) appCtx._composePreviewLifecycle.onConfigChange()
			if (appCtx._v4l2BridgeLifecycle) appCtx._v4l2BridgeLifecycle.onConfigChange()
			try {
				const { syncOperatorPointerConfine } = require('./src/system/pointer-confine')
				syncOperatorPointerConfine(config, { log: (level, msg) => appCtx.log(level, msg) })
			} catch (e) {
				appCtx.log('warn', `[Pointer confine] Config sync failed: ${e?.message || e}`)
			}
			try {
				const { syncCefInteractiveBridge } = require('./src/system/cef-interactive-bridge')
				void syncCefInteractiveBridge(config, {
					log: (level, msg) => appCtx.log(level, msg),
					amcp: appCtx.amcp,
				})
			} catch (e) {
				appCtx.log('warn', `[CEF bridge] Config sync failed: ${e?.message || e}`)
			}
		})

		let casparConn = null; if (!cli.noCaspar) {
			const hMs = parseInt(process.env.HIGHASCG_AMCP_HEALTH_MS || '0', 10) || 0; const sMs = parseInt(process.env.HIGHASCG_AMCP_CONNECT_SETTLE_MS || '600', 10) || 600
			casparConn = new ConnectionManager({ host: config.caspar.host, port: config.caspar.port, config, log: appCtx.log, healthIntervalMs: hMs, healthConnectDelayMs: sMs })
			appCtx.amcp = casparConn.amcp; appCtx.casparConnection = casparConn
			bindAppCtxAmcpTransport(appCtx, casparConn)
			casparConn.context.parseInfoConfigForDecklinks = parseInfoConfigForDecklinks
			casparConn.context.gatheredInfo = appCtx.gatheredInfo
		}

		if (!isHeadlessMode()) {
			logger.info(
				'[HTTP] Serving operator UI from dist-web/ on :' +
					config.server.httpPort +
					' (unified repo: client/ → dist-web/ on :' +
					config.server.httpPort +
					'). ' +
					'Optional Electron launcher (highascg-client) = sim/multiserver/modules — see docs/ARCHITECTURE.md'
			)
			if (process.env.HIGHASCG_WEB_DIR) {
				logger.info(`[HTTP] UI directory override: HIGHASCG_WEB_DIR=${process.env.HIGHASCG_WEB_DIR}`)
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
		appCtx._getWsLogLineStats = typeof wsHandle.getLogLineStats === 'function' ? () => wsHandle.getLogLineStats() : null
		startReplicationService(appCtx, {
			clients: wsHandle.clients,
			getOperatorWsCount: () => wsHandle.clients.size,
		})
		appCtx._stopReplicationService = () => stopReplicationService(appCtx)
		appCtx._stopUsbHotplugWatcher = startUsbHotplugWatcher(appCtx)

		logBuffer.setOnNewLine((record) => {
			try {
				if (typeof appCtx._wsBroadcast === 'function') {
					const payload =
						typeof record === 'string'
							? record
							: { ...record, line: record.line || String(record.message || '') }
					appCtx._wsBroadcast('log_line', payload)
				}
			} catch (_) {}
		})
		appCtx.timelineEngine.on('playback', pb => {
			if (typeof appCtx._wsBroadcast === 'function') appCtx._wsBroadcast('timeline.playback', pb)
			if (typeof appCtx.markReplicationLiveStateDirty === 'function') appCtx.markReplicationLiveStateDirty()
		})
		moduleRegistry.bootAll(appCtx)
		try {
			const { syncOperatorPointerConfine } = require('./src/system/pointer-confine')
			syncOperatorPointerConfine(config, { log: (level, msg) => appCtx.log(level, msg) })
		} catch (e) {
			appCtx.log('warn', `[Pointer confine] Boot sync failed: ${e?.message || e}`)
		}
		try {
			const { syncCefInteractiveBridge } = require('./src/system/cef-interactive-bridge')
			void syncCefInteractiveBridge(config, {
				log: (level, msg) => appCtx.log(level, msg),
				amcp: appCtx.amcp,
			})
		} catch (e) {
			appCtx.log('warn', `[CEF bridge] Boot sync failed: ${e?.message || e}`)
		}
		setTimeout(() => {
			const { maybeAutoLoginOnBoot } = require('./src/network/tailscale-service')
			void maybeAutoLoginOnBoot({ log: (level, msg) => appCtx.log(level, msg) }).catch((e) => {
				appCtx.log('warn', `[tailscale] Boot auto-login: ${e?.message || e}`)
			})
		}, 4000)
		appCtx._stopOsLayoutWatchdog = startOsLayoutWatchdog(appCtx)

		if (casparConn && !config.offline_mode) {
			appCtx._stopCasparAmcpWatchdog = startCasparAmcpWatchdog(appCtx)
		}

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
					if (appCtx._composePreviewLifecycle) appCtx._composePreviewLifecycle.onCasparConnected()
					if (appCtx._v4l2BridgeLifecycle) appCtx._v4l2BridgeLifecycle.onCasparConnected()
					try {
						const { syncCefInteractiveBridge } = require('./src/system/cef-interactive-bridge')
						void syncCefInteractiveBridge(config, {
							log: (level, msg) => appCtx.log(level, msg),
							amcp: appCtx.amcp,
						})
					} catch (e) {
						appCtx.log('warn', `[CEF bridge] Caspar connect sync failed: ${e?.message || e}`)
					}
				} else if (payload.connected === false) {
					wasConnected = false
					if (appCtx._composePreviewLifecycle) appCtx._composePreviewLifecycle.onCasparDisconnected()
					if (appCtx._v4l2BridgeLifecycle) appCtx._v4l2BridgeLifecycle.onCasparDisconnected()
					;(require('./src/utils/periodic-sync')).clearPeriodicSyncTimer(appCtx)
					;(require('./src/audio/meter-health')).stopLiveInputMeterHealthWatch(appCtx)
					if (appCtx.clipEndFadeWatcher) appCtx.clipEndFadeWatcher.cancelAll()
				}
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
			const safeShutdown = () => {
				try {
					persistence.flushSync()
				} catch (e) {
					logger.warn(`[SafeMode] persistence flush: ${e?.message || e}`)
				}
				stopHttpServer(httpServer, () => process.exit(0))
			}
			process.on('SIGINT', safeShutdown)
			process.on('SIGTERM', safeShutdown)
			logger.info(`[SafeMode] UI active on port ${config.server.httpPort}. Use the web interface to fix configuration.`)
		} catch (inner) {
			logger.error(`[Main] Safe Mode fallback also failed: ${inner.message}. Exiting.`)
			process.exit(1)
		}
	}
}
main()
