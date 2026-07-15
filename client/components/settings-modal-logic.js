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
import { api } from '../lib/api-client.js'

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
		operatorTools: {
			pointerConfineMultiview: false,
		},
		projectScopedMedia: {
			enabled: !!(modal.querySelector('#set-project-scoped-media') || {}).checked,
			location: modal.querySelector('#set-project-media-location')?.value ?? prevAll.projectScopedMedia?.location ?? 'internal',
		},
		streamingChannel: (() => {
			const prevSch = prevAll.streamingChannel || {}
			const ovr = (modal.querySelector('#set-streaming-ch-override') || {}).value?.trim?.() || ''
			let casparChannel = prevSch.casparChannel ?? null
			if (ovr !== '') {
				const n = parseInt(ovr, 10)
				if (Number.isFinite(n) && n >= 1) casparChannel = n
			}
			const clearCreds = modal.querySelector('#set-streaming-ch-clear-creds')?.checked || false
			return {
				enabled: modal.querySelector('#set-streaming-ch-enabled')?.checked ?? !!prevSch.enabled,
				dedicatedOutputChannel: modal.querySelector('#set-streaming-ch-dedicated-output')?.checked ?? !!prevSch.dedicatedOutputChannel,
				casparChannel,
				videoMode: modal.querySelector('#set-streaming-ch-mode')?.value ?? prevSch.videoMode ?? '1080p5000',
				videoSource: modal.querySelector('#set-streaming-ch-source')?.value ?? prevSch.videoSource ?? 'program_1',
				audioSource: modal.querySelector('#set-streaming-ch-audio')?.value ?? prevSch.audioSource ?? 'follow_video',
				contentLayer: parseInt(String(modal.querySelector('#set-streaming-ch-layer')?.value ?? prevSch.contentLayer ?? '10'), 10) || 10,
				decklinkDevice: parseInt(String(modal.querySelector('#set-streaming-ch-decklink')?.value ?? prevSch.decklinkDevice ?? '0'), 10) || 0,
				rtmpServerUrl: modal.querySelector('#set-streaming-ch-rtmp-url')?.value?.trim?.() ?? prevSch.rtmpServerUrl ?? '',
				streamKey: modal.querySelector('#set-streaming-ch-stream-key')?.value?.trim?.() ?? prevSch.streamKey ?? '',
				clearCredentials: clearCreds,
			}
		})(),
	}
	delete settings.offline_mode
	return settings
}

/**
 * Mount the screen labels inputs section in the modal.
 * @param {HTMLElement} mountEl - The element to mount into (#settings-screen-labels-mount)
 * @param {object} cfg - Settings config (with channelMap)
 */
export function mountScreenLabelsSection(mountEl, cfg) {
	if (!mountEl) return

	const cm = cfg?.channelMap || {}
	const screenCount = cm.screenCount || 1
	const labels = Array.isArray(cm.screenLabels) ? cm.screenLabels : []

	const container = document.createElement('div')
	container.style.display = 'flex'
	container.style.flexDirection = 'column'
	container.style.gap = '0.5rem'

	for (let i = 0; i < screenCount; i++) {
		const group = document.createElement('div')
		group.className = 'settings-group'

		const label = document.createElement('label')
		label.htmlFor = `set-screen-label-${i}`
		label.textContent = `Screen ${i + 1}`

		const input = document.createElement('input')
		input.type = 'text'
		input.id = `set-screen-label-${i}`
		input.className = 'screen-label-input'
		input.placeholder = `S${i + 1}`
		input.value = labels[i] || ''
		input.dataset.screenIdx = String(i)

		group.appendChild(label)
		group.appendChild(input)
		container.appendChild(group)
	}

	mountEl.innerHTML = ''
	mountEl.appendChild(container)
}

/**
 * Collect screen label changes and save them via POST /api/screens/label
 * @param {HTMLElement} modal
 */
export async function saveChangedScreenLabels(modal) {
	const mount = modal.querySelector('#settings-screen-labels-mount')
	if (!mount) return

	const inputs = mount.querySelectorAll('input.screen-label-input')
	const changes = []

	inputs.forEach((input) => {
		const idx = parseInt(input.dataset.screenIdx, 10)
		const newLabel = input.value.trim()
		const oldLabel = input.placeholder.replace('S', '')

		// Only save if changed from placeholder or has a value
		if (newLabel && newLabel !== oldLabel) {
			changes.push({ screenIdx: idx, label: newLabel })
		} else if (!newLabel && input.hasAttribute('data-was-set')) {
			// Clear label if it was previously set
			changes.push({ screenIdx: idx, label: '' })
			input.removeAttribute('data-was-set')
		}
	})

	for (const change of changes) {
		try {
			await api.post('/api/screens/label', {
				screenIdx: change.screenIdx,
				label: change.label,
			})
		} catch (e) {
			console.error(`Failed to save screen label ${change.screenIdx}:`, e)
		}
	}
}

export function hydrateSettings(modal, cfg) {
	const fps = sceneState.getCanvasForScreen(0).framerate
	hydrateEditorDefaultsModal(modal, cfg.editorDefaults, fps)
	mountScreenLabelsSection(modal.querySelector('#settings-screen-labels-mount'), cfg)
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
	const schUrl = modal.querySelector('#set-streaming-ch-rtmp-url'); if (schUrl) schUrl.value = sch.rtmpServerUrl || ''
	const schKey = modal.querySelector('#set-streaming-ch-stream-key'); if (schKey) {
		schKey.value = ''
		if (sch.hasStreamKey) schKey.placeholder = 'saved — leave blank to keep'
	}
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
