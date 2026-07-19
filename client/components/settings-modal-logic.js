/**
 * Collection and hydration logic for Settings Modal.
 */
import { settingsState } from '../lib/settings-state.js'
import { collectEditorDefaultsFromModal, hydrateEditorDefaultsModal, applyEditorDefaultsToRuntime } from '../lib/editor-defaults.js'
import { sceneState } from '../lib/scene-state.js'
import {
	collectOpenalAudioRoutingFromModal,
} from './settings-modal-caspar-collect.js'
import { syncNuclearPasswordVisibility } from '../lib/settings-nuclear-shared.js'

/** Push Defaults tab values into settingsState so new layers/clips use them before autosave completes. */
export function syncEditorDefaultsFromModal(modal) {
	const editorDefaults = collectEditorDefaultsFromModal(modal)
	settingsState.settings.editorDefaults = editorDefaults
	applyEditorDefaultsToRuntime(sceneState, { syncSceneGlobalTransition: true })
	return editorDefaults
}

/** @param {number} fps */
function clampComposePreviewFps(fps) {
	const n = parseInt(String(fps), 10)
	if (!Number.isFinite(n)) return 2
	return Math.max(1, Math.min(30, n))
}

export function syncComposePreviewFpsLabel(modal) {
	const range = modal.querySelector('#set-compose-preview-fps')
	const label = modal.querySelector('#set-compose-preview-fps-val')
	if (!range || !label) return
	label.textContent = String(clampComposePreviewFps(range.value))
}

/** @param {number} q */
function clampComposePreviewJpegQuality(q) {
	const n = parseInt(String(q), 10)
	if (!Number.isFinite(n)) return 10
	return Math.max(2, Math.min(31, n))
}

export function syncComposePreviewJpegQualityLabel(modal) {
	const range = modal.querySelector('#set-compose-preview-jpeg-q')
	const label = modal.querySelector('#set-compose-preview-jpeg-q-val')
	if (!range || !label) return
	label.textContent = String(clampComposePreviewJpegQuality(range.value))
}

export function syncComposePreviewModeVisibility(modal) {
	const mode = modal.querySelector('#set-compose-preview-mode')?.value || 'canvas'
	const ffmpegFields = modal.querySelector('#set-compose-preview-ffmpeg-fields')
	if (ffmpegFields) ffmpegFields.style.display = mode === 'ffmpeg_jpeg' ? '' : 'none'
}

export function buildSettingsPayload(modal) {
	const prevAr = settingsState.getSettings()?.audioRouting || {}
	const openalAr = collectOpenalAudioRoutingFromModal(modal)
	const prevStream = settingsState.getSettings()?.streaming || {}
	const prevAll = settingsState.getSettings() || {}
	const editorDefaults = syncEditorDefaultsFromModal(modal)

	const settings = {
		...prevAll,
		editorDefaults,
		local_media_path: modal.querySelector('#set-local-media-path')?.value?.trim() ?? prevAll.local_media_path ?? '',
		caspar: {
			host: modal.querySelector('#set-caspar-host')?.value ?? prevAll.caspar?.host ?? '127.0.0.1',
			port: modal.querySelector('#set-caspar-port')?.value ?? prevAll.caspar?.port ?? 5250,
		},
		// Legacy preview settings are removed from UI and kept disabled.
		streaming: {
			...prevStream,
			enabled: false,
			captureMode: 'udp',
		},
		periodic_sync_interval_sec: prevAll.periodic_sync_interval_sec ?? '',
		periodic_sync_interval_sec_osc: prevAll.periodic_sync_interval_sec_osc ?? '',
		osc: {
			listenPort: modal.querySelector('#set-osc-port')?.value ?? prevAll.osc?.listenPort ?? 6251,
			listenAddress: modal.querySelector('#set-osc-bind')?.value ?? prevAll.osc?.listenAddress ?? '0.0.0.0',
			peakHoldMs: modal.querySelector('#set-osc-peak')?.value ?? prevAll.osc?.peakHoldMs ?? 2000,
		},
		ui: {
			...(prevAll.ui || {}),
			oscFooterVu: true,
			rundownPlaybackTimer: true,
			nuclearRequirePassword: !!(modal.querySelector('#set-nuclear-require-pass') || {}).checked,
			nuclearPassword: (modal.querySelector('#set-nuclear-password') || {}).value ?? '',
		},
		companion: {
			host: modal.querySelector('#set-companion-host').value || '127.0.0.1',
			port: parseInt(modal.querySelector('#set-companion-port').value, 10) || 8000,
			satelliteEnabled: !!(modal.querySelector('#set-companion-satellite-enabled') || {}).checked,
			satelliteHost: (modal.querySelector('#set-companion-satellite-host') || {}).value?.trim?.() ?? '',
			satellitePort: parseInt((modal.querySelector('#set-companion-satellite-port') || {}).value, 10) || 16622,
			previewBitmapSize: parseInt((modal.querySelector('#set-companion-preview-size') || {}).value, 10) || 72,
			pickerGridSize: parseInt((modal.querySelector('#set-companion-picker-grid') || {}).value, 10) || 8,
		},
		audioRouting: { ...prevAr, ...openalAr },
		composePreview: {
			...(prevAll.composePreview || {}),
			mode: modal.querySelector('#set-compose-preview-mode')?.value ?? prevAll.composePreview?.mode ?? 'canvas',
			fps: clampComposePreviewFps(modal.querySelector('#set-compose-preview-fps')?.value ?? prevAll.composePreview?.fps ?? 25),
			resolutionScale: modal.querySelector('#set-compose-preview-scale')?.value ?? prevAll.composePreview?.resolutionScale ?? 'half',
			jpegQuality: clampComposePreviewJpegQuality(modal.querySelector('#set-compose-preview-jpeg-q')?.value ?? prevAll.composePreview?.jpegQuality ?? 10),
			companionThumbEnabled: !!(modal.querySelector('#set-compose-preview-companion-thumb') || {}).checked,
		},
		dmx: JSON.parse(JSON.stringify(settingsState.getSettings()?.dmx || { enabled: false, debugLogDmx: false, fps: 25, fixtures: [] })),
		casparServer: JSON.parse(JSON.stringify(prevAll.casparServer || {})),
		rtmp: JSON.parse(JSON.stringify(prevAll.rtmp || {})),
		usbIngest: {
			enabled: !!(modal.querySelector('#set-usb-enabled') || {}).checked,
			defaultSubfolder: (modal.querySelector('#set-usb-subfolder') || {}).value?.trim() ?? '',
			overwritePolicy: (modal.querySelector('#set-usb-policy') || {}).value ?? 'rename',
			verifyHash: !!(modal.querySelector('#set-usb-verify') || {}).checked,
		},
		// operatorTools / streamingChannel deliberately NOT collected here (owner request
		// 2026-07-18): the modal used to hardcode pointerConfineMultiview:false and re-post the
		// streaming channel on every save; both now live in the Devices tab and the server
		// leaves keys untouched when absent from the patch.
		projectScopedMedia: {
			enabled: !!(modal.querySelector('#set-project-scoped-media') || {}).checked,
			location: modal.querySelector('#set-project-media-location')?.value ?? prevAll.projectScopedMedia?.location ?? 'internal',
		},
	}
	delete settings.offline_mode
	return settings
}

// Screen-label editing moved to the Devices tab destination inspector (owner request 2026-07-18)
// — see device-view-destinations-inspector-form.js (POST /api/screens/label per screen).

export function hydrateSettings(modal, cfg) {
	const fps = sceneState.getCanvasForScreen(0).framerate
	hydrateEditorDefaultsModal(modal, cfg.editorDefaults, fps)
	const casparHostEl = modal.querySelector('#set-caspar-host'); if (casparHostEl) casparHostEl.value = cfg.caspar.host
	const casparPortEl = modal.querySelector('#set-caspar-port'); if (casparPortEl) casparPortEl.value = cfg.caspar.port
	const osc = cfg.osc || {}
	const oscPortEl = modal.querySelector('#set-osc-port'); if (oscPortEl) oscPortEl.value = osc.listenPort ?? 6251
	const oscBindEl = modal.querySelector('#set-osc-bind'); if (oscBindEl) oscBindEl.value = osc.listenAddress || '0.0.0.0'
	const oscPeakEl = modal.querySelector('#set-osc-peak'); if (oscPeakEl) oscPeakEl.value = osc.peakHoldMs ?? 2000
	const comp = cfg.companion || {}
	modal.querySelector('#set-companion-host').value = comp.host || '127.0.0.1'
	modal.querySelector('#set-companion-port').value = comp.port || 8000
	const satEn = modal.querySelector('#set-companion-satellite-enabled')
	if (satEn) satEn.checked = comp.satelliteEnabled !== false
	const satHost = modal.querySelector('#set-companion-satellite-host')
	if (satHost) satHost.value = comp.satelliteHost || ''
	const satPort = modal.querySelector('#set-companion-satellite-port')
	if (satPort) satPort.value = comp.satellitePort ?? 16622
	const prevSize = modal.querySelector('#set-companion-preview-size')
	if (prevSize) prevSize.value = comp.previewBitmapSize ?? 72
	const pickerGrid = modal.querySelector('#set-companion-picker-grid')
	if (pickerGrid) pickerGrid.value = comp.pickerGridSize ?? 8
	const lmp = modal.querySelector('#set-local-media-path'); if (lmp) lmp.value = cfg.local_media_path || ''
	const u = cfg.usbIngest || {}
	const usbEn = modal.querySelector('#set-usb-enabled'); if (usbEn) usbEn.checked = u.enabled !== false
	const psm = cfg.projectScopedMedia || {}
	const psmEl = modal.querySelector('#set-project-scoped-media'); if (psmEl) psmEl.checked = psm.enabled !== false
	const psmLoc = modal.querySelector('#set-project-media-location')
	if (psmLoc) {
		const loc = String(psm.location || 'internal').toLowerCase()
		psmLoc.value = loc === 'exfat' || loc === 'bridge' ? loc : 'internal'
	}
	const usbSub = modal.querySelector('#set-usb-subfolder'); if (usbSub) usbSub.value = u.defaultSubfolder || ''
	const usbPol = modal.querySelector('#set-usb-policy'); if (usbPol) usbPol.value = ['skip', 'overwrite', 'rename'].includes(u.overwritePolicy) ? u.overwritePolicy : 'rename'
	const usbVer = modal.querySelector('#set-usb-verify'); if (usbVer) usbVer.checked = !!u.verifyHash
	const ui = cfg.ui || {}
	const nr = modal.querySelector('#set-nuclear-require-pass'); if (nr) nr.checked = ui.nuclearRequirePassword === true || ui.nuclearRequirePassword === 'true'
	const np = modal.querySelector('#set-nuclear-password')
	if (np) {
		const raw = String(ui.nuclearPassword || '')
		np.value = raw === '[REDACTED]' ? '' : raw
	}
	syncNuclearPasswordVisibility(modal)
	const cp = cfg.composePreview || {}
	const cpMode = modal.querySelector('#set-compose-preview-mode')
	if (cpMode) {
		const m = cp.mode === 'ffmpeg_jpeg' ? 'ffmpeg_jpeg' : 'canvas'
		cpMode.value = m
	}
	syncComposePreviewModeVisibility(modal)
	const cpFps = modal.querySelector('#set-compose-preview-fps')
	if (cpFps) {
		cpFps.value = String(clampComposePreviewFps(cp.fps ?? 25))
		syncComposePreviewFpsLabel(modal)
	}
	const cpScale = modal.querySelector('#set-compose-preview-scale')
	if (cpScale) {
		const s = String(cp.resolutionScale || 'half')
		cpScale.value = s === '75' || s === 'full' ? s : 'half'
	}
	const cpJq = modal.querySelector('#set-compose-preview-jpeg-q')
	if (cpJq) {
		cpJq.value = String(clampComposePreviewJpegQuality(cp.jpegQuality ?? 10))
		syncComposePreviewJpegQualityLabel(modal)
	}
	const cpCompanion = modal.querySelector('#set-compose-preview-companion-thumb')
	if (cpCompanion) cpCompanion.checked = cp.companionThumbEnabled === true
}
