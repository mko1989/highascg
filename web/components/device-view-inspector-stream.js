/**
 * Stream Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'

export function renderStreamOutControls(h, conn, { currentSettings, streamingStatus, statusEl, load, setCasparRestartDirty, onRemoveStreamOutput }) {
	const wrapCtl = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })
	const streamType = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	streamType.innerHTML = '<option value="ndi">NDI</option><option value="rtmp">RTMP</option><option value="srt">SRT</option><option value="udp">UDP</option>'
	streamType.value = String(conn?.caspar?.type || 'rtmp').toLowerCase()
	const nameIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'name / label', value: String(conn?.caspar?.name || conn?.label || '') })
	const urlIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'rtmp://server/app or srt://host:port', value: String(conn?.caspar?.rtmpServerUrl || conn?.caspar?.srtUrl || '') })
	const keyIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'stream key', value: String(conn?.caspar?.streamKey || '') })
	const qSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	qSel.innerHTML = '<option value="low">low</option><option value="medium">medium</option><option value="high">high</option>'
	qSel.value = String(conn?.caspar?.quality || 'medium')
	const vCodecSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	vCodecSel.innerHTML = '<option value="h264">h264</option><option value="hevc">hevc</option>'
	vCodecSel.value = String(conn?.caspar?.videoCodec || 'h264').toLowerCase()
	const vBitrateIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '200',
		step: '100',
		placeholder: 'video kbps',
		value: String(conn?.caspar?.videoBitrateKbps ?? 4500),
	})
	const presetSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	presetSel.innerHTML = '<option value="ultrafast">ultrafast</option><option value="veryfast">veryfast</option><option value="fast">fast</option><option value="medium">medium</option><option value="slow">slow</option>'
	presetSel.value = String(conn?.caspar?.encoderPreset || 'veryfast').toLowerCase()
	const aCodecSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	aCodecSel.innerHTML = '<option value="aac">aac</option><option value="copy">copy</option><option value="none">none</option>'
	aCodecSel.value = String(conn?.caspar?.audioCodec || 'aac').toLowerCase()
	const aBitrateIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '32',
		step: '32',
		placeholder: 'audio kbps',
		value: String(conn?.caspar?.audioBitrateKbps ?? 128),
	})
	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save stream settings' })
	const startBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Start stream' })
	const stopBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Stop stream' })
	const logBox = Object.assign(document.createElement('pre'), {
		className: 'device-view__status',
		style: 'white-space:pre-wrap;max-height:180px;overflow:auto;width:100%;margin-top:6px',
	})
	const renderStreamLogs = () => {
		const list = Array.isArray(streamingStatus?.rtmp?.logs) ? streamingStatus.rtmp.logs : []
		if (!list.length) {
			logBox.textContent = 'No stream logs yet.'
			return
		}
		const lines = list
			.slice(-20)
			.map((x) => {
				const ts = String(x?.ts || '').replace('T', ' ').replace('Z', '')
				const lvl = String(x?.level || 'info').toUpperCase()
				const msg = String(x?.message || '')
				const extra = x?.extra && typeof x.extra === 'object' ? ` ${JSON.stringify(x.extra)}` : ''
				return `[${ts}] [${lvl}] ${msg}${extra}`
			})
		logBox.textContent = lines.join('\n')
	}
	const updateTypeVisibility = () => {
		const t = String(streamType.value || 'rtmp')
		urlIn.style.display = t === 'ndi' ? 'none' : ''
		keyIn.style.display = t === 'rtmp' ? '' : 'none'
	}
	updateTypeVisibility()
	streamType.addEventListener('change', updateTypeVisibility)
	saveBtn.onclick = async () => {
		const cur = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : []
		const idx = cur.findIndex((x) => String(x?.id || '') === String(conn.id || ''))
		if (idx < 0) throw new Error('Stream output not found')
		const t = String(streamType.value || 'rtmp').toLowerCase()
		const name = String(nameIn.value || conn?.label || conn.id).trim() || String(conn?.label || conn.id)
		const next = [...cur]
		next[idx] = {
			...next[idx],
			id: String(conn.id),
			type: t,
			name,
			label: t === 'ndi' ? name : String(next[idx]?.label || name),
			quality: String(qSel.value || 'medium'),
			rtmpServerUrl: t === 'rtmp' ? String(urlIn.value || '').trim() : String(next[idx]?.rtmpServerUrl || ''),
			streamKey: t === 'rtmp' ? String(keyIn.value || '').trim() : '',
			srtUrl: t === 'srt' ? String(urlIn.value || '').trim() : '',
			videoCodec: String(vCodecSel.value || 'h264').toLowerCase(),
			videoBitrateKbps: Math.max(200, parseInt(String(vBitrateIn.value || '4500'), 10) || 4500),
			encoderPreset: String(presetSel.value || 'veryfast').toLowerCase(),
			audioCodec: String(aCodecSel.value || 'aac').toLowerCase(),
			audioBitrateKbps: Math.max(32, parseInt(String(aBitrateIn.value || '128'), 10) || 128),
		}
		await Actions.saveSettingsPatch({ streamOutputs: next })
		setCasparRestartDirty(true)
		await load()
	}
	startBtn.onclick = async () => {
		try {
			const t = String(streamType.value || 'rtmp').toLowerCase()
			if (t !== 'rtmp') {
				setStatus(statusEl, `Start for ${t.toUpperCase()} is not wired yet. Save settings and apply Caspar config.`, false)
				return
			}
			const cur = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : []
			const saved = cur.find((x) => String(x?.id || '') === String(conn.id || '')) || {}
			const rtmpServerUrl = String(urlIn.value || saved?.rtmpServerUrl || conn?.caspar?.rtmpServerUrl || '').trim()
			const streamKey = String(keyIn.value || saved?.streamKey || conn?.caspar?.streamKey || '').trim()
			const quality = String(qSel.value || saved?.quality || conn?.caspar?.quality || 'medium')
			const videoCodec = String(vCodecSel.value || saved?.videoCodec || conn?.caspar?.videoCodec || 'h264').toLowerCase()
			const videoBitrateKbps = Math.max(200, parseInt(String(vBitrateIn.value || saved?.videoBitrateKbps || conn?.caspar?.videoBitrateKbps || '4500'), 10) || 4500)
			const encoderPreset = String(presetSel.value || saved?.encoderPreset || conn?.caspar?.encoderPreset || 'veryfast').toLowerCase()
			const audioCodec = String(aCodecSel.value || saved?.audioCodec || conn?.caspar?.audioCodec || 'aac').toLowerCase()
			const audioBitrateKbps = Math.max(32, parseInt(String(aBitrateIn.value || saved?.audioBitrateKbps || conn?.caspar?.audioBitrateKbps || '128'), 10) || 128)
			if (!rtmpServerUrl) {
				setStatus(statusEl, 'RTMP server URL is empty. Fill it in stream inspector first.', false)
				return
			}
			const sc = currentSettings?.streamingChannel && typeof currentSettings.streamingChannel === 'object'
				? currentSettings.streamingChannel
				: {}
			if (!(sc.enabled === true || sc.enabled === 'true')) {
				await Actions.saveSettingsPatch({ streamingChannel: { ...sc, enabled: true } })
			}
			await Actions.startStreamingChannelRtmp({
				outputId: String(conn.id),
				rtmpServerUrl,
				streamKey,
				quality,
				videoCodec,
				videoBitrateKbps,
				encoderPreset,
				audioCodec,
				audioBitrateKbps,
			})
			setStatus(statusEl, 'Streaming started', true)
			await load()
			renderStreamLogs()
		} catch (e) { setStatus(statusEl, e.message, false) }
	}
	stopBtn.onclick = async () => {
		try {
			await Actions.stopStreamingChannelRtmp()
			setStatus(statusEl, 'Streaming stopped', true)
			await load()
			renderStreamLogs()
		} catch (e) { setStatus(statusEl, e.message, false) }
	}
	const removeBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		type: 'button',
		textContent: 'Remove stream output',
		title: 'Remove this output from settings and clear its cables',
	})
	removeBtn.onclick = async () => {
		if (!onRemoveStreamOutput) return
		if (!confirm(`Remove stream output ${conn.id}?`)) return
		try {
			await onRemoveStreamOutput(String(conn.id || ''))
		} catch (e) {
			setStatus(statusEl, e?.message || String(e), false)
		}
	}
	wrapCtl.append(streamType, nameIn, urlIn, keyIn, qSel, vCodecSel, vBitrateIn, presetSel, aCodecSel, aBitrateIn, saveBtn, startBtn, stopBtn, removeBtn)
	h.append(wrapCtl)
	h.append(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'Stream log' }))
	h.append(logBox)
	renderStreamLogs()
}
