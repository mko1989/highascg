/**
 * Main HTTP API dispatcher (split from companion `api-routes.js`).
 * Uses RouteRegistry to handle routing declaratively (WO-84).
 */

'use strict'

const liveSceneState = require('../state/live-scene-state')
const { JSON_HEADERS, jsonBody, parseBody, parseQueryString } = require('./response')
const { getState } = require('./get-state')

const routesState = require('./routes-state')
const routesMedia = require('./routes-media')
const routesAmcp = require('./routes-amcp')
const routesMixer = require('./routes-mixer')
const routesCg = require('./routes-cg')
const routesData = require('./routes-data')
const routesConfig = require('./routes-config')
const routesMultiview = require('./routes-multiview')
const routesScene = require('./routes-scene')
const routesMisc = require('./routes-misc')
const routesTimeline = require('./routes-timeline')
const routesStreaming = require('./routes-streaming')
const routesOsc = require('./routes-osc')
const routesSettings = require('./routes-settings')
const routesAudio = require('./routes-audio')
const routesProject = require('./routes-project')
const routesLedTestCard = require('./routes-led-test-card')
const routesComposePreview = require('./routes-compose-preview')
const routesVirtualCamera = require('./routes-virtual-camera')
const routesV4l2Input = require('./routes-v4l2-input')
const { applyUiSelectionPayloadToVariables } = require('./apply-ui-selection-variables')
const routesFtb = require('./routes-ftb')
const routesSystemStaged = require('./routes-system-staged')
const routesIngest = require('./routes-ingest')
const routesUsbIngest = require('./routes-usb-ingest')
const routesStreamingChannel = require('./routes-streaming-channel')
const routesSystemSetup = require('./routes-system-setup')
const routesSystemUpdate = require('./routes-system-update')
const routesSystemHardware = require('./routes-system-hardware')
const routesNetworkTailscale = require('./routes-network-tailscale')
const routesExfatSync = require('./routes-exfat-sync')
const routesCasparConfig = require('./routes-caspar-config')
const routesLogs = require('./routes-logs')
const routesSupportBundle = require('./routes-support-bundle')
const routesHostStats = require('./routes-host-stats')
const routesPipOverlay = require('./routes-pip-overlay')
const routesArtnet = require('./routes-artnet')
const routesModules = require('./routes-modules')
const routesDeviceView = require('./routes-device-view')
const routesHostLive = require('./routes-host-live')
const routesCefInteractive = require('./routes-cef-interactive')
const routesDeviceSnapshot = require('./routes-device-snapshot')
const routesPlugins = require('./routes-plugins')
const routesNdi = require('./routes-ndi')
const routesLowerThirds = require('./routes-lower-thirds')
const routesCountdown = require('./routes-countdown')
const routesScreenTimers = require('./routes-screen-timers')
const routesCgThumb = require('./routes-cg-thumb')
const routesReplication = require('./routes-replication')
const routesCompanion = require('./routes-companion')
const routesPrivateSync = require('./routes-private-sync')
const routesAuth = require('./routes-auth')
const moduleRegistry = require('../module-registry')
const { RouteRegistry } = require('./route-registry')
const { checkHttpAuth } = require('../server/auth')

const routes = new RouteRegistry()

// Auth (public when enforcement is on)
routes.get('/api/auth/status', ({ path, ctx, req }) => routesAuth.handleGet(path, ctx, req), { requireCaspar: false })
routes.post('/api/auth/login', ({ path, body, ctx, req }) => routesAuth.handlePost(path, body, ctx, req), {
	requireCaspar: false,
})
routes.post('/api/auth/logout', ({ path, body, ctx, req }) => routesAuth.handlePost(path, body, ctx, req), {
	requireCaspar: false,
})

// --- OFFLINE SAFE ROUTES (requireCaspar: false) ---
// Note: Plugins and Modules are handled before dispatch dynamically

// Caspar Config
routes.get('/api/caspar-config/generate', ({ path, query, ctx }) => routesCasparConfig.handleGet(path, query, ctx), { requireCaspar: false })
routes.get('/api/caspar-config/mode-choices', ({ path, query, ctx }) => routesCasparConfig.handleGet(path, query, ctx), { requireCaspar: false })
routes.get('/api/caspar-config/override', ({ path, query, ctx }) => routesCasparConfig.handleGet(path, query, ctx), { requireCaspar: false })
routes.post('/api/caspar-config/apply', ({ path, body, ctx }) => routesCasparConfig.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/caspar-config/override', ({ path, body, ctx }) => routesCasparConfig.handlePost(path, body, ctx), { requireCaspar: false })

// Logs
routes.get('/api/logs', ({ path, query, ctx }) => routesLogs.handleGet(path, query, ctx), { requireCaspar: false })
routes.post('/api/logs/clear', ({ path, body }) => routesLogs.handlePost(path, body), { requireCaspar: false })

// Support bundle
routes.get('/api/support/bundle', ({ path, query, ctx }) => routesSupportBundle.handleGet(path, query, ctx), { requireCaspar: false })
routes.post('/api/support/bundle', ({ path, body, ctx }) => routesSupportBundle.handlePost(path, body, ctx), { requireCaspar: false })

// Host stats
routes.get('/api/host-stats', ({ ctx }) => routesHostStats.handleGet(ctx), { requireCaspar: false })

// Companion
routes.get('/api/companion/*', ({ path, ctx, query }) => routesCompanion.handleGet(path, ctx, query), { requireCaspar: false })
routes.get('/api/companion', ({ path, ctx, query }) => routesCompanion.handleGet(path, ctx, query), { requireCaspar: false })
routes.post('/api/companion/*', ({ path, body, ctx }) => routesCompanion.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/companion', ({ path, body, ctx }) => routesCompanion.handlePost(path, body, ctx), { requireCaspar: false })

// Replication
routes.get('/api/replication/*', ({ path, ctx, req }) => routesReplication.handleGet(path, ctx, req), { requireCaspar: false })
routes.get('/api/replication', ({ path, ctx, req }) => routesReplication.handleGet(path, ctx, req), { requireCaspar: false })
routes.post('/api/replication/*', ({ path, body, ctx, req }) => routesReplication.handlePost(path, body, ctx, req), { requireCaspar: false })
routes.post('/api/replication', ({ path, body, ctx, req }) => routesReplication.handlePost(path, body, ctx, req), { requireCaspar: false })

// Exfat Sync
routes.get('/api/system/exfat-sync', ({ path, ctx }) => routesExfatSync.handleGet(path, ctx), { requireCaspar: false })
routes.post('/api/system/exfat-sync/run', ({ path, body, ctx }) => routesExfatSync.handlePost(path, body, ctx), { requireCaspar: false })

// Private sync
routes.get('/api/private-sync/*', ({ path, ctx }) => routesPrivateSync.handleGet(path, ctx), { requireCaspar: false })
routes.get('/api/private-sync', ({ path, ctx }) => routesPrivateSync.handleGet(path, ctx), { requireCaspar: false })
routes.post('/api/private-sync/*', ({ path, body, ctx }) => routesPrivateSync.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/private-sync', ({ path, body, ctx }) => routesPrivateSync.handlePost(path, body, ctx), { requireCaspar: false })

// Hardware / Network / Setup
routes.get('/api/system/gpu-nvidia', ({ path, ctx }) => routesSystemHardware.hardwareHandleGet(path, ctx), { requireCaspar: false })
routes.get('/api/system/decklink', ({ path, ctx }) => routesSystemHardware.hardwareHandleGet(path, ctx), { requireCaspar: false })
routes.get('/api/system/gpu-layout', ({ path, ctx }) => routesSystemHardware.hardwareHandleGet(path, ctx), { requireCaspar: false })
routes.get('/api/system/xrandr-layout', ({ path, ctx }) => routesSystemHardware.hardwareHandleGet(path, ctx), { requireCaspar: false })
routes.get('/api/system/network', ({ path, ctx }) => routesSystemHardware.hardwareHandleGet(path, ctx), { requireCaspar: false })
routes.get('/api/system/operator-display', ({ path, ctx }) => routesSystemHardware.hardwareHandleGet(path, ctx), { requireCaspar: false })
routes.get('/api/system/hardware', ({ path, ctx }) => routesSystemHardware.hardwareHandleGet(path, ctx), { requireCaspar: false })
routes.get('/api/system/time', ({ path, ctx }) => routesSystemHardware.hardwareHandleGet(path, ctx), { requireCaspar: false })
routes.get('/api/system/v4l2-devices', ({ path, query, ctx }) => routesV4l2Input.handleGet(path, query, ctx), { requireCaspar: false })
routes.get('/api/v4l2-inputs', ({ path, query, ctx }) => routesV4l2Input.handleGet(path, query, ctx), { requireCaspar: false })
routes.get('/api/v4l2-inputs/status', ({ path, query, ctx }) => routesV4l2Input.handleGet(path, query, ctx), { requireCaspar: false })

routes.post('/api/system/time', ({ path, body, ctx }) => routesSystemHardware.hardwareHandlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/decklink/install', ({ path, body, ctx }) => routesSystemHardware.hardwareHandlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/gpu-nvidia/apply', ({ path, body, ctx }) => routesSystemHardware.hardwareHandlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/gui-launch', ({ path, body, ctx }) => routesSystemHardware.hardwareHandlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/pointer-confine', ({ path, body, ctx }) => routesSystemHardware.hardwareHandlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/gpu-ports-reset', ({ path, body, ctx }) => routesSystemHardware.hardwareHandlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/xrandr-layout/apply', ({ path, body, ctx }) => routesSystemHardware.hardwareHandlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/network/apply', ({ path, body, ctx }) => routesSystemHardware.hardwareHandlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/network/reset', ({ path, body, ctx }) => routesSystemHardware.hardwareHandlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/network/refresh-splash-ip', ({ path, body, ctx }) => routesSystemHardware.hardwareHandlePost(path, body, ctx), { requireCaspar: false })

routes.get('/api/system/setup', ({ path, ctx }) => routesSystemSetup.handleGet(path, ctx), { requireCaspar: false })

routes.get('/api/network/tailscale/status', ({ path }) => routesNetworkTailscale.handleGet(path), { requireCaspar: false })
routes.post('/api/network/tailscale/enable', ({ path, body, ctx }) => routesNetworkTailscale.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/network/tailscale/login', ({ path, body, ctx }) => routesNetworkTailscale.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/network/tailscale/login-operator-ui', ({ path, body, ctx }) => routesNetworkTailscale.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/network/tailscale/prefs', ({ path, body, ctx }) => routesNetworkTailscale.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/network/tailscale/logout', ({ path, body, ctx }) => routesNetworkTailscale.handlePost(path, body, ctx), { requireCaspar: false })

routes.post('/api/system/setup/restart-window-manager', ({ path, body, ctx }) => routesSystemSetup.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/setup/reboot', ({ path, body, ctx }) => routesSystemSetup.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/setup/restart-app', ({ path, body, ctx }) => routesSystemSetup.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/setup/install', ({ path, body, ctx }) => routesSystemSetup.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/setup/caspar/stop', ({ path, body, ctx }) => routesSystemSetup.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/setup/caspar/start', ({ path, body, ctx }) => routesSystemSetup.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/system/setup/caspar/restart', ({ path, body, ctx }) => routesSystemSetup.handlePost(path, body, ctx), { requireCaspar: false })

routes.get('/api/system/version', ({ path, ctx, query }) => routesSystemUpdate.handleGet(path, ctx, query), { requireCaspar: false })
routes.get('/api/system/update/*', ({ path, ctx, query }) => routesSystemUpdate.handleGet(path, ctx, query), { requireCaspar: false })
routes.get('/api/system/update', ({ path, ctx, query }) => routesSystemUpdate.handleGet(path, ctx, query), { requireCaspar: false })
routes.post('/api/system/update/apply', ({ path, body, ctx }) => routesSystemUpdate.handlePost(path, body, ctx), { requireCaspar: false })

routes.get('/api/modules', () => routesModules.handle('GET', '/api/modules'), { requireCaspar: false })

// Scene live
routes.get('/api/scene/live', ({ ctx }) => {
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			channels: liveSceneState.getAll(),
			programLayerBankByChannel: ctx.programLayerBankByChannel || {},
		}),
	}
}, { requireCaspar: false })

// Artnet input
routes.get('/api/artnet/input', ({ ctx }) => routesArtnet.handleGetArtnetInput(ctx), { requireCaspar: false })

// OSC
routes.get('/api/osc/*', ({ path, ctx }) => routesOsc.handleGet(path, ctx), { requireCaspar: false })
routes.get('/api/osc', ({ path, ctx }) => routesOsc.handleGet(path, ctx), { requireCaspar: false })

// Audio offline
routes.get('/api/audio/devices', ({ path, query, ctx }) => routesAudio.handleGet(path, query, ctx), { requireCaspar: false })
routes.get('/api/audio/portaudio-devices', ({ path, query, ctx }) => routesAudio.handleGet(path, query, ctx), { requireCaspar: false })
routes.get('/api/audio/live-inputs', ({ path, query, ctx }) => routesAudio.handleGet(path, query, ctx), { requireCaspar: false })
routes.get('/api/audio/alsa-mixer', ({ path, query, ctx }) => routesAudio.handleGet(path, query, ctx), { requireCaspar: false })
routes.post('/api/audio/default-device', ({ path, body, ctx }) => routesAudio.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/audio/alsa-mixer', ({ path, body, ctx }) => routesAudio.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/audio/volume', ({ path, body, ctx }) => routesAudio.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/audio/config', ({ path, body, ctx }) => routesAudio.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/audio/route', ({ path, body, ctx }) => routesAudio.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/audio/monitor-source', ({ path, body, ctx }) => routesAudio.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/audio/solo', ({ path, body, ctx }) => routesAudio.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/audio/live-inputs/apply', ({ path, body, ctx }) => routesAudio.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/audio/live-inputs/config', ({ path, body, ctx }) => routesAudio.handlePost(path, body, ctx), { requireCaspar: false })

// Variables
routes.get('/api/variables', ({ path, ctx, query }) => routesState.handleGet(path, ctx, query), { requireCaspar: false })
routes.get('/api/variables/batch', ({ path, ctx, query }) => routesState.handleGet(path, ctx, query), { requireCaspar: false })
routes.get('/api/variables/custom', ({ path, ctx, query }) => routesState.handleGet(path, ctx, query), { requireCaspar: false })
routes.post('/api/variables/batch', ({ path, body, ctx }) => routesState.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/variables/custom', ({ path, body, ctx }) => routesState.handlePost(path, body, ctx), { requireCaspar: false })

// Settings
routes.get('/api/settings', ({ path, ctx }) => routesSettings.handleGet(path, ctx), { requireCaspar: false })
routes.post('/api/settings', ({ path, body, ctx }) => routesSettings.handlePost(path, body, ctx).catch(e => ({ status: 502, headers: JSON_HEADERS, body: jsonBody({ error: String(e) }) })), { requireCaspar: false })
routes.post('/api/settings/apply-os', ({ path, body, ctx }) => routesSettings.handleOsPost(path, body, ctx).catch(e => ({ status: 502, headers: JSON_HEADERS, body: jsonBody({ error: String(e) }) })), { requireCaspar: false })

// Device view
routes.get('/api/device-view', ({ path, ctx, query, req }) => routesDeviceView.handleGet(path, ctx, query, req), { requireCaspar: false })
routes.get('/api/device-view/gpu-map-debug', ({ path, ctx, query }) => routesDeviceView.handleGet(path, ctx, query), { requireCaspar: false })
routes.get('/api/device-view/snapshot', ({ path, ctx, query }) => routesDeviceView.handleGet(path, ctx, query), { requireCaspar: false })
routes.post('/api/device-view', ({ body, ctx }) => routesDeviceView.handlePost(body, ctx), { requireCaspar: false })
routes.post('/api/device-view/gpu-map-debug', ({ body, ctx }) => routesDeviceView.handlePost(body, ctx), { requireCaspar: false })
routes.post('/api/device-view/snapshot', ({ body, ctx }) => routesDeviceView.handlePost(body, ctx), { requireCaspar: false })

routes.get('/api/host-live/operator-fullscreen', ({ path, ctx }) => routesHostLive.handleGet(path, ctx), { requireCaspar: false })
routes.get('/api/host-live/migration', ({ path, ctx }) => routesHostLive.handleGet(path, ctx), { requireCaspar: false })
routes.post('/api/host-live/operator-fullscreen', ({ body, ctx }) => routesHostLive.handlePost(body, ctx), { requireCaspar: true })
routes.post('/api/host-live/webpage', ({ body, ctx }) => routesHostLive.handleWebpagePost(body, ctx), { requireCaspar: true })
routes.post('/api/host-live/ndi', ({ body, ctx }) => routesHostLive.handleNdiPost(body, ctx), { requireCaspar: true })
routes.post('/api/host-live/decklink', ({ body, ctx }) => routesHostLive.handleDecklinkPost(body, ctx), { requireCaspar: true })
routes.post('/api/host-live/migration', ({ body, ctx }) => routesHostLive.handlePost(body, ctx), { requireCaspar: false })

routes.get('/api/cef-interactive/targets', ({ path, ctx }) => routesCefInteractive.handleGet(path, ctx), { requireCaspar: false })
routes.post('/api/cef-interactive/focus', ({ path, body, ctx }) => routesCefInteractive.handlePost(path, body, ctx), { requireCaspar: false })
routes.delete('/api/cef-interactive/focus', ({ path, ctx }) => routesCefInteractive.handleDelete(path, ctx), { requireCaspar: false })
routes.post('/api/cef-interactive/mouse', ({ path, body, ctx }) => routesCefInteractive.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/cef-interactive/keyboard', ({ path, body, ctx }) => routesCefInteractive.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/cef-interactive/eval', ({ path, body, ctx }) => routesCefInteractive.handlePost(path, body, ctx), { requireCaspar: true })

routes.get('/api/device-snapshot/build', ({ path, ctx }) => routesDeviceSnapshot.handleGet(path, ctx), { requireCaspar: false })
routes.get('/api/device-snapshot/schema', ({ path, ctx }) => routesDeviceSnapshot.handleGet(path, ctx), { requireCaspar: false })
routes.post('/api/device-snapshot/apply', ({ body, ctx }) => routesDeviceSnapshot.handlePost(body, ctx), { requireCaspar: false })

// Hardware Displays
routes.get('/api/hardware/displays', ({ path, query }) => routesSettings.handleHardwareGet(path, query), { requireCaspar: false })
routes.get('/api/hardware/modeline-preview', ({ path, query }) => routesSettings.handleHardwareGet(path, query), { requireCaspar: false })

// Streams
routes.get('/api/streams', ({ path, ctx }) => routesStreaming.handleGet(path, ctx), { requireCaspar: false })
routes.get('/api/streaming/ndi-sources', ({ path, ctx }) => routesStreaming.handleGet(path, ctx), { requireCaspar: false })
routes.post('/api/streaming/toggle', ({ path, body, ctx }) => routesStreaming.handlePost(path, body, ctx).catch(e => ({ status: 502, headers: JSON_HEADERS, body: jsonBody({ error: String(e) }) })), { requireCaspar: false })
routes.post('/api/streaming/restart', ({ path, body, ctx }) => routesStreaming.handlePost(path, body, ctx).catch(e => ({ status: 502, headers: JSON_HEADERS, body: jsonBody({ error: String(e) }) })), { requireCaspar: false })

// Config apply
routes.post('/api/config/apply', ({ path, body, ctx }) => routesConfig.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/config/reset', ({ path, body, ctx }) => routesConfig.handlePost(path, body, ctx), { requireCaspar: false })

// System Staged
routes.get('/api/system/staged/*', ({ method, path }) => routesSystemStaged.handle(method, path), { requireCaspar: false })
routes.get('/api/system/staged', ({ method, path }) => routesSystemStaged.handle(method, path), { requireCaspar: false })
routes.post('/api/system/staged/*', ({ method, path }) => routesSystemStaged.handle(method, path), { requireCaspar: false })
routes.post('/api/system/staged', ({ method, path }) => routesSystemStaged.handle(method, path), { requireCaspar: false })

// Ingest
routes.post('/api/ingest/upload', ({ req, ctx }) => routesIngest.handleUpload(req, null, ctx), { requireCaspar: false })
routes.post('/api/ingest/download', ({ body, ctx }) => routesIngest.handleDownload(body, ctx), { requireCaspar: false })
routes.get('/api/ingest/download-status', ({ ctx }) => routesIngest.handleGetDownloadStatus(ctx), { requireCaspar: false })
routes.get('/api/ingest/preview', ({ query, ctx }) => routesIngest.handleIngestPreview(query, ctx), { requireCaspar: false })

// USB Ingest
routes.get('/api/usb-ingest/*', ({ method, path, body, ctx, req }) => routesUsbIngest.handle(method, path, path, body, ctx, req), { requireCaspar: false })
routes.get('/api/usb-ingest', ({ method, path, body, ctx, req }) => routesUsbIngest.handle(method, path, path, body, ctx, req), { requireCaspar: false })
routes.post('/api/usb-ingest/*', ({ method, path, body, ctx, req }) => routesUsbIngest.handle(method, path, path, body, ctx, req), { requireCaspar: false })
routes.post('/api/usb-ingest', ({ method, path, body, ctx, req }) => routesUsbIngest.handle(method, path, path, body, ctx, req), { requireCaspar: false })

// Project
routes.post('/api/project/save', ({ path, body, ctx }) => routesData.handleProject(path, body, ctx), { requireCaspar: false })
routes.post('/api/project/load', ({ path, body, ctx }) => routesData.handleProject(path, body, ctx), { requireCaspar: false })
routes.post('/api/project/autosave', ({ path, body, ctx }) => routesData.handleProject(path, body, ctx), { requireCaspar: false })
routes.post('/api/project/apply-hardware', ({ path, body, ctx }) => routesData.handleProject(path, body, ctx), { requireCaspar: false })
routes.post('/api/project/new', ({ path, body, ctx }) => routesData.handleProject(path, body, ctx), { requireCaspar: false })
routes.post('/api/project/rename', ({ path, body, ctx }) => routesData.handleProject(path, body, ctx), { requireCaspar: false })

routes.get('/api/project/list', ({ ctx }) => routesData.handleProjectList(ctx), { requireCaspar: false })
routes.get('/api/project', ({ ctx }) => routesData.handleProjectGet(ctx), { requireCaspar: false })
routes.get('/api/project/file/*', ({ path }) => routesData.handleProjectFile(path), { requireCaspar: false }) // It handles wildcard itself
routes.delete('/api/project/*', ({ path, ctx }) => routesData.handleProjectDelete(ctx, path), { requireCaspar: false })
routes.get('/api/project/*', ({ path, query, ctx }) => routesProject.handleGet(path, query, ctx), { requireCaspar: false })
routes.post('/api/project/*', ({ path, body, ctx }) => routesProject.handlePost(path, body, ctx), { requireCaspar: false })

// Media Offline (Data operations, file management)
routes.get('/api/media', ({ path, ctx, query }) => routesState.handleGet(path, ctx, query), { requireCaspar: false })
routes.delete('/api/local-media/*', ({ path, ctx }) => routesMedia.handleDeleteLocalMedia(path, ctx), { requireCaspar: false })
routes.post('/api/media/delete', ({ body, ctx }) => routesMedia.handleMediaDelete(body, ctx), { requireCaspar: false })
routes.post('/api/media/mkdir', ({ body, ctx }) => routesMedia.handleMediaMkdir(body, ctx), { requireCaspar: false })
routes.post('/api/media/move', ({ body, ctx }) => routesMedia.handleMediaMove(body, ctx), { requireCaspar: false })
routes.post('/api/media/copy', ({ body, ctx }) => routesMedia.handleMediaCopy(body, ctx), { requireCaspar: false })
routes.post('/api/media/refresh', ({ body, ctx }) => routesMedia.handleMediaRefresh(body, ctx), { requireCaspar: false })
routes.post('/api/media/cinf', ({ path, body, ctx, req, query }) => routesMedia.handlePost(path, body, ctx, req, query), { requireCaspar: false })
routes.post('/api/thumbnail/live/capture', ({ path, body, ctx, req, query }) => routesMedia.handlePost(path, body, ctx, req, query), { requireCaspar: false })
routes.post('/api/thumbnail/live/upload', ({ path, body, ctx, req, query }) => routesMedia.handlePost(path, body, ctx, req, query), { requireCaspar: false })
routes.post('/api/compose-preview/refresh', ({ path, body, ctx }) => routesComposePreview.handlePost(path, body, ctx), { requireCaspar: false })
routes.get('/api/virtual-camera/status', ({ path, ctx }) => routesVirtualCamera.handleGet(path, ctx), { requireCaspar: false })
routes.get('/api/virtual-camera', ({ path, ctx }) => routesVirtualCamera.handleGet(path, ctx), { requireCaspar: false })
routes.post('/api/virtual-camera/config', ({ path, body, ctx }) => routesVirtualCamera.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/virtual-camera/start', ({ path, body, ctx }) => routesVirtualCamera.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/v4l2-inputs/apply', ({ path, body, ctx }) => routesV4l2Input.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/v4l2-inputs/config', ({ path, body, ctx }) => routesV4l2Input.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/virtual-camera/stop', ({ path, body, ctx }) => routesVirtualCamera.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/cg-thumb/render', ({ path, body, ctx }) => routesCgThumb.handlePost(path, body, ctx), { requireCaspar: false })

routes.get('/api/cg-thumb/*', ({ path, query, ctx }) => routesCgThumb.handleGet(path, query, ctx), { requireCaspar: false })
routes.get('/api/cg-thumb', ({ path, query, ctx }) => routesCgThumb.handleGet(path, query, ctx), { requireCaspar: false })

routes.get('/api/compose-preview/*', ({ path, query, ctx }) => routesComposePreview.handleGet(path, query, ctx), { requireCaspar: false })
routes.get('/api/compose-preview', ({ path, query, ctx }) => routesComposePreview.handleGet(path, query, ctx), { requireCaspar: false })

routes.get('/api/thumbnail/*', ({ path, query, ctx }) => routesMedia.handleThumbnail(path, query, ctx), { requireCaspar: false })
routes.get('/api/local-media/*', ({ path, query, ctx }) => routesMedia.handleLocalMedia(path, query, ctx), { requireCaspar: false })

// Streaming Channel
routes.get('/api/streaming-channel/*', ({ method, path, body, ctx }) => routesStreamingChannel.handle(method, path, body, ctx), { requireCaspar: false })
routes.get('/api/streaming-channel', ({ method, path, body, ctx }) => routesStreamingChannel.handle(method, path, body, ctx), { requireCaspar: false })
routes.post('/api/streaming-channel/*', ({ method, path, body, ctx }) => routesStreamingChannel.handle(method, path, body, ctx), { requireCaspar: false })
routes.post('/api/streaming-channel', ({ method, path, body, ctx }) => routesStreamingChannel.handle(method, path, body, ctx), { requireCaspar: false })

// Lower Thirds
routes.get('/api/lower-thirds/*', ({ path, ctx, query }) => routesLowerThirds.handleGet(path, ctx, query), { requireCaspar: false })
routes.get('/api/lower-thirds', ({ path, ctx, query }) => routesLowerThirds.handleGet(path, ctx, query), { requireCaspar: false })
routes.post('/api/lower-thirds/*', ({ path, body, ctx, req }) => routesLowerThirds.handlePost(path, body, ctx, req), { requireCaspar: false })
routes.post('/api/lower-thirds', ({ path, body, ctx, req }) => routesLowerThirds.handlePost(path, body, ctx, req), { requireCaspar: false })

// Countdown / timer template (WO-169) — stateless CG UPDATE addressing, no per-channel singleton.
routes.get('/api/countdown/*', ({ path, ctx, query }) => routesCountdown.handleGet(path, ctx, query), { requireCaspar: false })
routes.get('/api/countdown', ({ path, ctx, query }) => routesCountdown.handleGet(path, ctx, query), { requireCaspar: false })
routes.post('/api/countdown/*', ({ path, body, ctx }) => routesCountdown.handlePost(path, body, ctx), { requireCaspar: false })
routes.post('/api/countdown', ({ path, body, ctx }) => routesCountdown.handlePost(path, body, ctx), { requireCaspar: false })

// Screen timers (WO-210) — panel-owned timer assignments, persistent across restarts
routes.get('/api/timers/list', ({ path, ctx }) => routesScreenTimers.handleGet(path, ctx), { requireCaspar: false })
routes.post('/api/timers/assign', ({ path, body, ctx }) => routesScreenTimers.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/timers/unassign', ({ path, body, ctx }) => routesScreenTimers.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/timers/visible', ({ path, body, ctx }) => routesScreenTimers.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/timers/cmd', ({ path, body, ctx }) => routesScreenTimers.handlePost(path, body, ctx), { requireCaspar: true })

// --- CASPAR REQUIRED ROUTES (requireCaspar: true) ---

routes.get('/api/ndi/*', ({ path, ctx, query }) => routesNdi.handleGet(path, ctx, query), { requireCaspar: true })
routes.get('/api/ndi', ({ path, ctx, query }) => routesNdi.handleGet(path, ctx, query), { requireCaspar: true })

routes.get('/api/pip-overlay/*', ({ path, ctx }) => routesPipOverlay.handleGet(path, ctx), { requireCaspar: true })
routes.get('/api/pip-overlay', ({ path, ctx }) => routesPipOverlay.handleGet(path, ctx), { requireCaspar: true })

// State + Caspar INFO routes (registry `/*` does not match bare `/api/foo`)
const casparStateGet = ({ path, ctx, query }) => routesState.handleGet(path, ctx, query)
routes.get('/api/state', casparStateGet, { requireCaspar: true })
routes.get('/api/state/*', casparStateGet, { requireCaspar: true })
routes.get('/api/templates', casparStateGet, { requireCaspar: true })
routes.get('/api/channels', casparStateGet, { requireCaspar: true })
routes.get('/api/channels/*', casparStateGet, { requireCaspar: true })
routes.get('/api/config', casparStateGet, { requireCaspar: true })
routes.get('/api/fonts', casparStateGet, { requireCaspar: true })
routes.get('/api/server', casparStateGet, { requireCaspar: true })
routes.get('/api/server/*', casparStateGet, { requireCaspar: true })
routes.get('/api/help', casparStateGet, { requireCaspar: true })
routes.get('/api/help/*', casparStateGet, { requireCaspar: true })

routes.get('/api/mixer/*', ({ path, query, ctx }) => routesMixer.handleGet(path, query, ctx), { requireCaspar: true })
routes.get('/api/mixer', ({ path, query, ctx }) => routesMixer.handleGet(path, query, ctx), { requireCaspar: true })

routes.post('/api/amcp/*', ({ path, body, ctx }) => routesAmcp.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/mixer/*', ({ path, body, ctx }) => routesMixer.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/led-test-card/*', ({ path, body, ctx }) => routesLedTestCard.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/ftb/*', ({ path, body, ctx }) => routesFtb.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/pip-overlay/*', ({ path, body, ctx }) => routesPipOverlay.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/cg/*', ({ path, body, ctx }) => routesCg.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/data/*', ({ path, body, ctx }) => routesData.handlePost(path, body, ctx), { requireCaspar: true })

// Media Caspar required POST operations (like PLAY, CLEAR)
routes.post('/api/media/*', ({ path, body, ctx, req, query }) => routesMedia.handlePost(path, body, ctx, req, query), { requireCaspar: true })

routes.get('/api/multiview/debug', ({ ctx }) => routesMultiview.handleMultiviewDebug(ctx), { requireCaspar: false })
routes.post('/api/multiview/*', ({ path, body, ctx }) => routesMultiview.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/scene/live/preview/clear', ({ body, ctx }) =>
	routesScene.handlePost('/api/scene/live/preview/clear', body, ctx), { requireCaspar: false })
routes.post('/api/scene/*', ({ path, body, ctx }) => routesScene.handlePost(path, body, ctx), { requireCaspar: true })
routes.post('/api/misc/*', ({ path, body, ctx }) => routesMisc.handlePost(path, body, ctx), { requireCaspar: true })

// Timeline catchall post
routes.get('/api/timeline/*', ({ method, path, body, ctx }) => routesTimeline.handle(method, path, body, ctx), { requireCaspar: true })
routes.post('/api/timeline/*', ({ method, path, body, ctx }) => routesTimeline.handle(method, path, body, ctx), { requireCaspar: true })
routes.delete('/api/timeline/*', ({ method, path, body, ctx }) => routesTimeline.handle(method, path, body, ctx), { requireCaspar: true })


/**
 * Route request entry point.
 * @param {string} method
 * @param {string} path
 * @param {string} body
 * @param {import('http').IncomingMessage} req
 */
async function routeRequest(method, path, body, ctx, req) {
	const pathRaw = path || ''
	const qIdx = pathRaw.indexOf('?')
	const query = parseQueryString(qIdx >= 0 ? pathRaw.slice(qIdx + 1) : '')
	let p = qIdx >= 0 ? pathRaw.slice(0, qIdx) : pathRaw
	
	const instanceMatch = p.match(/^\/instance\/[^/]+\/(.+)$/)
	if (instanceMatch) p = '/' + instanceMatch[1]

	if (!p.startsWith('/api/')) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Not found' }) }
	}

	const authResult = checkHttpAuth(method, p, req, ctx)
	if (!authResult.ok) {
		return {
			status: authResult.status || 401,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: authResult.error || 'Unauthorized' }),
		}
	}

	if (method === 'POST' && p === '/api/selection') {
		try {
			const payload = parseBody(body)
			if (ctx.state) applyUiSelectionPayloadToVariables(ctx.state, payload && typeof payload === 'object' ? payload : {})
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: msg }) }
		}
	}

	// Module hook handled explicitly before standard routes
	const mr = await moduleRegistry.handleApi(method, p, body, ctx, req, query)
	if (mr) return mr
	
	const pg = await routesPlugins.handleGet(method, p, ctx)
	if (pg) return pg

	const pgPost = await routesPlugins.handlePost(method, p, body, ctx)
	if (pgPost) return pgPost

	try {
		// Dispatch to RouteRegistry
		const result = await routes.dispatch(method, p, body, ctx, req, query)
		if (result) return result
	} catch (e) {
		const msg = e?.message || String(e)
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}

	// Registry `/*` patterns require a trailing segment (`/api/foo/bar`), not bare `/api/foo`.
	// Keep legacy exact-path dispatch for AMCP basics, LED test card, FTB, timelines, etc.
	if (ctx.amcp) {
		try {
			if (method === 'POST') {
				let r = await routesAmcp.handlePost(p, body, ctx)
				if (r) return r
				r = await routesMixer.handlePost(p, body, ctx)
				if (r) return r
				r = await routesLedTestCard.handlePost(p, body, ctx)
				if (r) return r
				r = await routesFtb.handlePost(p, body, ctx)
				if (r) return r
				r = await routesPipOverlay.handlePost(p, body, ctx)
				if (r) return r
				r = await routesCg.handlePost(p, body, ctx)
				if (r) return r
				r = await routesData.handlePost(p, body, ctx)
				if (r) return r
				r = await routesMedia.handlePost(p, body, ctx, req, query)
				if (r) return r
				r = await routesMultiview.handlePost(p, body, ctx)
				if (r) return r
				r = await routesScene.handlePost(p, body, ctx)
				if (r) return r
				r = await routesProject.handlePost(p, body, ctx)
				if (r) return r
				r = await routesMisc.handlePost(p, body, ctx)
				if (r) return r
			}

			const tlResult = await routesTimeline.handle(method, p, body, ctx)
			if (tlResult) return tlResult
		} catch (e) {
			const msg = e?.message || String(e)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}

	return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Not found' }) }
}

module.exports = {
	routeRequest,
	getState,
	parseBody,
	parseQueryString,
	JSON_HEADERS,
	jsonBody,
}
