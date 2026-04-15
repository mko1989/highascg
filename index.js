#!/usr/bin/env node
'use strict'

const os = require('os')
const path = require('path')
const defaults = require('./config/default')
const { createLogger } = require('./src/utils/logger')
const logBuffer = require('./src/utils/log-buffer')
const { StateManager } = require('./src/state/state-manager')
const { startHttpServer, stopHttpServer } = require('./src/server/http-server')
const { attachWebSocketServer } = require('./src/server/ws-server')
const { routeRequest, getState } = require('./src/api/router')
const persistence = require('./src/utils/persistence')
const { TimelineEngine } = require('./src/engine/timeline-engine')
const { ClipEndFadeWatcher } = require('./src/engine/clip-end-fade')
const { ConnectionManager } = require('./src/caspar/connection-manager')
const { normalizeOscConfig } = require('./src/osc/osc-config')
const { OscState } = require('./src/osc/osc-state')
const { OscListener } = require('./src/osc/osc-listener')
const { applyOscSnapshotToVariables, clearOscVariables } = require('./src/osc/osc-variables')
const { resolveStreamingConfig } = require('./src/streaming/stream-config')
const { go2rtcManager, resolveCaptureTier } = require('./src/streaming/go2rtc-manager')
const { addStreamingConsumers, removeStreamingConsumers } = require('./src/streaming/caspar-ffmpeg-setup')
const { resolveFreeStreamingBasePort } = require('./src/streaming/streaming-udp-ports')
const { prepareNdiStreaming } = require('./src/streaming/ndi-resolve')
const {
	startPeriodicSync,
	clearPeriodicSyncTimer,
	runMediaClsTlsRefresh,
	startOscPlaybackInfoSupplement,
} = require('./src/utils/periodic-sync')
const { ConfigManager } = require('./src/config/config-manager')
const { refreshConfigComparison } = require('./src/config/config-compare')
const { applyCasparConfigToDiskAndRestart } = require('./src/api/routes-caspar-config')
const { SamplingManager } = require('./src/sampling/dmx-sampling')
const { getChannelMap } = require('./src/config/routing')
const { createStreamingLifecycle } = require('./src/bootstrap/streaming-lifecycle')
const { createOscLifecycle } = require('./src/bootstrap/osc-lifecycle')
const { createFetchServerInfoConfigAndBroadcast } = require('./src/bootstrap/fetch-server-info-config')

{
	const n = parseInt(process.env.HIGHASCG_LOG_BUFFER_LINES || '4000', 10)
	if (Number.isFinite(n) && n >= 100) logBuffer.setMaxLines(n)
}
const logger = createLogger({ minLevel: 'info', onLine: logBuffer.appendHighasLine })
const debugLog = createLogger({ minLevel: 'debug', onLine: logBuffer.appendHighasLine })

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
	const opts = {}
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--help' || a === '-h') opts.help = true
		else if ((a === '--port' || a === '-p') && argv[i + 1]) opts.httpPort = parseInt(argv[++i], 10)
		else if (a === '--ws-port' && argv[i + 1]) opts.wsPort = parseInt(argv[++i], 10)
		else if (a === '--caspar-host' && argv[i + 1]) opts.casparHost = argv[++i]
		else if (a === '--caspar-port' && argv[i + 1]) opts.casparPort = parseInt(argv[++i], 10)
		else if (a === '--bind' && argv[i + 1]) opts.bindAddress = argv[++i]
		else if (a === '--no-http') opts.noHttp = true
		else if (a === '--no-caspar') opts.noCaspar = true
		else if (a === '--no-osc') opts.noOsc = true
		else if (a === '--ws-broadcast-ms' && argv[i + 1]) opts.wsBroadcastMs = parseInt(argv[++i], 10)
	}
	return opts
}

function buildConfig(cli, configManager) {
	const cfg = JSON.parse(JSON.stringify(configManager.get()))

	if (cli.casparHost != null) cfg.caspar.host = cli.casparHost
	if (cli.casparPort != null && !Number.isNaN(cli.casparPort)) cfg.caspar.port = cli.casparPort
	if (cli.httpPort != null && !Number.isNaN(cli.httpPort)) cfg.server.httpPort = cli.httpPort
	if (cli.wsPort != null && !Number.isNaN(cli.wsPort)) cfg.server.wsPort = cli.wsPort
	if (cli.bindAddress != null) cfg.server.bindAddress = cli.bindAddress
	cfg.osc = normalizeOscConfig(cfg)
	if (cli.noOsc) cfg.osc.enabled = false

	if (cfg.periodic_sync_interval_sec === null && process.env.HIGHASCG_PERIODIC_SYNC_SEC != null && process.env.HIGHASCG_PERIODIC_SYNC_SEC !== '') {
		const n = parseInt(process.env.HIGHASCG_PERIODIC_SYNC_SEC, 10)
		if (Number.isFinite(n) && n > 0) cfg.periodic_sync_interval_sec = n
	}
	if (cfg.periodic_sync_interval_sec_osc === null && process.env.HIGHASCG_PERIODIC_SYNC_OSC_SEC != null && process.env.HIGHASCG_PERIODIC_SYNC_OSC_SEC !== '') {
		const n = parseInt(process.env.HIGHASCG_PERIODIC_SYNC_OSC_SEC, 10)
		if (Number.isFinite(n) && n > 0) cfg.periodic_sync_interval_sec_osc = n
	}

	cfg.streaming = resolveStreamingConfig(cfg.streaming || {})
	if (process.env.HIGHASCG_STREAMING_AUTO_RELOCATE === '0') {
		cfg.streaming.autoRelocateBasePort = false
	} else if (process.env.HIGHASCG_STREAMING_AUTO_RELOCATE === '1') {
		cfg.streaming.autoRelocateBasePort = true
	}

	const batchEnv = process.env.HIGHASCG_AMCP_BATCH
	if (batchEnv === '1' || String(batchEnv).toLowerCase() === 'true') cfg.amcp_batch = true
	else if (batchEnv === '0' || String(batchEnv).toLowerCase() === 'false') cfg.amcp_batch = false

	return cfg
}

function printHelp() {
	const d = defaults
	console.log(`highascg — HighAsCG standalone server

Usage:
  node index.js [options]

Options:
  --port, -p <n>     HTTP server port (default ${d.server.httpPort}, env HTTP_PORT or PORT)
  --ws-port <n>      Reserved for split WS port (future); WS uses HTTP port for now
  --caspar-host <h>  CasparCG host (default ${d.caspar.host}; env CASPAR_HOST seeds first run only if no highascg.config.json)
  --caspar-port <n>  CasparCG AMCP port (default ${d.caspar.port}, env CASPAR_PORT)
  --bind <addr>      Bind address (default ${d.server.bindAddress}, env BIND_ADDRESS)
  --ws-broadcast-ms <n>  Periodic WebSocket state broadcast (0 = off; env HIGHASCG_WS_BROADCAST_MS)
  --no-caspar        Do not open AMCP TCP (web UI only; API returns 503 for Caspar routes)
  --no-osc           Do not bind OSC UDP listener (see config.osc / OSC_LISTEN_PORT)
  --no-http          Do not start HTTP (print config and exit)
  -h, --help         Show this help

Environment:
  HIGHASCG_CONFIG_PATH   Absolute path to highascg.config.json (default: next to index.js)
  HIGHASCG_STREAMING_AUTO_RELOCATE  Set to 0 to disable auto-relocation when preview UDP ports are busy
  HIGHASCG_GO2RTC_PUSH_WAIT_MS  Max wait (ms) for go2rtc MPEG-TS producers after start (default 10000; 0=skip)
  HIGHASCG_GO2RTC_STOP_KILL_MS  SIGKILL go2rtc if still running after this many ms on stop (default 1000)
  HIGHASCG_STREAMING_RESTART_DELAY_MS  Pause between stop and start on preview restart (default 500)
  HIGHASCG_AMCP_SEND_TIMEOUT_MS  Per-command AMCP timeout for short replies (default 15000)
  HIGHASCG_AMCP_LONG_RESPONSE_MS  Timeout for INFO/CLS/TLS/thumbnail/CINF (default 120000)
  HIGHASCG_AMCP_CONNECT_SETTLE_MS  Wait this long before first VERSION after TCP connect (default 600; 0 = immediate)
  HIGHASCG_AMCP_HEALTH_MS  Periodic VERSION health probe in ms (default 0 = off; set e.g. 30000 to enable)
  HIGHASCG_AMCP_BATCH      Set to 1 to enable AMCP BEGIN…COMMIT batching (default off; safer for Caspar stability)
`)
}

function main() {
	const cli = parseArgs(process.argv)
	if (cli.help) {
		printHelp()
		process.exit(0)
	}

	const configPath = process.env.HIGHASCG_CONFIG_PATH
		? path.resolve(process.env.HIGHASCG_CONFIG_PATH)
		: path.join(__dirname, 'highascg.config.json')
	const configManager = new ConfigManager(configPath, logger)
	configManager.load()

	const config = buildConfig(cli, configManager)
	logger.info('Config: ' + JSON.stringify(config, null, 2))
	try {
		const u = os.userInfo()
		logger.info(
			`[Process] uid=${process.getuid()} gid=${process.getgid()} user=${u.username} — default ALSA is written to ~/.asoundrc (no sudo). For /etc/asound.conf, install /etc/sudoers.d/highascg-asound (NOPASSWD tee) or run as root.`,
		)
	} catch {
		logger.info(`[Process] uid=${process.getuid()} gid=${process.getgid()}`)
	}

	if (cli.noHttp) {
		logger.info('Exiting (--no-http).')
		process.exit(0)
	}

	const webDir = path.join(__dirname, 'web')
	const templatesDir = path.join(__dirname, 'templates')

	const state = new StateManager({ logger: debugLog })
	const persistedBanks = persistence.get('programLayerBankByChannel')
	const programLayerBankByChannel =
		persistedBanks && typeof persistedBanks === 'object' && !Array.isArray(persistedBanks)
			? { ...persistedBanks }
			: {}
	const persistedMv = persistence.get('multiviewLayout')
	const persistedSceneDeck = persistence.get('scene_deck')
	const sceneDeck =
		persistedSceneDeck &&
		typeof persistedSceneDeck === 'object' &&
		Array.isArray(persistedSceneDeck.looks)
			? {
					looks: persistedSceneDeck.looks,
					previewSceneId:
						persistedSceneDeck.previewSceneId != null && String(persistedSceneDeck.previewSceneId).trim()
							? String(persistedSceneDeck.previewSceneId).trim()
							: null,
				}
			: { looks: [], previewSceneId: null }
	const appCtx = {
		config,
		state,
		variables: state.variables,
		gatheredInfo: {
			channelIds: [],
			channelStatusLines: {},
			channelXml: {},
			infoConfig: '',
			infoPaths: '',
			infoSystem: '',
			decklinkFromConfig: {},
		},
		CHOICES_MEDIAFILES: [],
		CHOICES_TEMPLATES: [],
		mediaDetails: {},
		programLayerBankByChannel,
		_multiviewLayout: persistedMv && typeof persistedMv === 'object' ? persistedMv : null,
		/** Live look id/name list from web UI (WS `scene_deck_sync`); persisted for Companion before browser connects. */
		sceneDeck,
		persistence,
		log: (level, msg) => {
			if (level === 'error') logger.error(msg)
			else if (level === 'warn') logger.warn(msg)
			else if (level === 'info') logger.info(msg)
			else debugLog.debug(msg)
		},
		amcp: null,
		timelineEngine: null,
		oscState: null,
		_casparStatus: {
			connected: false,
			host: config.caspar.host,
			port: config.caspar.port,
		},
		configManager,
		/** False until Caspar UDP/NDI consumers are up (UDP tier: after ADD STREAM). Stops WebRTC before MPEG-TS flows. */
		streamingPipelineReady: false,
		samplingManager: null,
	}
	appCtx.timelineEngine = new TimelineEngine(appCtx)
	appCtx.clipEndFadeWatcher = new ClipEndFadeWatcher(appCtx)
	appCtx.getState = () => getState(appCtx)
	appCtx.startPeriodicSync = (self) => startPeriodicSync(self || appCtx)
	appCtx.refreshConfigComparison = refreshConfigComparison
	appCtx.samplingManager = new SamplingManager(appCtx)

	const fetchServerInfoConfigAndBroadcast = createFetchServerInfoConfigAndBroadcast({ appCtx, config })

	// --- PHASE 1: SYSTEM VARIABLES ---
	const startTime = Date.now()
	const updateSystemVariables = () => {
		const uptimeSec = Math.floor((Date.now() - startTime) / 1000)
		const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
		appCtx.state.setVariable('app_uptime', `${uptimeSec}s`)
		appCtx.state.setVariable('app_memory_usage', `${memMb}MB`)
	}
	const systemVarsInterval = setInterval(updateSystemVariables, 5000)
	updateSystemVariables()

	const {
		stopStreamingSubsystem,
		toggleStreaming,
		restartStreaming,
		handleCasparConnected,
		handleConfigReload,
	} = createStreamingLifecycle({
		appCtx,
		config,
		logger,
		getChannelMap,
		go2rtcManager,
		addStreamingConsumers,
		removeStreamingConsumers,
		resolveFreeStreamingBasePort,
		prepareNdiStreaming,
		resolveCaptureTier,
	})
	appCtx.toggleStreaming = toggleStreaming
	appCtx.restartStreaming = restartStreaming

	configManager.on('change', () => {
		logger.info('[Config] Reloading subsystems...')
		Object.assign(config, buildConfig(cli, configManager))
		if (appCtx.restartOscSubsystem) appCtx.restartOscSubsystem()

		handleConfigReload()

		if (appCtx.samplingManager) {
			appCtx.samplingManager.updateConfig(config.dmx).catch((e) => {
				appCtx.log('error', '[DMX] Config update failed: ' + (e?.message || e))
			})
		}
	})

	/** @type {InstanceType<typeof ConnectionManager> | null} */
	let casparConnection = null
	/** First VERSION + INFO CONFIG timing (ms) — see ConnectionManager `_healthConnectDelayMs`. */
	let amcpConnectSettleMs = 600
	if (!cli.noCaspar) {
		/** Default off — periodic VERSION can stress Caspar; set HIGHASCG_AMCP_HEALTH_MS=30000 to enable half-open TCP checks. */
		const rawHealth = process.env.HIGHASCG_AMCP_HEALTH_MS
		const amcpHealthMs =
			rawHealth === undefined || rawHealth === '' ? 0 : parseInt(String(rawHealth), 10)
		const rawSettle = process.env.HIGHASCG_AMCP_CONNECT_SETTLE_MS
		const parsedSettle =
			rawSettle === undefined || rawSettle === '' ? 600 : parseInt(String(rawSettle), 10)
		amcpConnectSettleMs =
			Number.isFinite(parsedSettle) && parsedSettle >= 0 ? parsedSettle : 600
		casparConnection = new ConnectionManager({
			host: config.caspar.host,
			port: config.caspar.port,
			config,
			log: appCtx.log,
			healthIntervalMs: Number.isFinite(amcpHealthMs) && amcpHealthMs >= 0 ? amcpHealthMs : 0,
			healthConnectDelayMs: amcpConnectSettleMs,
		})
		appCtx.amcp = casparConnection.amcp
		appCtx.casparConnection = casparConnection
		appCtx.runMediaLibraryQueryCycle = function () {
			if (!appCtx.amcp?.query) return
			runMediaClsTlsRefresh(appCtx).catch((e) => {
				appCtx.log('warn', 'Media library refresh: ' + (e?.message || e))
			})
		}
	}

	logger.info('Starting HTTP server…')

	const httpServer = startHttpServer({
		port: config.server.httpPort,
		bindAddress: config.server.bindAddress,
		webDir,
		templatesDir,
		routeApi: (method, path, body, req) => routeRequest(method, path, body, appCtx, req),
		log: (m) => logger.info(m),
	})

	const wsBroadcastMs =
		cli.wsBroadcastMs != null && !Number.isNaN(cli.wsBroadcastMs)
			? cli.wsBroadcastMs
			: parseInt(process.env.HIGHASCG_WS_BROADCAST_MS || '0', 10) || 0

	const wsHandle = attachWebSocketServer(httpServer, appCtx, {
		log: (m) => logger.info(m),
		stateBroadcastIntervalMs: wsBroadcastMs,
	})

	// Push every new HighAsCG log line to all connected WebSocket clients in real time.
	logBuffer.setOnNewLine((line) => {
		if (typeof appCtx._wsBroadcast === 'function') {
			try {
				appCtx._wsBroadcast('log_line', line)
			} catch (_) {
				/* non-fatal */
			}
		}
	})

	appCtx.timelineEngine.on('playback', (pb) => {
		if (typeof appCtx._wsBroadcast === 'function') {
			appCtx._wsBroadcast('timeline.playback', pb)
		}
	})

	if (casparConnection) {
		let wasConnected = false
		casparConnection.on('status', (payload) => {
			appCtx._casparStatus = { ...appCtx._casparStatus, ...payload }

			// Sync to Variables
			if (payload.connected !== undefined) {
				appCtx.state.setVariable('caspar_connected', payload.connected ? 'true' : 'false')
			}
			if (payload.version) {
				appCtx.state.setVariable('caspar_version', payload.version)
			}

			if (typeof appCtx._wsBroadcast === 'function') {
				appCtx._wsBroadcast('change', { path: 'caspar.connection', value: appCtx._casparStatus })
			}
			if (payload.connected === true && !wasConnected) {
				wasConnected = true
				// After reconnect, defer first VERSION by `amcpConnectSettleMs` (Caspar often ignores immediate VERSION).
				// Queue INFO CONFIG after that window so it never runs before the first VERSION is sent (AMCP serial queue).
				const infoDelay = amcpConnectSettleMs > 0 ? amcpConnectSettleMs + 200 : 0
				setTimeout(() => void fetchServerInfoConfigAndBroadcast(), infoDelay)
				if (typeof appCtx.startPeriodicSync === 'function') {
					appCtx.startPeriodicSync(appCtx)
				}
				startOscPlaybackInfoSupplement(appCtx)
				handleCasparConnected()
				if (appCtx.samplingManager) {
					appCtx.samplingManager.updateConfig(config.dmx).catch((e) => {
						appCtx.log('error', '[DMX] Initial connect start failed: ' + (e?.message || e))
					})
				}
			} else if (payload.connected === false) {
				wasConnected = false
				clearPeriodicSyncTimer(appCtx)
				if (appCtx.clipEndFadeWatcher) appCtx.clipEndFadeWatcher.cancelAll()
			}
		})
		casparConnection.on('error', (err) => {
			const msg = err instanceof Error ? err.message : String(err)
			appCtx.log('warn', 'Caspar TCP: ' + msg)
		})
		logger.info('Starting Caspar AMCP TCP (' + config.caspar.host + ':' + config.caspar.port + ')…')
		casparConnection.start()
	} else {
		appCtx._casparStatus = { ...appCtx._casparStatus, skipped: true }
		logger.info('Caspar AMCP disabled (--no-caspar).')
	}

	const {
		startOscSubsystem,
		stopOscSubsystem,
		restartOscSubsystem,
		getOscReceiverStats,
	} = createOscLifecycle({
		appCtx,
		config,
		cli,
		logger,
		normalizeOscConfig,
		OscState,
		OscListener,
		applyOscSnapshotToVariables,
		clearOscVariables,
		startOscPlaybackInfoSupplement,
	})
	startOscSubsystem()
	appCtx.restartOscSubsystem = restartOscSubsystem
	appCtx.getOscReceiverStats = getOscReceiverStats

	appCtx.applyServerConfigAndRestart = () => {
		void applyCasparConfigToDiskAndRestart(appCtx).then((r) => {
			if (r.status !== 200) {
				try {
					const j = JSON.parse(r.body)
					appCtx.log('warn', '[Caspar config] ' + (j.error || r.body))
				} catch {
					appCtx.log('warn', '[Caspar config] apply failed')
				}
			} else {
				try {
					const j = JSON.parse(r.body)
					appCtx.log('info', '[Caspar config] ' + (j.message || 'OK'))
				} catch {
					appCtx.log('info', '[Caspar config] applied')
				}
			}
		}).catch((e) => appCtx.log('error', '[Caspar config] ' + (e?.message || e)))
	}

	let shutdownStarted = false
	const shutdown = () => {
		if (shutdownStarted) return
		shutdownStarted = true
		void (async () => {
			/** If shutdown stalls on HTTP close or similar, exit before systemd’s ~90s SIGKILL. */
			let shutdownFailsafe = setTimeout(() => {
				logger.warn('[Shutdown] Failsafe exit after 25s — see prior shutdown logs')
				process.exit(0)
			}, 25000)
			const clearShutdownFailsafe = () => {
				if (shutdownFailsafe) {
					clearTimeout(shutdownFailsafe)
					shutdownFailsafe = null
				}
			}
			try {
				clearPeriodicSyncTimer(appCtx)
				clearInterval(systemVarsInterval)
				try {
					// Do not use enqueueStreaming here: the chain can block forever behind a stuck
					// startStreamingSubsystem / restartStreaming, which prevents HTTP close and SIGTERM handling.
					await Promise.race([
						stopStreamingSubsystem(),
						new Promise((_, reject) =>
							setTimeout(
								() => reject(new Error('stopStreamingSubsystem timeout (12s)')),
								12000
							)
						),
					])
				} catch (e) {
					appCtx.log('warn', `[Shutdown] stopStreamingSubsystem: ${e?.message || e}`)
				}
				appCtx.log('info', '[Shutdown] Streaming stopped — OSC, Sampling, WebSocket, AMCP, HTTP…')
				if (appCtx.samplingManager) {
					await appCtx.samplingManager.stop()
				}
				stopOscSubsystem()
				wsHandle.stop()
				if (casparConnection) {
					casparConnection.destroy()
					casparConnection = null
					appCtx.amcp = null
				}
				const forceExit = setTimeout(() => {
					appCtx.log('warn', '[Shutdown] HTTP close timed out — exiting')
					clearShutdownFailsafe()
					process.exit(0)
				}, 5000)
				stopHttpServer(httpServer, () => {
					clearTimeout(forceExit)
					clearShutdownFailsafe()
					process.exit(0)
				})
			} catch (e) {
				appCtx.log('error', `[Shutdown] ${e?.message || e}`)
				clearShutdownFailsafe()
				process.exit(1)
			}
		})()
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}

main()
