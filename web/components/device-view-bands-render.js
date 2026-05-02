/**
 * Port Bands Rendering for Device View.
 */
import { CASPAR_HOST, decklinkInputState, stateClass, connectorById } from './device-view-helpers.js'
import { setStatus } from './device-view-ui-utils.js'
import * as Actions from './device-view-actions.js'
import { renderCasparBand } from './device-view-caspar-render.js'
import { renderMappingsBand } from './device-view-mappings-render.js'

/**
 * @param {'left' | 'right'} [dotSide] — input/sink ports: dot on the left; output/source: right (default)
 */
function addPortNodeDot(portEl, connectorId, onPortStartCable, key, data, dotSide = 'right') {
	if (!portEl || !connectorId) return
	const dot = document.createElement('span')
	dot.className = 'device-view__connector-dot' + (dotSide === 'left' ? ' device-view__connector-dot--left' : '')
	dot.title = 'Start or complete cable at this connector'
	dot.setAttribute('data-connector-id', connectorId)
	dot.addEventListener('click', (ev) => {
		ev.preventDefault()
		ev.stopPropagation()
		if (onPortStartCable) onPortStartCable(key, connectorId, data)
	})
	portEl.appendChild(dot)
	if (dotSide === 'left') portEl.classList.add('device-view__port--ph-sink')
	if (dotSide === 'right' && data?.phOut) portEl.classList.add('device-view__port--ph-source')
}

export function renderGpuBand(ctx) {
	const { live, lastPayload, resolveConnectorId, isConnectorVisible, selectedKey, cableSourceId, onPortClick, onPortStartCable } = ctx
	const gpuBand = document.createElement('div')
	gpuBand.className = 'device-view__band'
	gpuBand.innerHTML = '<h3>GPU / screen consumer outputs</h3><div class="device-view__ports" data-gpu-ports></div>'
	const gpuPorts = gpuBand.querySelector('[data-gpu-ports]')
	const displays = live.gpu?.displays || []
	
	if (displays.length === 0) {
		const virtual = (lastPayload?.suggested?.connectors || []).filter((c) => c?.kind === 'gpu_out')
		if (!virtual.length) {
			gpuPorts.appendChild(
				Object.assign(document.createElement('p'), { textContent: 'No display enumeration (xrandr/drm or headless).', className: 'device-view__note' })
			)
		}
		for (const c of virtual) {
			const b = document.createElement('button')
			b.type = 'button'
			b.className = 'device-view__port'
			const k = `gpu_virtual:${c.id}`
			b.dataset.portKey = k
			if (!isConnectorVisible(c.id)) continue
			b.setAttribute('data-connector-id', c.id)
			b.appendChild(Object.assign(document.createElement('span'), { textContent: c.label || c.id }))
			b.appendChild(Object.assign(document.createElement('small'), { textContent: c.externalRef || 'virtual output' }))
			b.addEventListener('click', () => onPortClick(k, c.id, { type: 'gpu_virtual', connector: c }))
			addPortNodeDot(b, c.id, onPortStartCable, k, { type: 'gpu_virtual', connector: c }, 'left')
			if (selectedKey === k) b.classList.add('device-view__port--selected')
			if (cableSourceId && c.id === cableSourceId) b.classList.add('device-view__port--cable-armed')
			gpuPorts.append(b)
		}
	}
	
	displays.forEach((d, idx) => {
		const b = document.createElement('button')
		b.type = 'button'
		b.className = 'device-view__port'
		const k = `gpu:${d.name}:${idx}`
		b.dataset.portKey = k
		const cid = String(resolveConnectorId('gpu', { index: idx }) || '').trim()
		if (!cid || !isConnectorVisible(cid)) return
		if (cid) b.setAttribute('data-connector-id', cid)
		b.appendChild(Object.assign(document.createElement('span'), { textContent: d.name || 'Display' }))
		if (d.resolution) b.appendChild(Object.assign(document.createElement('small'), { textContent: d.resolution }))
		b.addEventListener('click', () => onPortClick(k, cid, { type: 'gpu', display: d, index: idx }))
		addPortNodeDot(b, cid, onPortStartCable, k, { type: 'gpu', display: d, index: idx }, 'left')
		if (selectedKey === k) b.classList.add('device-view__port--selected')
		if (cableSourceId && cid === cableSourceId) b.classList.add('device-view__port--cable-armed')
		gpuPorts.append(b)
	})
	return gpuBand
}

export function renderDeckLinkBand(ctx) {
	const {
		live,
		lastPayload,
		resolveConnectorId,
		isConnectorVisible,
		selectedKey,
		cableSourceId,
		onPortClick,
		onPortStartCable,
	} = ctx
	const dlBand = document.createElement('div')
	dlBand.className = 'device-view__band device-view__band--decklink'
	const hTop = document.createElement('h3')
	hTop.textContent = 'DeckLink'
	dlBand.appendChild(hTop)

	function appendSubtitle(text) {
		const h = document.createElement('h4')
		h.className = 'device-view__band-subtitle'
		h.textContent = text
		dlBand.appendChild(h)
		const ports = document.createElement('div')
		ports.className = 'device-view__ports device-view__ports--decklink-group'
		dlBand.appendChild(ports)
		return ports
	}

	const inPorts = appendSubtitle('Inputs & capture')
	const outPorts = appendSubtitle('Program & multiview outputs')
	const normalizeIoDirection = (value) => {
		const v = String(value || '').trim().toLowerCase()
		if (v === 'in' || v === 'input') return 'in'
		if (v === 'out' || v === 'output') return 'out'
		return 'io'
	}

	const ins = live.decklink?.inputs || []
	const outs = live.decklink?.screenOutputs || []
	const mvd = live.decklink?.multiviewDevice
	const ioPorts = (lastPayload?.suggested?.connectors || []).filter((c) => c?.kind === 'decklink_io')
	const ioBySlot = new Map()
	for (const io of ioPorts) {
		const slot = (Number(io?.index) || 0) + 1
		if (slot > 0) ioBySlot.set(slot, io)
	}
	const renderedIoIds = new Set()

	for (const i of ins) {
		const b = document.createElement('button')
		b.type = 'button'
		const st = decklinkInputState(i)
		b.className = 'device-view__port' + stateClass(st.level)
		const k = `decklink_in:${i.slot}:${i.device}`
		b.dataset.portKey = k
		const io = ioBySlot.get(Number(i?.slot) || 0) || null
		const cid = String(io?.id || resolveConnectorId('decklink_in', { input: i }) || '').trim()
		if (!cid || !isConnectorVisible(cid)) continue
		if (cid) b.setAttribute('data-connector-id', cid)
		if (io?.id) renderedIoIds.add(io.id)
		const ioDir = normalizeIoDirection(io?.caspar?.ioDirection ?? i?.ioDirection)
		b.appendChild(Object.assign(document.createElement('span'), { textContent: io ? `SDI ${i.slot} (${ioDir.toUpperCase()})` : `In ${i.slot}` }))
		b.appendChild(Object.assign(document.createElement('small'), { textContent: `device ${i.device} · ${st.text}` }))
		if (io?.id) {
			b.draggable = true
			b.addEventListener('dragstart', (ev) => {
				if (!ev.dataTransfer) return
				ev.dataTransfer.effectAllowed = 'copyMove'
				ev.dataTransfer.setData(
					'application/x-highascg-connector',
					JSON.stringify({ connectorId: io.id, kind: 'decklink_io' })
				)
			})
		}
		if (i?.message) b.title = String(i.message)
		b.addEventListener('click', () => onPortClick(k, cid, { type: 'decklink_in', input: i }))
		// When SDI is used as live input, hide cable dot in Device View.
		// Dot reappears when ioDirection switches away from "in".
		if (ioDir !== 'in') addPortNodeDot(b, cid, onPortStartCable, k, { type: 'decklink_in', input: i }, 'left')
		if (selectedKey === k) b.classList.add('device-view__port--selected')
		if (cableSourceId && cid === cableSourceId) b.classList.add('device-view__port--cable-armed')
		;(ioDir === 'out' ? outPorts : inPorts).append(b)
	}

	for (const o of outs) {
		const b = document.createElement('button')
		b.type = 'button'
		const off = Number(o?.device || 0) <= 0
		b.className = 'device-view__port' + stateClass(off ? 'off' : 'ok')
		const k = `decklink_out:screen:${o.screen}`
		b.dataset.portKey = k
		const cid = String(resolveConnectorId('decklink_out', { output: o }) || '').trim()
		if (!cid || !isConnectorVisible(cid)) continue
		if (cid) b.setAttribute('data-connector-id', cid)
		b.appendChild(Object.assign(document.createElement('span'), { textContent: `Screen ${o.screen} → DL` }))
		b.appendChild(Object.assign(document.createElement('small'), { textContent: o.device ? `device ${o.device}` : 'device 0 (off)' }))
		b.addEventListener('click', () => onPortClick(k, cid, { type: 'decklink_out', output: o }))
		addPortNodeDot(b, cid, onPortStartCable, k, { type: 'decklink_out', output: o }, 'left')
		if (selectedKey === k) b.classList.add('device-view__port--selected')
		if (cableSourceId && cid === cableSourceId) b.classList.add('device-view__port--cable-armed')
		outPorts.append(b)
	}

	if (mvd != null && parseInt(String(mvd), 10) > 0) {
		const b = document.createElement('button')
		b.type = 'button'
		b.className = 'device-view__port device-view__port--ok'
		const k = `decklink_mv:mv:${mvd}`
		b.dataset.portKey = k
		const cid = String(resolveConnectorId('decklink_mv', {}) || '').trim()
		if (cid && isConnectorVisible(cid)) {
			if (cid) b.setAttribute('data-connector-id', cid)
			b.appendChild(Object.assign(document.createElement('span'), { textContent: 'Multiview → DL' }))
			b.appendChild(Object.assign(document.createElement('small'), { textContent: 'device ' + mvd }))
			b.addEventListener('click', () => onPortClick(k, cid, { type: 'decklink_mv', multiviewDevice: mvd }))
			addPortNodeDot(b, cid, onPortStartCable, k, { type: 'decklink_mv', multiviewDevice: mvd }, 'left')
			if (selectedKey === k) b.classList.add('device-view__port--selected')
			if (cableSourceId && cid === cableSourceId) b.classList.add('device-view__port--cable-armed')
			outPorts.append(b)
		}
	}
	for (const io of ioPorts) {
		if (renderedIoIds.has(io.id)) continue
		const b = document.createElement('button')
		b.type = 'button'
		const dir = normalizeIoDirection(io?.caspar?.ioDirection)
		b.className = 'device-view__port' + stateClass(dir === 'out' ? 'ok' : (dir === 'in' ? 'warn' : 'off'))
		const k = `decklink_io:${io.id}`
		b.dataset.portKey = k
		const ioId = String(io.id || '').trim()
		if (!ioId || !isConnectorVisible(ioId)) continue
		b.setAttribute('data-connector-id', ioId)
		b.title = `${io.label || io.id} — SDI I/O slot, direction ${dir.toUpperCase()} (device ${io.externalRef || 0})`
		b.appendChild(Object.assign(document.createElement('span'), { textContent: `${io.label || io.id} (${dir.toUpperCase()})` }))
		b.appendChild(Object.assign(document.createElement('small'), { textContent: `device ${io.externalRef || 0}` }))
		b.draggable = true
		b.addEventListener('dragstart', (ev) => {
			if (!ev.dataTransfer) return
			ev.dataTransfer.effectAllowed = 'copyMove'
			ev.dataTransfer.setData(
				'application/x-highascg-connector',
				JSON.stringify({ connectorId: io.id, kind: 'decklink_io' })
			)
		})
		b.addEventListener('click', () => onPortClick(k, ioId, { type: 'decklink_io', connector: io }))
		addPortNodeDot(b, ioId, onPortStartCable, k, { type: 'decklink_io', connector: io }, dir === 'out' ? 'left' : 'right')
		if (selectedKey === k) b.classList.add('device-view__port--selected')
		if (cableSourceId && ioId === cableSourceId) b.classList.add('device-view__port--cable-armed')
		;(dir === 'out' ? outPorts : inPorts).append(b)
	}

	if (!ins.length && !outs.length && !(mvd > 0) && !ioPorts.length) {
		inPorts.appendChild(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				textContent: 'No DeckLink connectors detected yet. Use “Sync from hardware” to refresh enumeration.',
			})
		)
	}
	return dlBand
}

export function renderStreamingBand(ctx) {
	const { lastPayload, isConnectorVisible, selectedKey, cableSourceId, onPortClick, onPortStartCable, onAddStreamOutput } = ctx
	const streamBand = document.createElement('div')
	streamBand.className = 'device-view__band'
	streamBand.innerHTML = '<div class="device-view__destinations-head"><h3 style="margin:0">Stream outputs</h3><button type="button" class="header-btn" data-add-stream>+</button></div><div class="device-view__ports" data-stream-ports></div>'
	const ports = streamBand.querySelector('[data-stream-ports]')
	const addBtn = streamBand.querySelector('[data-add-stream]')
	if (addBtn) addBtn.addEventListener('click', () => { if (typeof onAddStreamOutput === 'function') onAddStreamOutput() })
	const streams = (lastPayload?.suggested?.connectors || []).filter((c) => c?.kind === 'stream_out')
	if (!streams.length) {
		ports.appendChild(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'No stream outputs configured.' }))
		return streamBand
	}
	for (const s of streams) {
		const b = document.createElement('button')
		b.type = 'button'
		b.className = 'device-view__port'
		const key = `stream_out:${s.id}`
		b.dataset.portKey = key
		if (!isConnectorVisible(s.id)) continue
		b.setAttribute('data-connector-id', s.id)
		b.appendChild(Object.assign(document.createElement('span'), { textContent: s.label || s.id }))
		b.appendChild(Object.assign(document.createElement('small'), { textContent: 'RTMP output' }))
		b.addEventListener('click', () => onPortClick(key, s.id, { type: 'stream_out', connector: s }))
		addPortNodeDot(b, s.id, onPortStartCable, key, { type: 'stream_out', connector: s }, 'left')
		if (selectedKey === key) b.classList.add('device-view__port--selected')
		if (cableSourceId && s.id === cableSourceId) b.classList.add('device-view__port--cable-armed')
		ports.appendChild(b)
	}
	return streamBand
}

export function renderRecordingBand(ctx) {
	const { lastPayload, isConnectorVisible, selectedKey, cableSourceId, onPortClick, onPortStartCable, onAddRecordOutput } = ctx
	const recBand = document.createElement('div')
	recBand.className = 'device-view__band'
	recBand.innerHTML = '<div class="device-view__destinations-head"><h3 style="margin:0">Record outputs</h3><button type="button" class="header-btn" data-add-record>+</button></div><div class="device-view__ports" data-record-ports></div>'
	const ports = recBand.querySelector('[data-record-ports]')
	const addBtn = recBand.querySelector('[data-add-record]')
	if (addBtn) addBtn.addEventListener('click', () => { if (typeof onAddRecordOutput === 'function') onAddRecordOutput() })
	const outputs = (lastPayload?.suggested?.connectors || []).filter((c) => c?.kind === 'record_out')
	if (!outputs.length) {
		ports.appendChild(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'No record outputs configured.' }))
		return recBand
	}
	for (const s of outputs) {
		const b = document.createElement('button')
		b.type = 'button'
		b.className = 'device-view__port'
		const key = `record_out:${s.id}`
		b.dataset.portKey = key
		if (!isConnectorVisible(s.id)) continue
		b.setAttribute('data-connector-id', s.id)
		b.appendChild(Object.assign(document.createElement('span'), { textContent: s.label || s.id }))
		b.appendChild(Object.assign(document.createElement('small'), { textContent: 'FILE record output' }))
		b.addEventListener('click', () => onPortClick(key, s.id, { type: 'record_out', connector: s }))
		addPortNodeDot(b, s.id, onPortStartCable, key, { type: 'record_out', connector: s }, 'left')
		if (selectedKey === key) b.classList.add('device-view__port--selected')
		if (cableSourceId && s.id === cableSourceId) b.classList.add('device-view__port--cable-armed')
		ports.appendChild(b)
	}
	return recBand
}

export function appendSegment(parent, title) {
	const sec = document.createElement('section')
	sec.className = 'device-view__segment'
	const h = document.createElement('h2')
	h.className = 'device-view__segment-title'
	h.textContent = title
	const body = document.createElement('div')
	body.className = 'device-view__segment-body'
	sec.append(h, body)
	parent.append(sec)
	return body
}

export function renderBands(bands, ctx, { currentSettings, statusEl, load }) {
	bands.innerHTML = ''; const live = ctx.live; if (!live) return
	const internalCtx = {
		...ctx,
		currentSettings,
		onAddStreamOutput: async () => {
			try {
				const cur = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : [{ id: 'str_1', label: 'Str1', enabled: true, type: 'rtmp', name: 'Str1', quality: 'medium', rtmpServerUrl: '', streamKey: '', srtUrl: '' }];
				const idx = cur.length + 1;
				const next = [...cur, { id: `str_${idx}`, label: `Str${idx}`, enabled: true, type: 'rtmp', name: `Str${idx}`, quality: 'medium', rtmpServerUrl: '', streamKey: '', srtUrl: '' }];
				await Actions.saveSettingsPatch({ streamOutputs: next });
				setStatus(statusEl, `Added stream output Str${idx}`, true);
				await load()
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onAddRecordOutput: async () => {
			try {
				const cur = Array.isArray(currentSettings?.recordOutputs) ? currentSettings.recordOutputs : [{ id: 'rec_1', label: 'Rec1', enabled: true, name: 'Rec1', source: 'program_1', crf: 26 }];
				const idx = cur.length + 1;
				const next = [...cur, { id: `rec_${idx}`, label: `Rec${idx}`, enabled: true, name: `Rec${idx}`, source: 'program_1', crf: 26 }];
				await Actions.saveSettingsPatch({ recordOutputs: next });
				setStatus(statusEl, `Added record output Rec${idx}`, true);
				await load()
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onRemoveStreamOutput: async (id) => {
			try {
				const cur = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : []
				const next = cur.filter(s => String(s.id) !== String(id))
				await Actions.saveSettingsPatch({ streamOutputs: next })
				setStatus(statusEl, 'Stream output removed', true)
				await load()
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onRemoveRecordOutput: async (id) => {
			try {
				const cur = Array.isArray(currentSettings?.recordOutputs) ? currentSettings.recordOutputs : []
				const next = cur.filter(s => String(s.id) !== String(id))
				await Actions.saveSettingsPatch({ recordOutputs: next })
				setStatus(statusEl, 'Record output removed', true)
				await load()
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onAddAudioOutput: async () => {
			try {
				const cur = Array.isArray(currentSettings?.audioOutputs) ? currentSettings.audioOutputs : [];
				const idx = cur.length + 1;
				const next = [...cur, { id: `audio_${idx}`, label: `Audio ${idx}`, enabled: true, deviceName: '', channelLayout: 'stereo' }];
				await Actions.saveSettingsPatch({ audioOutputs: next });
				setStatus(statusEl, `Added audio output Audio ${idx}`, true);
				await load()
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onRemoveAudioOutput: async (id) => {
			try {
				const cur = Array.isArray(currentSettings?.audioOutputs) ? currentSettings.audioOutputs : []
				const next = cur.filter(s => String(s.id) !== String(id))
				await Actions.saveSettingsPatch({ audioOutputs: next })
				setStatus(statusEl, 'Audio output removed', true)
				await load()
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onAddMappingNode: async () => {
			try {
				await Actions.addMappingNode()
				setStatus(statusEl, 'Added pixel mapping node', true)
				await load()
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onApplyGpuSettings: async () => {
			try {
				setStatus(statusEl, 'Applying GPU/OS settings...', true)
				const res = await Actions.applyOsSettings()
				if (res?.ok) {
					setStatus(statusEl, res.dmRestarted ? 'Applied settings and restarted display manager' : 'Applied settings (display manager restart skipped)', true)
				} else {
					throw new Error(res?.error || 'Apply failed')
				}
				await load()
			} catch (e) { setStatus(statusEl, e.message, false) }
		}
	}
	const proc = appendSegment(bands, 'Processing & Mappings')
	proc.append(renderMappingsBand(internalCtx))

	const eq = appendSegment(bands, 'Rear panel connectors')
	eq.parentElement?.classList.add('device-view__segment--rear-only')
	eq.append(renderCasparBand(internalCtx))
}
