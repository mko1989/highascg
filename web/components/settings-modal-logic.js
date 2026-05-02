/**
 * Collection and hydration logic for Settings Modal.
 */
import { settingsState } from '../lib/settings-state.js'
import {
	collectOpenalAudioRoutingFromModal,
} from './settings-modal-caspar-collect.js'

export function buildSettingsPayload(modal) {
	const prevAr = settingsState.getSettings()?.audioRouting || {}
	const openalAr = collectOpenalAudioRoutingFromModal(modal)
	const prevStream = settingsState.getSettings()?.streaming || {}
	const prevAll = settingsState.getSettings() || {}
	
	const settings = {
		caspar: {
			host: modal.querySelector('#set-caspar-host')?.value ?? prevAll.caspar?.host ?? '127.0.0.1',
			port: modal.querySelector('#set-caspar-port')?.value ?? prevAll.caspar?.port ?? 5250,
		},
		streaming: {
			...prevStream,
			enabled: modal.querySelector('#set-stream-enabled').checked, captureMode: 'udp',
			quality: modal.querySelector('#set-stream-quality').value, basePort: modal.querySelector('#set-stream-port').value,
			hardware_accel: modal.querySelector('#set-stream-hw').checked,
			go2rtcLogLevel: (modal.querySelector('#set-stream-go2rtc-log') || {}).value ?? '',
			autoRelocateBasePort: (modal.querySelector('#set-stream-auto-relocate') || {}).checked ?? true,
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
		pixelhue: (() => {
			const prevPixelHue = prevAll.pixelhue || {}
			const rawApi = (modal.querySelector('#set-ph-apiport') || {}).value
			let apiPort = null
			if (rawApi != null && String(rawApi).trim() !== '') {
				const n = parseInt(String(rawApi).trim(), 10); if (Number.isFinite(n) && n > 0) apiPort = n
			} else {
				apiPort = prevPixelHue.apiPort ?? null
			}
			return {
				enabled: modal.querySelector('#set-ph-enabled')?.checked ?? !!prevPixelHue.enabled,
				host: modal.querySelector('#set-ph-host')?.value?.trim() ?? prevPixelHue.host ?? '',
				unicoPort: parseInt(String(modal.querySelector('#set-ph-unico')?.value ?? prevPixelHue.unicoPort ?? '19998'), 10) || 19998,
				apiPort,
				targetSerial: modal.querySelector('#set-ph-sn')?.value?.trim() ?? prevPixelHue.targetSerial ?? '',
			}
		})(),
		audioRouting: { ...prevAr, ...openalAr },
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
	const casparHostEl = modal.querySelector('#set-caspar-host'); if (casparHostEl) casparHostEl.value = cfg.caspar.host
	const casparPortEl = modal.querySelector('#set-caspar-port'); if (casparPortEl) casparPortEl.value = cfg.caspar.port
	const streamEnabledEl = modal.querySelector('#set-stream-enabled'); if (streamEnabledEl) streamEnabledEl.checked = cfg.streaming.enabled
	const streamQualityEl = modal.querySelector('#set-stream-quality'); if (streamQualityEl) streamQualityEl.value = cfg.streaming.quality
	const streamHwEl = modal.querySelector('#set-stream-hw'); if (streamHwEl) streamHwEl.checked = cfg.streaming.hardware_accel
	const streamPortEl = modal.querySelector('#set-stream-port'); if (streamPortEl) streamPortEl.value = cfg.streaming.basePort
	const g2l = modal.querySelector('#set-stream-go2rtc-log'); if (g2l) g2l.value = cfg.streaming.go2rtcLogLevel || ''
	const arEl = modal.querySelector('#set-stream-auto-relocate'); if (arEl) arEl.checked = cfg.streaming.autoRelocateBasePort !== false
	const offlineModeEl = modal.querySelector('#set-offline-mode'); if (offlineModeEl) offlineModeEl.checked = !!cfg.offline_mode
	const osc = cfg.osc || {}
	const oscPortEl = modal.querySelector('#set-osc-port'); if (oscPortEl) oscPortEl.value = osc.listenPort ?? 6251
	const oscBindEl = modal.querySelector('#set-osc-bind'); if (oscBindEl) oscBindEl.value = osc.listenAddress || '0.0.0.0'
	const oscPeakEl = modal.querySelector('#set-osc-peak'); if (oscPeakEl) oscPeakEl.value = osc.peakHoldMs ?? 2000
	const comp = cfg.companion || {}
	modal.querySelector('#set-companion-host').value = comp.host || '127.0.0.1'
	modal.querySelector('#set-companion-port').value = comp.port || 8000
	const ph = cfg.pixelhue || {}
	const phEn = modal.querySelector('#set-ph-enabled')
	if (phEn) {
		phEn.checked = ph.enabled === true || ph.enabled === 'true'
		const phH = modal.querySelector('#set-ph-host'); if (phH) phH.value = ph.host ?? ''
		const phU = modal.querySelector('#set-ph-unico'); if (phU) phU.value = ph.unicoPort ?? '19998'
		const phA = modal.querySelector('#set-ph-apiport'); if (phA) phA.value = ph.apiPort ?? ''
		const phS = modal.querySelector('#set-ph-sn'); if (phS) phS.value = ph.targetSerial ?? ''
	}
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
}
