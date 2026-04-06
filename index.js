#!/usr/bin/env node
'use strict'

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
const { ConnectionManager } = require('./src/caspar/connection-manager')
const { normalizeOscConfig } = require('./src/osc/osc-config')
const { OscState } = require('./src/osc/osc-state')
const { OscListener } = require('./src/osc/osc-listener')
const { applyOscSnapshotToVariables, clearOscVariables } = require('./src/osc/osc-variables')
const { resolveStreamingConfig } = require('./src/streaming/stream-config')
const { go2rtcManager, resolveCaptureTier } = require('./src/streaming/go2rtc-manager')
const { addStreamingConsumers, removeStreamingConsumers } = require('./src/streaming/caspar-ffmpeg-setup')
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
const { responseToStr } = require('./src/utils/query-cycle')

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
	}
	appCtx.timelineEngine = new TimelineEngine(appCtx)
	appCtx.getState = () => getState(appCtx)
	appCtx.startPeriodicSync = (self) => startPeriodicSync(self || appCtx)
	appCtx.refreshConfigComparison = refreshConfigComparison

	async function fetchServerInfoConfigAndBroadcast() {
		if (!appCtx.amcp?.query?.infoConfig) return
		try {
			const res = await appCtx.amcp.query.infoConfig()
			const xmlStr = responseToStr(res?.data)
			if (!xmlStr || !String(xmlStr).trim()) return
			appCtx.gatheredInfo.infoConfig = xmlStr
			try {
				refreshConfigComparison(appCtx)
			} catch (e) {
				appCtx.log('debug', 'configComparison: ' + (e?.message || e))
			}
			if (typeof appCtx._wsBroadcast === 'function') {
				appCtx._wsBroadcast('state', appCtx.getState())
			}
			appCtx.log('info', '[Caspar] INFO CONFIG loaded — channel resolutions match running server')
		} catch (e) {
			appCtx.log('warn', 'INFO CONFIG: ' + (e?.message || e))
		}
	}

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

	const streamingTargets = [
		{ name: 'pgm_1', channel: 1, port: config.streaming.basePort + 1 },
		{ name: 'prv_1', channel: 2, port: config.streaming.basePort + 2 },
		{ name: 'multiview', channel: 3, port: config.streaming.basePort + 5 }
	]

	/** NDI only: Caspar must register NDI before go2rtc receive; if AMCP was down at start, restart go2rtc after first connect. */
	let needGo2rtcRestartAfterCaspar = false

	async function startStreamingSubsystem() {
		try {
			config.streaming._casparHost = config.caspar.host
			const tier = resolveCaptureTier(config.streaming.captureMode || 'auto', config.caspar.host)
			appCtx.log(
				'info',
				`[Streaming] startStreamingSubsystem tier=${tier} caspar=${config.caspar.host} amcpConnected=${!!appCtx.amcp?.isConnected}`
			)
			if (tier === 'ndi') prepareNdiStreaming(config.streaming, streamingTargets)

			if (tier === 'ndi') {
				if (appCtx.amcp?.isConnected) {
					await addStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
					needGo2rtcRestartAfterCaspar = false
				} else {
					needGo2rtcRestartAfterCaspar = true
					appCtx.log('warn', '[Streaming] NDI: Caspar AMCP not connected yet — will register NDI after connect')
				}
				await go2rtcManager.start(streamingTargets, config.streaming, config.caspar.host)
			} else if (tier === 'srt') {
				// UDP MPEG-TS: go2rtc binds the UDP receiver first; then Caspar STREAM pushes to 127.0.0.1:port.
				appCtx.log('info', '[Streaming] UDP tier: starting go2rtc first, then Caspar ADD STREAM')
				await go2rtcManager.start(streamingTargets, config.streaming, config.caspar.host)
				needGo2rtcRestartAfterCaspar = false
				if (appCtx.amcp?.isConnected) {
					await addStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
				} else {
					appCtx.log('warn', '[Streaming] UDP tier: AMCP not connected — skip ADD STREAM until Caspar connects')
				}
			} else {
				needGo2rtcRestartAfterCaspar = false
				await go2rtcManager.start(streamingTargets, config.streaming, config.caspar.host)
				if (tier === 'local' && appCtx.amcp) {
					await addStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
				}
			}
			appCtx.log('info', '[Streaming] startStreamingSubsystem finished')
		} catch (e) {
			appCtx.log('error', `Streaming start failed: ${e.message}`)
		}
	}

	async function stopStreamingSubsystem() {
		try {
			appCtx.log('info', '[Streaming] stopStreamingSubsystem (remove Caspar consumers, stop go2rtc)')
			if (appCtx.amcp) await removeStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
			await go2rtcManager.stop()
		} catch (e) {
			appCtx.log('warn', `[Streaming] stopStreamingSubsystem: ${e?.message || e}`)
		}
	}

	/** Serialize start/stop so overlapping config + Caspar events cannot double-spawn go2rtc (SIGKILL storms). */
	let streamingChain = Promise.resolve()
	function enqueueStreaming(fn) {
		streamingChain = streamingChain.then(fn).catch((e) => {
			appCtx.log('error', `Streaming: ${e?.message || e}`)
		})
		return streamingChain
	}

	appCtx.toggleStreaming = (enabled) => {
		config.streaming.enabled = enabled
		return enqueueStreaming(async () => {
			if (enabled) await startStreamingSubsystem()
			else await stopStreamingSubsystem()
		})
	}

	appCtx.restartStreaming = () =>
		enqueueStreaming(async () => {
			await stopStreamingSubsystem()
			await new Promise((r) => setTimeout(r, 500))
			await startStreamingSubsystem()
		})

	// T1.3: Live reload — debounce streaming so double-save / OSC + save does not restart go2rtc twice in one tick.
	let streamingReloadTimer = null
	configManager.on('change', () => {
		logger.info('[Config] Reloading subsystems...')
		Object.assign(config, buildConfig(cli, configManager))
		if (appCtx.restartOscSubsystem) appCtx.restartOscSubsystem()
		clearTimeout(streamingReloadTimer)
		streamingReloadTimer = setTimeout(() => {
			if (appCtx.toggleStreaming) void appCtx.toggleStreaming(config.streaming.enabled)
		}, 400)
	})

	/** @type {InstanceType<typeof ConnectionManager> | null} */
	let casparConnection = null
	if (!cli.noCaspar) {
		/** Default 30s VERSION when unset — catches half-open TCP; set HIGHASCG_AMCP_HEALTH_MS=0 to disable. */
		const rawHealth = process.env.HIGHASCG_AMCP_HEALTH_MS
		const amcpHealthMs =
			rawHealth === undefined || rawHealth === '' ? 30000 : parseInt(String(rawHealth), 10)
		casparConnection = new ConnectionManager({
			host: config.caspar.host,
			port: config.caspar.port,
			config,
			log: appCtx.log,
			healthIntervalMs: Number.isFinite(amcpHealthMs) && amcpHealthMs >= 0 ? amcpHealthMs : 0,
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
				void fetchServerInfoConfigAndBroadcast()
				if (typeof appCtx.startPeriodicSync === 'function') {
					appCtx.startPeriodicSync(appCtx)
				}
				startOscPlaybackInfoSupplement(appCtx)
				if (config.streaming.enabled) {
					config.streaming._casparHost = config.caspar.host
					// Avoid a second full go2rtc start if settings reload already spawned it (races with Caspar connect).
					if (go2rtcManager.process) {
						addStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
							.then(async () => {
								if (
									needGo2rtcRestartAfterCaspar &&
									typeof appCtx.restartStreaming === 'function'
								) {
									needGo2rtcRestartAfterCaspar = false
									await appCtx.restartStreaming()
								}
							})
							.catch((e) => {
								appCtx.log('error', `Streaming consumers: ${e?.message || e}`)
							})
					} else {
						startStreamingSubsystem()
					}
				}
			} else if (payload.connected === false) {
				wasConnected = false
				clearPeriodicSyncTimer(appCtx)
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

	/** @type {OscListener | null} */
	let oscListener = null

	function stopOscSubsystem() {
		if (oscListener) {
			oscListener.stop()
			oscListener = null
		}
		if (appCtx.oscState) {
			if (typeof appCtx.state.clearOscMirror === 'function') {
				appCtx.state.clearOscMirror()
			}
			clearOscVariables(appCtx)
			appCtx.oscState.destroy()
			appCtx.oscState = null
		}
	}

	function startOscSubsystem() {
		config.osc = normalizeOscConfig(config)
		if (cli.noOsc) config.osc.enabled = false
		if (!config.osc.enabled) {
			logger.info('OSC UDP listener off (--no-osc). Caspar→HighAsCG OSC is expected in normal operation.')
			return
		}
		const oscState = new OscState(appCtx.log, config.osc)
		appCtx.oscState = oscState
		oscListener = new OscListener(config.osc, appCtx.log, oscState)
		oscListener.start()

		const pushOscToState = () => {
			const snap = appCtx.oscState.getSnapshot()
			if (typeof appCtx.state.updateFromOscSnapshot === 'function') {
				appCtx.state.updateFromOscSnapshot(snap)
			}
			applyOscSnapshotToVariables(appCtx, snap)
		}
		pushOscToState()
		appCtx.oscState.on('change', (snapshot) => {
			pushOscToState()
			if (typeof appCtx._wsBroadcast === 'function') {
				appCtx._wsBroadcast('osc', snapshot)
			}
		})
	}

	startOscSubsystem()

	/** UDP receive stats (for /api/osc/diagnostics). */
	appCtx.getOscReceiverStats = () => (oscListener && typeof oscListener.getStats === 'function' ? oscListener.getStats() : null)

	appCtx.restartOscSubsystem = () => {
		stopOscSubsystem()
		startOscSubsystem()
		startOscPlaybackInfoSupplement(appCtx)
	}

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
				appCtx.log('info', '[Shutdown] Streaming stopped — OSC, WebSocket, AMCP, HTTP…')
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
