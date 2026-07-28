/**
 * Virtual camera (v4l2 loopback) controls for Device View inspector.
 */
import { setStatus } from './device-view-ui-utils.js'
import {
	getVirtualCameraStatus,
	refreshVirtualCameraStatus,
	saveVirtualCameraConfig,
	startVirtualCamera,
	stopVirtualCamera,
	subscribeVirtualCameraStatus,
} from '../lib/virtual-camera-state.js'
import { attachMathInput } from '../lib/math-input.js'

function savedVirtualCamera(currentSettings, conn) {
	const vc = currentSettings?.virtualCamera
	if (vc && typeof vc === 'object') return vc
	const caspar = conn?.caspar && typeof conn.caspar === 'object' ? conn.caspar : {}
	return {
		label: conn?.label || 'Virtual cam',
		channel: caspar.channel ?? 1,
		device: conn?.externalRef || '/dev/video10',
		fps: caspar.fps ?? 50,
		width: caspar.width ?? 1920,
		height: caspar.height ?? 1080,
		audioEnabled: caspar.audioEnabled !== false,
		shaderCamera: caspar.shaderCamera === true,
		alsaLoopbackCardId: caspar.alsaLoopbackCardId || 'HighAsCG_VCam',
	}
}

function renderStatusBlock(live) {
	const lines = []
	lines.push(`Running: ${live?.running ? 'yes' : 'no'}`)
	if (live?.video?.relay?.device) lines.push(`Video: ${live.video.relay.device}`)
	if (live?.video?.relay?.pid) lines.push(`Relay PID: ${live.video.relay.pid}`)
	if (live?.audio?.attached != null) {
		lines.push(`Audio: ${live.audio.attached ? 'attached' : 'off'} (${live.audio.transport || 'alsa_loopback'})`)
	}
	if (live?.audio?.captureDevice) lines.push(`Mic device: ${live.audio.captureDevice}`)
	if (live?.video?.consumer?.lastError) lines.push(`Video error: ${live.video.consumer.lastError}`)
	if (live?.audio?.lastError) lines.push(`Audio error: ${live.audio.lastError}`)
	return lines.join('\n')
}

export function renderVirtualCamOutControls(h, conn, { currentSettings, statusEl, load, onRemoveVirtualCamOutput }) {
	const saved = savedVirtualCamera(currentSettings, conn)
	const caspar = conn?.caspar && typeof conn.caspar === 'object' ? conn.caspar : {}

	h.append(
		Object.assign(document.createElement('p'), {
			className: 'device-view__note',
			textContent:
				'Virtual webcam for Zoom/OBS: Caspar channel → JPEG buffer → v4l2loopback. Audio via ALSA loopback capture device. Cable a destination to this port and Apply to set the source channel.',
		}),
	)

	const wrap = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })
	const labelIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: 'label',
		value: String(saved.label || conn?.label || 'Virtual cam'),
	})
	/* todos28.07.26 (owner): "there shouldnt even be an input box in the inspector of the virtual
	 * camera output. it should only accept connections to channels."
	 *
	 * The channel is DERIVED from the cable now (WO-377/378 resolve it from the graph edge), so an
	 * editable box could only ever disagree with the cabling — and when it did, the operator had no
	 * way to tell which one the bridge was actually using. It is a read-out, and the save patch no
	 * longer sends `channel` at all: the graph is the single source of truth. */
	const chOut = Object.assign(document.createElement('div'), { className: 'device-view__note' })
	const paintChannel = () => {
		const ch = live?.channel ?? saved.channel ?? caspar.channel ?? null
		chOut.textContent = ch ? `Source: channel ${ch} (from the cable)` : 'Source: not cabled — connect it in Device View'
		chOut.title = 'Cable a destination or host channel to this output in Device View to choose the source'
	}
	const devIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: '/dev/video10',
		value: String(saved.device || conn?.externalRef || '/dev/video10'),
	})
	const fpsIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '1',
		max: '60',
		step: '1',
		value: String(saved.fps ?? caspar.fps ?? 50),
	})
	attachMathInput(fpsIn, { decimals: 0 })
	const resIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: '1920x1080',
		value: `${saved.width ?? caspar.width ?? 1920}x${saved.height ?? caspar.height ?? 1080}`,
	})
	const audioCb = Object.assign(document.createElement('input'), { type: 'checkbox' })
	audioCb.checked = saved.audioEnabled !== false
	const audioLbl = Object.assign(document.createElement('label'), { className: 'device-view__note' })
	audioLbl.append(audioCb, document.createTextNode(' Include audio (ALSA loopback virtual mic)'))

	/* WO-376 (owner): "maybe a tick in the virtual camera output inspector to send to shaders as
	 * camera". Opt-in — a shader's `camera` channel stays black until this is on, so nothing
	 * silently opens a capture device. What the shader sees is whatever is CABLED to this output
	 * in Device View (WO-377), not necessarily PGM. */
	const shaderCamCb = Object.assign(document.createElement('input'), { type: 'checkbox' })
	shaderCamCb.checked = saved.shaderCamera === true
	const shaderCamLbl = Object.assign(document.createElement('label'), { className: 'device-view__note' })
	shaderCamLbl.title = "Shader FX channels set to 'camera' sample this output live"
	shaderCamLbl.append(shaderCamCb, document.createTextNode(' Send to shaders as camera'))

	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save settings' })
	const startBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Start virtual cam' })
	const stopBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Stop virtual cam' })
	const removeBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		textContent: 'Remove output',
		title: 'Hide virtual camera from Device View and clear saved output settings',
	})
	const statusPre = Object.assign(document.createElement('pre'), {
		className: 'device-view__status',
		style: 'white-space:pre-wrap;max-height:160px;overflow:auto;width:100%;margin-top:6px',
	})

	let live = getVirtualCameraStatus()
	const paint = () => {
		paintChannel()
		statusPre.textContent = renderStatusBlock(live)
		startBtn.disabled = !!live?.running
		stopBtn.disabled = !live?.running
	}
	paint()
	const unsub = subscribeVirtualCameraStatus((st) => {
		live = st
		paint()
	})
	void refreshVirtualCameraStatus().then((st) => {
		if (st) {
			live = st
			paint()
		}
	})

	function parsePatch() {
		const res = String(resIn.value || '1920x1080').split('x')
		const width = Math.max(320, parseInt(res[0], 10) || 1920)
		const height = Math.max(240, parseInt(res[1], 10) || 1080)
		return {
			label: String(labelIn.value || conn?.label || 'Virtual cam').trim(),
			device: String(devIn.value || '/dev/video10').trim(),
			fps: Math.max(1, parseInt(String(fpsIn.value || '50'), 10) || 50),
			width,
			height,
			audioEnabled: !!audioCb.checked,
			shaderCamera: !!shaderCamCb.checked,
			showInDeviceView: true,
		}
	}

	saveBtn.onclick = async () => {
		try {
			setStatus(statusEl, 'Saving virtual camera settings…')
			await saveVirtualCameraConfig(parsePatch(), { persist: true })
			setStatus(statusEl, 'Virtual camera settings saved.')
			if (typeof load === 'function') await load()
		} catch (e) {
			setStatus(statusEl, `Save failed: ${e?.message || e}`)
		}
	}
	startBtn.onclick = async () => {
		try {
			setStatus(statusEl, 'Starting virtual camera…')
			const payload = await startVirtualCamera(parsePatch(), { persist: true })
			if (!payload?.running) {
				setStatus(statusEl, payload?.error || payload?.reason || 'Start failed — check server logs')
			} else {
				setStatus(statusEl, 'Virtual camera running.')
			}
			if (typeof load === 'function') await load()
		} catch (e) {
			setStatus(statusEl, `Start failed: ${e?.message || e}`)
		}
	}
	stopBtn.onclick = async () => {
		try {
			setStatus(statusEl, 'Stopping virtual camera…')
			await stopVirtualCamera({ persist: true })
			setStatus(statusEl, 'Virtual camera stopped.')
			if (typeof load === 'function') await load()
		} catch (e) {
			setStatus(statusEl, `Stop failed: ${e?.message || e}`)
		}
	}
	if (typeof onRemoveVirtualCamOutput === 'function') {
		removeBtn.onclick = async () => {
			if (!confirm('Remove virtual camera output from Device View?')) return
			try {
				setStatus(statusEl, 'Removing virtual camera output…')
				await onRemoveVirtualCamOutput(conn?.id || 'vcam_1')
			} catch (e) {
				setStatus(statusEl, `Remove failed: ${e?.message || e}`)
			}
		}
	} else {
		removeBtn.disabled = true
	}

	wrap.append(
		labelIn,
		chOut,
		devIn,
		fpsIn,
		resIn,
		audioLbl,
		shaderCamLbl,
		saveBtn,
		startBtn,
		stopBtn,
		removeBtn,
		statusPre,
	)
	h.append(wrap)

	return () => unsub()
}
