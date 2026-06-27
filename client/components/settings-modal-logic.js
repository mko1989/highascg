/**
 * Collection and hydration logic for Settings Modal.
 */
import { settingsState } from '../lib/settings-state.js'
import { collectEditorDefaultsFromModal, hydrateEditorDefaultsModal, applyEditorDefaultsToRuntime } from '../lib/editor-defaults.js'
import { sceneState } from '../lib/scene-state.js'
import {
	collectOpenalAudioRoutingFromModal,
} from './settings-modal-caspar-collect.js'

/** Push Defaults tab values into settingsState so new layers/clips use them before autosave completes. */
export function syncEditorDefaultsFromModal(modal) {
	const editorDefaults = collectEditorDefaultsFromModal(modal)
	settingsState.settings.editorDefaults = editorDefaults
	applyEditorDefaultsToRuntime(sceneState, { syncSceneGlobalTransition: true })
	return editorDefaults
}

/** @param {number} ms */
function clampComposePreviewTickMs(ms) {
	const n = parseInt(String(ms), 10)
	if (!Number.isFinite(n)) return 125
	return Math.max(100, Math.min(1000, Math.round(n / 25) * 25))
}

/** @param {number} fps */
function clampComposePreviewFps(fps) {
	const n = parseInt(String(fps), 10)
	if (!Number.isFinite(n)) return 2
	return Math.max(1, Math.min(30, n))
}

export function syncComposePreviewTickLabel(modal) {
	const range = modal.querySelector('#set-compose-preview-tick-ms')
	const label = modal.querySelector('#set-compose-preview-tick-ms-val')
	if (!range || !label) return
	label.textContent = String(clampComposePreviewTickMs(range.value))
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
	const tickFields = modal.querySelector('#set-compose-preview-tick-fields')
	if (ffmpegFields) ffmpegFields.style.display = mode === 'ffmpeg_jpeg' ? '' : 'none'
	if (tickFields) tickFields.style.display = mode === 'caspar_image' ? '' : 'none'
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
		offline_mode: modal.querySelector('#set-offline-mode')?.checked ?? !!prevAll.offline_mode,
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
		},
		audioRouting: { ...prevAr, ...openalAr },
		composePreview: {
			...(prevAll.composePreview || {}),
			mode: modal.querySelector('#set-compose-preview-mode')?.value ?? prevAll.composePreview?.mode ?? 'canvas',
			fps: clampComposePreviewFps(modal.querySelector('#set-compose-preview-fps')?.value ?? prevAll.composePreview?.fps ?? 2),
			resolutionScale: modal.querySelector('#set-compose-preview-scale')?.value ?? prevAll.composePreview?.resolutionScale ?? 'half',
			jpegQuality: clampComposePreviewJpegQuality(modal.querySelector('#set-compose-preview-jpeg-q')?.value ?? prevAll.composePreview?.jpegQuality ?? 10),
			tickIntervalMs: clampComposePreviewTickMs(modal.querySelector('#set-compose-preview-tick-ms')?.value ?? prevAll.composePreview?.tickIntervalMs ?? 125),
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
		streamingChannel: (() => {
			const prevSch = prevAll.streamingChannel || {}
			const ovr = (modal.querySelector('#set-streaming-ch-override') || {}).value?.trim?.() || ''
			let casparChannel = prevSch.casparChannel ?? null
			if (ovr !== '') {
				const n = parseInt(ovr, 10)
				if (Number.isFinite(n) && n >= 1) casparChannel = n
			}
			return {
				enabled: modal.querySelector('#set-streaming-ch-enabled')?.checked ?? !!prevSch.enabled,
				dedicatedOutputChannel: modal.querySelector('#set-streaming-ch-dedicated-output')?.checked ?? !!prevSch.dedicatedOutputChannel,
				casparChannel,
				videoMode: modal.querySelector('#set-streaming-ch-mode')?.value ?? prevSch.videoMode ?? '1080p5000',
				videoSource: modal.querySelector('#set-streaming-ch-source')?.value ?? prevSch.videoSource ?? 'program_1',
				audioSource: modal.querySelector('#set-streaming-ch-audio')?.value ?? prevSch.audioSource ?? 'follow_video',
				contentLayer: parseInt(String(modal.querySelector('#set-streaming-ch-layer')?.value ?? prevSch.contentLayer ?? '10'), 10) || 10,
				decklinkDevice: parseInt(String(modal.querySelector('#set-streaming-ch-decklink')?.value ?? prevSch.decklinkDevice ?? '0'), 10) || 0,
			}
		})(),
	}
	return settings
}

export function hydrateSettings(modal, cfg) {
	const fps = sceneState.getCanvasForScreen(0).framerate
	hydrateEditorDefaultsModal(modal, cfg.editorDefaults, fps)
	const casparHostEl = modal.querySelector('#set-caspar-host'); if (casparHostEl) casparHostEl.value = cfg.caspar.host
	const casparPortEl = modal.querySelector('#set-caspar-port'); if (casparPortEl) casparPortEl.value = cfg.caspar.port
	const offlineModeEl = modal.querySelector('#set-offline-mode'); if (offlineModeEl) offlineModeEl.checked = !!cfg.offline_mode
	const osc = cfg.osc || {}
	const oscPortEl = modal.querySelector('#set-osc-port'); if (oscPortEl) oscPortEl.value = osc.listenPort ?? 6251
	const oscBindEl = modal.querySelector('#set-osc-bind'); if (oscBindEl) oscBindEl.value = osc.listenAddress || '0.0.0.0'
	const oscPeakEl = modal.querySelector('#set-osc-peak'); if (oscPeakEl) oscPeakEl.value = osc.peakHoldMs ?? 2000
	const comp = cfg.companion || {}
	modal.querySelector('#set-companion-host').value = comp.host || '127.0.0.1'
	modal.querySelector('#set-companion-port').value = comp.port || 8000
	const lmp = modal.querySelector('#set-local-media-path'); if (lmp) lmp.value = cfg.local_media_path || ''
	const u = cfg.usbIngest || {}
	const usbEn = modal.querySelector('#set-usb-enabled'); if (usbEn) usbEn.checked = u.enabled !== false
	const usbSub = modal.querySelector('#set-usb-subfolder'); if (usbSub) usbSub.value = u.defaultSubfolder || ''
	const usbPol = modal.querySelector('#set-usb-policy'); if (usbPol) usbPol.value = ['skip', 'overwrite', 'rename'].includes(u.overwritePolicy) ? u.overwritePolicy : 'rename'
	const usbVer = modal.querySelector('#set-usb-verify'); if (usbVer) usbVer.checked = !!u.verifyHash
	const sch = cfg.streamingChannel || {}
	const schEn = modal.querySelector('#set-streaming-ch-enabled'); if (schEn) schEn.checked = sch.enabled === true || sch.enabled === 'true'
	const schDed = modal.querySelector('#set-streaming-ch-dedicated-output')
	if (schDed) schDed.checked = sch.dedicatedOutputChannel === true || sch.dedicatedOutputChannel === 'true'
	const schOvr = modal.querySelector('#set-streaming-ch-override')
	if (schOvr) {
		schOvr.value = sch.casparChannel != null && sch.casparChannel !== '' && Number(sch.casparChannel) >= 1 ? String(sch.casparChannel) : ''
	}
	const sm = String(sch.videoMode || '1080p5000')
	const schMode = modal.querySelector('#set-streaming-ch-mode'); if (schMode && [...schMode.options].some(o => o.value === sm)) schMode.value = sm
	const schSrc = modal.querySelector('#set-streaming-ch-source'); if (schSrc) { const vs = String(sch.videoSource || 'program_1'); if ([...schSrc.options].some(o => o.value === vs)) schSrc.value = vs }
	const schAudio = modal.querySelector('#set-streaming-ch-audio'); if (schAudio) { const as = String(sch.audioSource || 'follow_video'); if ([...schAudio.options].some(o => o.value === as)) schAudio.value = as }
	const schLay = modal.querySelector('#set-streaming-ch-layer'); if (schLay) schLay.value = String(sch.contentLayer ?? 10)
	const schDl = modal.querySelector('#set-streaming-ch-decklink'); if (schDl) schDl.value = String(sch.decklinkDevice ?? 0)
	const ui = cfg.ui || {}
	const nr = modal.querySelector('#set-nuclear-require-pass'); if (nr) nr.checked = ui.nuclearRequirePassword === true || ui.nuclearRequirePassword === 'true'
	const np = modal.querySelector('#set-nuclear-password'); if (np) np.value = String(ui.nuclearPassword || '')
	const cp = cfg.composePreview || {}
	const cpMode = modal.querySelector('#set-compose-preview-mode')
	if (cpMode) {
		const m = cp.mode === 'ffmpeg_jpeg' || cp.mode === 'caspar_image' ? cp.mode : 'canvas'
		cpMode.value = m
	}
	syncComposePreviewModeVisibility(modal)
	const cpFps = modal.querySelector('#set-compose-preview-fps')
	if (cpFps) {
		cpFps.value = String(clampComposePreviewFps(cp.fps ?? 2))
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
	const cpTick = modal.querySelector('#set-compose-preview-tick-ms')
	if (cpTick) {
		const ms = clampComposePreviewTickMs(cp.tickIntervalMs ?? (cp.tickHz ? Math.floor(1000 / cp.tickHz) : 125))
		cpTick.value = String(ms)
		syncComposePreviewTickLabel(modal)
	}
}
