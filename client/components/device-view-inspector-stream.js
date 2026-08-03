/**
 * Stream Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import {
	applyStreamingChannelActionResponse,
	getStreamingChannelStatus,
	refreshStreamingChannelStatus,
	subscribeStreamingChannelStatus,
} from '../lib/streaming-channel-state.js'
import { createNdiAttributionElement } from '../lib/ndi-attribution.js'
import { attachMathInput } from '../lib/math-input.js'

function savedStreamOutput(currentSettings, conn) {
	const rows = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : []
	return rows.find((x) => String(x?.id || '') === String(conn?.id || '')) || {}
}

export function renderStreamOutControls(h, conn, { currentSettings, streamingStatus, statusEl, load, setCasparRestartDirty, onRemoveStreamOutput }) {
	const saved = savedStreamOutput(currentSettings, conn)
	const caspar = conn?.caspar && typeof conn.caspar === 'object' ? conn.caspar : {}
	// WO-261: stream credentials live in the active project. The client never receives the raw key —
	// only a masked url + hasStreamKey. Prefill the URL, leave the key blank ("leave blank to keep").
	const projCred = (currentSettings?.streamCredentials && currentSettings.streamCredentials[String(conn?.id || '')]) || {}
	const savedHasKey = projCred.hasStreamKey === true || saved.hasStreamKey === true

	h.append(
		Object.assign(document.createElement('p'), {
			className: 'device-view__note',
			textContent:
				'Saved settings apply on next Start stream. Cable from a destination to set the source channel.',
		}),
	)

	const wrapCtl = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })
	const streamType = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	streamType.innerHTML = '<option value="ndi">NDI</option><option value="rtmp">RTMP</option><option value="srt">SRT</option><option value="udp">UDP</option>'
	streamType.value = String(saved.type || caspar.type || 'rtmp').toLowerCase()
	const nameIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'name / label', value: String(saved.name || caspar.name || conn?.label || '') })
	const urlIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'rtmp://server/app or srt://host:port', value: String(projCred.rtmpServerUrl || saved.rtmpServerUrl || saved.srtUrl || caspar.rtmpServerUrl || caspar.srtUrl || '') })
	const keyIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: savedHasKey ? 'saved in project — leave blank to keep' : 'stream key (saved in project)', value: '' })
	const clearKeyChk = Object.assign(document.createElement('input'), { type: 'checkbox', title: 'Clear the saved stream key' })
	const clearKeyLabel = Object.assign(document.createElement('label'), { className: 'device-view__note', style: 'display:inline-flex;align-items:center;gap:4px' })
	clearKeyLabel.append(clearKeyChk, document.createTextNode('clear saved key'))
	const qSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	qSel.innerHTML = '<option value="low">low</option><option value="medium">medium</option><option value="high">high</option>'
	qSel.value = String(saved.quality || caspar.quality || 'medium')
	const vCodecSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	vCodecSel.innerHTML = '<option value="h264">h264</option><option value="hevc">hevc</option>'
	vCodecSel.value = String(saved.videoCodec || caspar.videoCodec || 'h264').toLowerCase()
	const vBitrateIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '200',
		step: '100',
		placeholder: 'video kbps',
		value: String(saved.videoBitrateKbps ?? caspar.videoBitrateKbps ?? 4500),
	})
	attachMathInput(vBitrateIn, { decimals: 0 })
	const presetSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	presetSel.innerHTML = '<option value="ultrafast">ultrafast</option><option value="veryfast">veryfast</option><option value="fast">fast</option><option value="medium">medium</option><option value="slow">slow</option>'
	presetSel.value = String(saved.encoderPreset || caspar.encoderPreset || 'veryfast').toLowerCase()
	const aCodecSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	aCodecSel.innerHTML = '<option value="aac">aac</option><option value="copy">copy</option><option value="none">none</option>'
	aCodecSel.value = String(saved.audioCodec || caspar.audioCodec || 'aac').toLowerCase()
	const aBitrateIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '32',
		step: '32',
		placeholder: 'audio kbps',
		value: String(saved.audioBitrateKbps ?? caspar.audioBitrateKbps ?? 128),
	})
	attachMathInput(aBitrateIn, { decimals: 0 })
	// SRT options (owner: "srt has its own options in casparcg"). Latency is entered in MILLISECONDS;
	// the server converts to ffmpeg's microseconds in exactly one place (buildSrtOutputUrl). No
	// passphrase field on purpose — that is a secret and belongs in the WO-261 project credentials,
	// not plaintext settings; say so before adding it.
	const srtLatencyIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '20',
		max: '8000',
		step: '10',
		placeholder: 'SRT latency ms',
		title: 'SRT latency (ms) — receive buffer / retransmission window',
		value: String(saved.srtLatencyMs ?? caspar.srtLatencyMs ?? 120),
	})
	const srtStreamIdIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: 'SRT streamid (optional)',
		title: 'SRT streamid — passed to the receiver for routing/auth',
		value: String(saved.srtStreamId || caspar.srtStreamId || ''),
	})
	const srtModeSel = Object.assign(document.createElement('select'), {
		className: 'device-view__destinations-type',
		title: 'SRT mode: caller connects out (normal push), listener waits for the receiver to connect in',
	})
	srtModeSel.innerHTML = '<option value="caller">srt: caller</option><option value="listener">srt: listener</option>'
	srtModeSel.value = String(saved.srtMode || caspar.srtMode || 'caller').toLowerCase() === 'listener' ? 'listener' : 'caller'
	// WO-307: SRT passphrase, same project-credentials treatment as the RTMP stream key (WO-261) —
	// never received or held in the raw. `hasSrtPassphrase` flows through settings-get's
	// streamCredentials (buildStreamCredentialStatus); `saved.srtPassphrase`/`caspar.srtPassphrase`
	// are read here only for prefill in case an OLDER build ever wrote one to config — the server
	// never emits a raw value there, so this is normally always empty.
	const savedHasPassphrase = projCred.hasSrtPassphrase === true || saved.hasSrtPassphrase === true
	const srtPassphraseIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'password',
		placeholder: savedHasPassphrase ? 'saved in project — leave blank to keep' : 'SRT passphrase (10-79 chars, saved in project)',
		title: 'SRT passphrase — encrypts the stream. Stored in the project only, same as the RTMP key.',
		value: '',
	})
	const clearPassphraseChk = Object.assign(document.createElement('input'), { type: 'checkbox', title: 'Clear the saved SRT passphrase' })
	const clearPassphraseLabel = Object.assign(document.createElement('label'), {
		className: 'device-view__note',
		style: 'display:inline-flex;align-items:center;gap:4px',
	})
	clearPassphraseLabel.append(clearPassphraseChk, document.createTextNode('clear saved passphrase'))
	// NDI is not a stream you start (owner spec): it is emitted as an always-on <ndi> consumer in
	// the generated Caspar config, like an SDI out. Only the name is configurable.
	const ndiNote = Object.assign(document.createElement('p'), {
		className: 'device-view__note',
		textContent:
			'NDI output is always on — it is written into the Caspar config as an NDI consumer on the cabled ' +
			'destination’s channel (like an SDI out). Set the name, Save, then Apply Caspar config. No Start needed.',
	})
	// WO-249 source-pair pick, per stream output (was in the deleted settings-modal streaming
	// section). 'all' = follow the cabled source bus unchanged; a pair selects it via ffmpeg pan=.
	const pairSel = Object.assign(document.createElement('select'), {
		className: 'device-view__destinations-type',
		title: 'Source audio pair (8ch program bus)',
	})
	pairSel.innerHTML = '<option value="all">audio pair: all</option><option value="1+2">audio pair: 1+2</option><option value="3+4">audio pair: 3+4</option><option value="5+6">audio pair: 5+6</option><option value="7+8">audio pair: 7+8</option>'
	pairSel.value = String(saved.audioSourcePair || caspar.audioSourcePair || 'all')
	if (!pairSel.value) pairSel.value = 'all'
	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save stream settings' })
	const startBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Start stream' })
	const stopBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Stop stream' })
	const logBox = Object.assign(document.createElement('pre'), {
		className: 'device-view__status',
		style: 'white-space:pre-wrap;max-height:180px;overflow:auto;width:100%;margin-top:6px',
	})
	let liveStatus = streamingStatus || getStreamingChannelStatus()
	const renderStreamLogs = () => {
		const list = Array.isArray(liveStatus?.rtmp?.logs) ? liveStatus.rtmp.logs : []
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
	const ndiAttribution = createNdiAttributionElement('device-view__note ndi-attribution')
	ndiAttribution.style.display = String(streamType.value || 'rtmp') === 'ndi' ? '' : 'none'
	const updateTypeVisibility = () => {
		const t = String(streamType.value || 'rtmp')
		const isNdi = t === 'ndi'
		const isSrt = t === 'srt'
		urlIn.style.display = isNdi ? 'none' : ''
		urlIn.placeholder = isSrt ? 'srt://host:port' : t === 'udp' ? 'udp://host:port' : 'rtmp://server/app'
		keyIn.style.display = t === 'rtmp' ? '' : 'none'
		clearKeyLabel.style.display = t === 'rtmp' ? '' : 'none'
		ndiAttribution.style.display = isNdi ? '' : 'none'
		ndiNote.style.display = isNdi ? '' : 'none'
		// NDI has no encoder: Caspar's <ndi> consumer sends the raster as-is. Every ffmpeg field is
		// meaningless there — showing them was the owner's complaint ("should not have the normal
		// settings rtmp stream has").
		for (const el of [qSel, vCodecSel, vBitrateIn, presetSel, aCodecSel, aBitrateIn, pairSel]) {
			el.style.display = isNdi ? 'none' : ''
		}
		for (const el of [srtLatencyIn, srtStreamIdIn, srtModeSel, srtPassphraseIn, clearPassphraseLabel]) {
			el.style.display = isSrt ? '' : 'none'
		}
		// No Start/Stop for NDI — the consumer lives in the config and is on while Caspar runs.
		startBtn.style.display = isNdi ? 'none' : ''
		stopBtn.style.display = isNdi ? 'none' : ''
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
		// WO-261: non-credential fields still round-trip through config. rtmpServerUrl/streamKey are
		// project-scoped credentials — the server ignores them here and they are written via the project
		// credentials API below.
		next[idx] = {
			...next[idx],
			id: String(conn.id),
			type: t,
			name,
			label: t === 'ndi' ? name : String(next[idx]?.label || name),
			quality: String(qSel.value || 'medium'),
			srtUrl: t === 'srt' ? String(urlIn.value || '').trim() : '',
			videoCodec: String(vCodecSel.value || 'h264').toLowerCase(),
			videoBitrateKbps: Math.max(200, parseInt(String(vBitrateIn.value || '4500'), 10) || 4500),
			encoderPreset: String(presetSel.value || 'veryfast').toLowerCase(),
			audioCodec: String(aCodecSel.value || 'aac').toLowerCase(),
			audioBitrateKbps: Math.max(32, parseInt(String(aBitrateIn.value || '128'), 10) || 128),
			audioSourcePair: String(pairSel.value || 'all'),
			srtLatencyMs: Math.min(8000, Math.max(20, parseInt(String(srtLatencyIn.value || '120'), 10) || 120)),
			srtStreamId: String(srtStreamIdIn.value || '').trim(),
			srtMode: String(srtModeSel.value || 'caller'),
		}
		await Actions.saveSettingsPatch({ streamOutputs: next })
		if (t === 'ndi') {
			// The NDI consumer is config-time: it only exists after a regenerate + Apply, so saving an
			// NDI output must light the Apply button the same way a cabling change does.
			setCasparRestartDirty(true)
			setStatus(statusEl, 'NDI output saved — Apply Caspar config to put it on air.', true)
		}
		if (t === 'rtmp') {
			// Credentials into the ACTIVE project (and only there). Empty key keeps the stored one.
			await Actions.saveProjectStreamCredentials({
				outputId: String(conn.id),
				rtmpServerUrl: String(urlIn.value || '').trim(),
				streamKey: String(keyIn.value || '').trim(),
				clearKey: clearKeyChk.checked === true,
			})
			clearKeyChk.checked = false
		}
		if (t === 'srt') {
			// WO-307: the passphrase is a secret — same project-only path as the RTMP key above.
			// srtUrl/latency/streamid/mode are NOT secret and already went through the settings
			// patch a few lines up.
			await Actions.saveProjectStreamCredentials({
				outputId: String(conn.id),
				srtPassphrase: String(srtPassphraseIn.value || '').trim(),
				clearPassphrase: clearPassphraseChk.checked === true,
			})
			clearPassphraseChk.checked = false
			srtPassphraseIn.value = ''
		}
		await load()
	}
	startBtn.onclick = async () => {
		try {
			const t = String(streamType.value || 'rtmp').toLowerCase()
			if (t === 'ndi') {
				setStatus(statusEl, 'NDI is always on via the Caspar config — Apply Caspar config instead of Start.', false)
				return
			}
			if (t !== 'rtmp' && t !== 'srt') {
				setStatus(statusEl, `Start for ${t.toUpperCase()} is not wired yet. Save settings first.`, false)
				return
			}
			const cur = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : []
			const saved = cur.find((x) => String(x?.id || '') === String(conn.id || '')) || {}
			// WO-261: the stream key is resolved SERVER-side from the active project — never sent from the
			// client. Only a freshly typed (unsaved) URL is forwarded so the box still works before Save.
			const rtmpServerUrl = String(urlIn.value || projCred.rtmpServerUrl || saved?.rtmpServerUrl || '').trim()
			const quality = String(qSel.value || saved?.quality || conn?.caspar?.quality || 'medium')
			const videoCodec = String(vCodecSel.value || saved?.videoCodec || conn?.caspar?.videoCodec || 'h264').toLowerCase()
			const videoBitrateKbps = Math.max(200, parseInt(String(vBitrateIn.value || saved?.videoBitrateKbps || conn?.caspar?.videoBitrateKbps || '4500'), 10) || 4500)
			const encoderPreset = String(presetSel.value || saved?.encoderPreset || conn?.caspar?.encoderPreset || 'veryfast').toLowerCase()
			const audioCodec = String(aCodecSel.value || saved?.audioCodec || conn?.caspar?.audioCodec || 'aac').toLowerCase()
			const audioBitrateKbps = Math.max(32, parseInt(String(aBitrateIn.value || saved?.audioBitrateKbps || conn?.caspar?.audioBitrateKbps || '128'), 10) || 128)
			const audioSourcePair = String(pairSel.value || saved?.audioSourcePair || conn?.caspar?.audioSourcePair || 'all')
			const srtUrl = t === 'srt' ? String(urlIn.value || saved?.srtUrl || conn?.caspar?.srtUrl || '').trim() : ''
			if (t === 'srt' && !srtUrl) {
				setStatus(statusEl, 'SRT URL is empty (srt://host:port). Fill it in the stream inspector first.', false)
				return
			}
			if (t === 'rtmp' && !rtmpServerUrl) {
				setStatus(statusEl, 'RTMP server URL is empty. Fill it in stream inspector first.', false)
				return
			}
			const sc = currentSettings?.streamingChannel && typeof currentSettings.streamingChannel === 'object'
				? currentSettings.streamingChannel
				: {}
			const wasStreamingChEnabled = sc.enabled === true || sc.enabled === 'true'
			if (!wasStreamingChEnabled) {
				await Actions.saveSettingsPatch({ streamingChannel: { ...sc, enabled: true } })
				setCasparRestartDirty(true)
			}
			const res = await Actions.startStreamingChannelRtmp({
				outputId: String(conn.id),
				type: t,
				rtmpServerUrl,
				...(t === 'srt'
					? {
						srtUrl,
						srtLatencyMs: Math.min(8000, Math.max(20, parseInt(String(srtLatencyIn.value || '120'), 10) || 120)),
						srtStreamId: String(srtStreamIdIn.value || '').trim(),
						srtMode: String(srtModeSel.value || 'caller'),
					}
					: {}),
				quality,
				videoCodec,
				videoBitrateKbps,
				encoderPreset,
				audioCodec,
				audioBitrateKbps,
				audioSourcePair,
			})
			applyStreamingChannelActionResponse(res, { action: 'start_stream', outputId: String(conn.id) })
			setStatus(statusEl, 'Streaming started', true)
			document.dispatchEvent(new CustomEvent('highascg-streaming-changed'))
			await refreshStreamingChannelStatus()
			liveStatus = getStreamingChannelStatus()
			renderStreamLogs()
			await load()
		} catch (e) { setStatus(statusEl, e.message, false) }
	}
	stopBtn.onclick = async () => {
		try {
			const res = await Actions.stopStreamingChannelRtmp()
			applyStreamingChannelActionResponse(res, { action: 'stop_stream' })
			setStatus(statusEl, 'Streaming stopped', true)
			document.dispatchEvent(new CustomEvent('highascg-streaming-changed'))
			await refreshStreamingChannelStatus()
			liveStatus = getStreamingChannelStatus()
			renderStreamLogs()
			await load()
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
	wrapCtl.append(streamType, nameIn, urlIn, keyIn, clearKeyLabel, srtLatencyIn, srtStreamIdIn, srtModeSel, srtPassphraseIn, clearPassphraseLabel, qSel, vCodecSel, vBitrateIn, presetSel, aCodecSel, aBitrateIn, pairSel, saveBtn, startBtn, stopBtn, removeBtn)
	h.append(wrapCtl)
	h.append(ndiNote)
	h.append(ndiAttribution)
	h.append(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'Stream log' }))
	h.append(logBox)
	renderStreamLogs()
	if (logBox._streamStatusUnsub) {
		try {
			logBox._streamStatusUnsub()
		} catch {
			/* ignore */
		}
	}
	logBox._streamStatusUnsub = subscribeStreamingChannelStatus((st) => {
		if (!st) return
		liveStatus = st
		renderStreamLogs()
	})
}
