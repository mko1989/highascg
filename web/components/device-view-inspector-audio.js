/**
 * Audio Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { api } from '../lib/api-client.js'
import { setStatus } from './device-view-ui-utils.js'

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
				const desc = d?.description ? ` — ${d.description}` : ''
				opt.textContent = `${d?.name || '?'}${desc}`
				const currentVal = String(existing?.deviceName || '')
				const idStr = d?.id !== undefined && d?.id !== null ? String(d.id) : ''
				if (currentVal === idStr || currentVal === String(d?.name || '')) opt.selected = true
				deviceSel.appendChild(opt)
			}
		}
	}

	typeSel.addEventListener('change', () => {
		refreshDevices()
		if (typeSel.value === 'system-audio') {
			layoutSel.value = 'stereo'
			layoutSel.disabled = true
		} else {
			layoutSel.disabled = false
		}
	})
	
	const layoutSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	layoutSel.innerHTML = '<option value="stereo">stereo</option><option value="mono">mono</option><option value="4ch">4-Channel</option><option value="8ch">8-Channel</option><option value="16ch">16-Channel</option>'
	layoutSel.value = String(existing?.channelLayout || 'stereo')
	if (typeSel.value === 'system-audio') layoutSel.disabled = true

	refreshDevices()

	// If the snapshot had no devices, retry enumeration (fresh cache / fixes PATH on server).
	const hasPa = Array.isArray(lastPayload?.live?.audio?.portaudio) && lastPayload.live.audio.portaudio.length > 0
	const hasGeneric = Array.isArray(lastPayload?.live?.audio?.devices) && lastPayload.live.audio.devices.length > 0
	if (!hasPa || !hasGeneric) {
		void (async () => {
			try {
				// Refresh PortAudio
				await api.get(`${api.getApiBase()}/api/audio/portaudio-devices?refresh=1&outputsOnly=false`)
				// Refresh ALSA/Generic
				await api.get(`${api.getApiBase()}/api/audio/devices?refresh=1`)
				// Reload is usually needed to update lastPayload, but for now we'll just hope the next refresh shows up
				// or tell the user to refresh.
				setStatus(statusEl, 'Audio device list refreshed. Re-open inspector to see full list.', true)
			} catch {
				/* ignore */
			}
		})()
	}

	// Allow manual entry too
	const manualDevIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'or type device name manually', value: deviceSel.value ? '' : String(existing?.deviceName || '') })
	deviceSel.addEventListener('change', () => { manualDevIn.value = '' })

	// Extended PortAudio settings
	const hostApiSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	hostApiSel.innerHTML = '<option value="auto">Auto Host API</option><option value="ASIO">ASIO</option><option value="ALSA">ALSA</option><option value="CoreAudio">CoreAudio</option><option value="WASAPI">WASAPI</option>'
	hostApiSel.value = String(existing?.hostApi || 'auto')

	const bufferIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', placeholder: 'Buffer frames (e.g. 128)', value: String(existing?.bufferFrames ?? 128) })
	const latencyIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', placeholder: 'Latency ms (e.g. 40)', value: String(existing?.latencyMs ?? 40) })
	const fifoIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', placeholder: 'FIFO ms (e.g. 50)', value: String(existing?.fifoMs ?? 50) })

	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save audio settings' })
	saveBtn.onclick = async () => {
		const cur = Array.isArray(currentSettings?.audioOutputs) ? currentSettings.audioOutputs : []
		const idx = cur.findIndex((x) => String(x?.id || '') === String(conn.id || ''))
		if (idx < 0) { setStatus(statusEl, 'Audio output not found', false); return }
		const label = String(nameIn.value || conn?.label || conn.id).trim() || String(conn?.label || conn.id)
		const deviceName = String(manualDevIn.value || deviceSel.value || '').trim()
		const channelLayout = String(layoutSel.value || 'stereo')
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
			enabled: true
		}
		await Actions.saveSettingsPatch({ audioOutputs: next })
		setCasparRestartDirty(true)
		setStatus(statusEl, `Audio output "${label}" saved`, true)
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

	const bufferLab = Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'Buffer frames', style: 'font-size:10px;opacity:.7' })
	const latencyLab = Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'Latency ms', style: 'font-size:10px;opacity:.7' })
	const fifoLab = Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'FIFO ms', style: 'font-size:10px;opacity:.7' })

	wrapCtl.append(
		nameIn,
		typeSel,
		deviceSel,
		manualDevIn,
		layoutSel,
		hostApiSel,
		bufferLab,
		bufferIn,
		latencyLab,
		latencyIn,
		fifoLab,
		fifoIn,
		saveBtn,
		removeBtn
	)
	h.append(wrapCtl)
	h.append(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'Select a consumer type (PortAudio or System Audio) and a corresponding hardware device.' }))
}
