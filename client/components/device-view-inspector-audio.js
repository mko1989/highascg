/**
 * Audio Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { api } from '../lib/api-client.js'
import { setStatus } from './device-view-ui-utils.js'
import {
	PORTAUDIO_LAYOUT_OPTIONS,
	portAudioLayoutOptionsForDevice,
} from '../lib/audio-channel-layouts.js'
import { attachMathInput } from '../lib/math-input.js'

function selectedDeviceMaxChannels(deviceSel, lastPayload) {
	const val = String(deviceSel?.value || '').trim()
	if (!val) return 0
	const paDevices = Array.isArray(lastPayload?.live?.audio?.portaudio) ? lastPayload.live.audio.portaudio : []
	for (const d of paDevices) {
		const idStr = d?.id !== undefined && d?.id !== null ? String(d.id) : ''
		if (val === idStr || val === String(d?.name || '')) {
			return Math.max(0, Number(d?.maxOutputChannels) || 0)
		}
	}
	return 0
}

function fillLayoutSelect(layoutSel, options, currentValue) {
	const prev = String(currentValue || layoutSel.value || 'stereo')
	layoutSel.innerHTML = ''
	for (const o of options) {
		const opt = document.createElement('option')
		opt.value = o.value
		opt.textContent = o.label
		layoutSel.appendChild(opt)
	}
	const allowed = new Set(options.map((o) => o.value))
	layoutSel.value = allowed.has(prev) ? prev : (options[options.length - 1]?.value || 'stereo')
}

export function renderAudioOutControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty, onRemoveAudioOutput }) {
	const wrapCtl = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })
	const audioOutputsList = Array.isArray(currentSettings?.audioOutputs) ? currentSettings.audioOutputs : []
	const existing = audioOutputsList.find((x) => String(x?.id || '') === String(conn.id || ''))

	const nameIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'Output label', value: String(existing?.label || conn?.label || '') })

	const typeSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	typeSel.innerHTML = '<option value="portaudio">PortAudio (multi-ch)</option><option value="system-audio">System Audio (stereo monitor)</option>'
	typeSel.value = String(existing?.type || 'portaudio')

	// Device picker from live enumeration
	const deviceSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	deviceSel.innerHTML = '<option value="">(select audio device)</option>'

	const layoutSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })

	const layoutHint = Object.assign(document.createElement('p'), {
		className: 'device-view__note small',
		style: 'margin:0;opacity:.75',
	})

	const refreshLayoutOptions = () => {
		if (typeSel.value === 'system-audio') {
			fillLayoutSelect(layoutSel, PORTAUDIO_LAYOUT_OPTIONS.filter((o) => o.value === 'stereo'), 'stereo')
			layoutSel.disabled = true
			layoutHint.textContent = 'System Audio is stereo-only (headphones / monitor).'
			return
		}
		layoutSel.disabled = false
		const maxCh = selectedDeviceMaxChannels(deviceSel, lastPayload)
		const options = portAudioLayoutOptionsForDevice(maxCh)
		fillLayoutSelect(layoutSel, options, existing?.channelLayout || layoutSel.value)
		layoutHint.textContent = maxCh > 0
			? `Device reports up to ${maxCh} output channel(s). PortAudio consumer uses the layout below.`
			: 'Select a device to see its max channel count, or pick up to 16ch manually.'
	}

	const refreshDevices = () => {
		const type = typeSel.value
		deviceSel.innerHTML = '<option value="">(select audio device)</option>'
		if (type === 'system-audio') {
			const genericDevices = Array.isArray(lastPayload?.live?.audio?.devices) ? lastPayload.live.audio.devices : []
			for (const d of genericDevices) {
				const opt = document.createElement('option')
				opt.value = String(d?.id || d?.name || '')
				opt.textContent = `${d?.name || '?'}`
				if (String(existing?.deviceName || '') === opt.value) opt.selected = true
				deviceSel.appendChild(opt)
			}
		} else {
			const paDevices = Array.isArray(lastPayload?.live?.audio?.portaudio) ? lastPayload.live.audio.portaudio : []
			for (const d of paDevices) {
				const opt = document.createElement('option')
				opt.value = String(d?.id ?? d?.name ?? '')
				const ch = Number(d?.maxOutputChannels) > 0 ? ` · ${d.maxOutputChannels}ch` : ''
				const desc = d?.description ? ` — ${d.description}` : ''
				opt.textContent = `${d?.name || '?'}${ch}${desc}`
				const currentVal = String(existing?.deviceName || '')
				const idStr = d?.id !== undefined && d?.id !== null ? String(d.id) : ''
				if (currentVal === idStr || currentVal === String(d?.name || '')) opt.selected = true
				deviceSel.appendChild(opt)
			}
		}
		refreshLayoutOptions()
	}

	typeSel.addEventListener('change', () => {
		refreshDevices()
	})
	deviceSel.addEventListener('change', () => {
		refreshLayoutOptions()
	})

	layoutSel.value = String(existing?.channelLayout || 'stereo')
	if (typeSel.value === 'system-audio') layoutSel.disabled = true

	refreshDevices()

	// If the snapshot had no devices, retry enumeration (fresh cache / fixes PATH on server).
	const hasPa = Array.isArray(lastPayload?.live?.audio?.portaudio) && lastPayload.live.audio.portaudio.length > 0
	const hasGeneric = Array.isArray(lastPayload?.live?.audio?.devices) && lastPayload.live.audio.devices.length > 0
	if (!hasPa || !hasGeneric) {
		void (async () => {
			try {
				await api.get(`${api.getApiBase()}/api/audio/portaudio-devices?refresh=1&outputsOnly=false`)
				await api.get(`${api.getApiBase()}/api/audio/devices?refresh=1`)
				setStatus(statusEl, 'Audio device list refreshed. Re-open inspector to see full list.', true)
			} catch {
				/* ignore */
			}
		})()
	}

	const manualDevIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'or type device name manually', value: deviceSel.value ? '' : String(existing?.deviceName || '') })
	deviceSel.addEventListener('change', () => { manualDevIn.value = '' })

	const hostApiSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	hostApiSel.innerHTML = '<option value="auto">Auto Host API</option><option value="ASIO">ASIO</option><option value="ALSA">ALSA</option><option value="CoreAudio">CoreAudio</option><option value="WASAPI">WASAPI</option>'
	hostApiSel.value = String(existing?.hostApi || 'auto')

	const bufferIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', min: '1', placeholder: 'Buffer frames (e.g. 128)', value: String(existing?.bufferFrames ?? 128) })
	attachMathInput(bufferIn, { decimals: 0 })
	const latencyIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', min: '1', placeholder: 'Latency ms (e.g. 40)', value: String(existing?.latencyMs ?? 40) })
	attachMathInput(latencyIn, { decimals: 0 })
	const fifoIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', min: '1', placeholder: 'FIFO ms (e.g. 50)', value: String(existing?.fifoMs ?? 50) })
	attachMathInput(fifoIn, { decimals: 0 })

	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save audio settings' })
	saveBtn.onclick = async () => {
		const cur = Array.isArray(currentSettings?.audioOutputs) ? currentSettings.audioOutputs : []
		const idx = cur.findIndex((x) => String(x?.id || '') === String(conn.id || ''))
		if (idx < 0) { setStatus(statusEl, 'Audio output not found', false); return }
		const label = String(nameIn.value || conn?.label || conn.id).trim() || String(conn?.label || conn.id)
		const deviceName = String(manualDevIn.value || deviceSel.value || '').trim()
		const channelLayout = typeSel.value === 'system-audio' ? 'stereo' : String(layoutSel.value || 'stereo')
		const next = [...cur]
		next[idx] = {
			...next[idx],
			id: String(conn.id),
			label,
			type: typeSel.value,
			deviceName,
			channelLayout,
			hostApi: hostApiSel.value,
			bufferFrames: parseInt(bufferIn.value, 10) || 128,
			latencyMs: parseInt(latencyIn.value, 10) || 40,
			fifoMs: parseInt(fifoIn.value, 10) || 50,
			enabled: true,
		}
		const patch = { audioOutputs: next }
		await Actions.saveSettingsPatch(patch)
		setCasparRestartDirty(true)
		setStatus(statusEl, `Audio output "${label}" saved (${channelLayout} PortAudio). Set program bus width on the cabled destination.`, true)
		await load()
	}

	const removeBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		type: 'button',
		textContent: 'Remove audio output',
		title: 'Remove this output from settings and clear its cables',
	})
	removeBtn.onclick = async () => {
		if (!onRemoveAudioOutput) return
		if (!confirm(`Remove audio output ${conn.id}?`)) return
		try {
			await onRemoveAudioOutput(String(conn.id || ''))
		} catch (e) {
			setStatus(statusEl, e?.message || String(e), false)
		}
	}

	const buildProfileNote = String(currentSettings?.casparServer?.caspar_build_profile || 'stock')
	if (buildProfileNote === 'stock') {
		const warn = Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: '⚠ PortAudio requires the "Custom Live" build profile. HighAsCG will attempt to auto-switch this for you when you Apply.' })
		warn.style.color = '#f59e0b'
		wrapCtl.appendChild(warn)
	}

	const layoutLab = Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'PortAudio output layout', style: 'font-size:10px;opacity:.7' })
	const busNote = Object.assign(document.createElement('p'), {
		className: 'device-view__note small',
		textContent: 'Caspar program bus width (mixer pairs) is set on each screen destination — select the destination and use Audio outputs.',
		style: 'margin:0;opacity:.75',
	})
	const bufferLab = Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'Buffer frames', style: 'font-size:10px;opacity:.7' })
	const latencyLab = Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'Latency ms', style: 'font-size:10px;opacity:.7' })
	const fifoLab = Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'FIFO ms', style: 'font-size:10px;opacity:.7' })

	wrapCtl.append(
		nameIn,
		typeSel,
		deviceSel,
		manualDevIn,
		busNote,
		layoutLab,
		layoutSel,
		layoutHint,
		hostApiSel,
		bufferLab,
		bufferIn,
		latencyLab,
		latencyIn,
		fifoLab,
		fifoIn,
		saveBtn,
		removeBtn,
	)
	h.append(wrapCtl)
	h.append(Object.assign(document.createElement('p'), {
		className: 'device-view__note',
		textContent: 'PortAudio supports up to 16 channels. Master layout controls mixer routing pairs (ch1+2 … ch15+16) and Caspar channel-layout on cabled PGM outputs.',
	}))
}
