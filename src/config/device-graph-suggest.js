'use strict'

const { destinationsFromConfig } = require('./screen-destinations')
const { normalizeDeviceGraph } = require('./device-graph-core')
const { DEFAULT_DEVICE_ID, DEST_DEVICE_ID, AUTO_CASPAR_KINDS, slug } = require('./device-graph-constants')
const { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } = require('./decklink-io-direction')
const { normalizeVirtualCameraConfig } = require('../virtual-output/v4l2-bridge-config')
const { effectiveAlsaCardId } = require('../virtual-output/v4l2-bridge-audio-sink')

function suggestConnectorsAndDevicesFromLive(live, appConfig) {
	const devices = [{ id: DEFAULT_DEVICE_ID, role: 'caspar_host', label: 'Caspar / HighAsCG host' }]
	const connectors = []
	const gpuConnectorIdFromName = (name) => {
		const base = String(name || '').trim().replace(/^card\d+-/i, '').toUpperCase()
		return base ? `gpu_${base}` : ''
	}
	const gpuPairKeyFromName = (name) => {
		const id = gpuConnectorIdFromName(name)
		if (!id) return ''
		const m = id.match(/^gpu_DP-(\d+)$/i)
		if (!m) return id
		const n = parseInt(m[1], 10)
		if (!Number.isFinite(n)) return id
		const low = n % 2 === 0 ? n : n - 1
		const high = low + 1
		return `DP-${low}/DP-${high}`
	}
	const displays = live && live.gpu && Array.isArray(live.gpu.displays) ? live.gpu.displays : []
	const gpuInventory = live && live.gpu && Array.isArray(live.gpu.connectors) ? live.gpu.connectors : []
	const gpuPhysicalPorts = Array.isArray(live?.gpu?.physicalMap?.ports) ? live.gpu.physicalMap.ports : []
	const gpuCards = Array.isArray(live?.gpu?.physicalMap?.cards)
		? live.gpu.physicalMap.cards
		: [...new Set(gpuPhysicalPorts.map((p) => String(p?.drmCard || '').trim()).filter(Boolean))]
	const multiGpu = gpuCards.length > 1
	const connectedDisplayByName = new Map(
		displays
			.map((d) => String(d?.name || '').trim())
			.filter(Boolean)
			.map((n, i) => [n.toUpperCase(), i])
	)
	const seenGpuIds = new Set()
	if (gpuPhysicalPorts.length) {
		for (const p of gpuPhysicalPorts) {
			if (!p || typeof p !== 'object') continue
			const pid = String(p.physicalPortId || '').trim()
			if (!pid || seenGpuIds.has(pid)) continue
			seenGpuIds.add(pid)
			const activePort = String(p?.runtime?.activePort || '').trim()
			const pairName = String(p?.pair?.name || '').trim()
			const drmCard = String(p?.drmCard || '').trim()
			const drmName = String(p?.drmName || '').trim()
			const cardPrefix = multiGpu && drmCard ? `${drmCard.replace(/^card/i, 'C')}.` : ''
			const label = `${cardPrefix}${pid.replace(/^gpu_p/i, 'P')}`
			const displayIdx = activePort ? connectedDisplayByName.get(activePort.toUpperCase()) : undefined
			connectors.push({
				id: pid,
				deviceId: DEFAULT_DEVICE_ID,
				kind: 'gpu_out',
				label,
				externalRef: drmName || activePort || pairName || pid,
				caspar: { bus: 'pgm', mainIndex: Number.isFinite(displayIdx) ? displayIdx : 0 },
				gpuPhysical: {
					pair: {
						dpA: String(p?.pair?.dpA || ''),
						dpB: String(p?.pair?.dpB || ''),
						name: pairName,
					},
					slotOrder: Number.isFinite(Number(p.slotOrder)) ? Number(p.slotOrder) : 0,
					...(drmCard ? { drmCard } : {}),
					...(drmName ? { drmName } : {}),
				},
			})
		}
	} else {
		const sourceGpuNames = gpuInventory.length
			? gpuInventory.map((g) => String(g?.shortName || g?.name || '').trim()).filter(Boolean)
			: displays.map((d) => String(d?.name || '').trim()).filter(Boolean)
		sourceGpuNames.forEach((name) => {
			const lc = name.trim().toLowerCase()
			if (/^card\d+($|[\s:])/.test(lc) || /^gpu\d+($|[\s:])/.test(lc) || /^renderd\d+($|[\s:])/.test(lc)) return
			const id = gpuConnectorIdFromName(name)
			if (!id || seenGpuIds.has(id)) return
			seenGpuIds.add(id)
			const displayIdx = connectedDisplayByName.get(name.toUpperCase())
			connectors.push({
				id,
				deviceId: DEFAULT_DEVICE_ID,
				kind: 'gpu_out',
				label: name,
				externalRef: name,
				caspar: { bus: 'pgm', mainIndex: Number.isFinite(displayIdx) ? displayIdx : 0 },
				gpuPhysical: {
					pair: { dpA: '', dpB: '', name: gpuPairKeyFromName(name) },
					slotOrder: Number.isFinite(displayIdx) ? displayIdx : 0,
				},
			})
		})
	}
	if (!connectors.some((c) => c.kind === 'gpu_out')) {
		const pgmCount = Array.isArray(live?.caspar?.generatedChannelOrder) ? live.caspar.generatedChannelOrder.filter((x) => x?.role === 'pgm').length : 0
		const screenCountHint = live?.caspar?.screenCount ?? pgmCount ?? 1
		const count = Math.max(1, parseInt(String(screenCountHint), 10) || 1)
		for (let i = 0; i < count; i++) {
			connectors.push({ id: `caspar_pgm_${i + 1}`, deviceId: DEFAULT_DEVICE_ID, kind: 'gpu_out', label: `Program ${i + 1} (virtual)`, caspar: { bus: 'pgm', mainIndex: i }, externalRef: `program_${i + 1}` })
		}
	}
	/* WO-428: only build DeckLink ports when hardware was actually DETECTED. The snapshot's
	 * `decklink.detected` merges the ffmpeg enumeration with the OS probe, and the OS half
	 * reports the PCI card (by its real lspci model name) even when the driver is missing —
	 * so a physically present card always counts. A machine with neither must not render a
	 * phantom card: fresh installs can carry cloned decklink_* config keys from the build
	 * host, and the config fallback below exists for "Caspar offline on a box that HAS the
	 * card", not for boxes without one. Fails OPEN when the snapshot carries no probe data. */
	const decklinkDetected = !live?.decklink || live.decklink.detected !== false
	const seenDecklinkIndices = new Set()
	const addDecklinkPort = (slot, device, kind, label, extra = {}) => {
		if (!decklinkDetected) return
		const devIdx = parseInt(String(device), 10)
		if (isNaN(devIdx) || devIdx <= 0) return
		const id = `dlsdi_${slot}`
		if (seenDecklinkIndices.has(devIdx)) return
		seenDecklinkIndices.add(devIdx)
		connectors.push({
			id,
			deviceId: DEFAULT_DEVICE_ID,
			kind: 'decklink_io',
			index: slot - 1,
			label: label || `SDI ${slot}`,
			externalRef: String(devIdx),
			...extra
		})
	}

	for (const i of live?.decklink?.inputs || []) {
		const slot = parseInt(i.slot, 10)
		if (isNaN(slot)) continue
		const ioDirection = normalizeDecklinkIoDirection({ ioDirection: i?.ioDirection })
		addDecklinkPort(slot, i.device, 'decklink_io', `SDI ${slot}`, { caspar: { ioDirection } })
	}
	
	for (const o of live?.decklink?.screenOutputs || []) {
		const s = parseInt(o.screen, 10)
		const d = parseInt(o.device, 10)
		if (isNaN(s) || isNaN(d)) continue
		const caspar = { ioDirection: 'out', bus: 'pgm', mainIndex: s - 1 }
		if (o?.keyFill?.enabled && parseInt(String(o.keyFill.keyDevice), 10) > 0) {
			caspar.decklinkKeyFill = true
			caspar.decklinkKeyDevice = parseInt(String(o.keyFill.keyDevice), 10)
			caspar.decklinkKeyer = String(o.keyFill.keyer || 'default')
		}
		addDecklinkPort(s, d, 'decklink_io', `SDI ${s}`, { caspar })
	}

	const mvd = parseInt(live?.decklink?.multiviewDevice, 10)
	if (mvd > 0) {
		addDecklinkPort(99, mvd, 'decklink_io', 'SDI (MVR)', { caspar: { ioDirection: 'out', bus: 'multiview' } })
	}

	// Fallback: discover from config if Caspar is offline or misconfigured
	const cs = appConfig?.casparServer || {}
	const inputCount = Math.max(0, parseInt(String(cs.decklink_input_count || 0), 10))
	for (let i = 1; i <= inputCount; i++) {
		const dev = parseInt(String(cs[`decklink_input_${i}_device`] || i), 10)
		const dir = normalizeDecklinkIoDirection({ ioDirection: cs[`decklink_input_${i}_direction`] })
		if (dir === DECKLINK_IO_UNASSIGNED) continue
		addDecklinkPort(i, dev, 'decklink_io', `SDI ${i}`, { caspar: { ioDirection: dir } })
	}
	const cfgScreenCount = Math.max(1, parseInt(String(cs.screen_count || 1), 10))
	for (let i = 1; i <= cfgScreenCount; i++) {
		const dev = parseInt(String(cs[`screen_${i}_decklink_device`]), 10)
		if (Number.isFinite(dev) && dev > 0) {
			addDecklinkPort(i, dev, 'decklink_io', `SDI ${i}`, { caspar: { ioDirection: 'out', bus: 'pgm', mainIndex: i - 1 } })
		}
	}
	const cfgMvd = parseInt(String(cs.multiview_decklink_device), 10)
	if (Number.isFinite(cfgMvd) && cfgMvd > 0) {
		addDecklinkPort(99, cfgMvd, 'decklink_io', 'SDI (MVR)', { caspar: { ioDirection: 'out', bus: 'multiview' } })
	}

	const v4l2Count = Math.max(0, parseInt(String(cs.v4l2_input_count || 0), 10))
	for (let i = 1; i <= v4l2Count; i++) {
		const devPath = String(cs[`v4l2_input_${i}_device`] || '').trim()
		if (!devPath) continue
		const label = String(cs[`v4l2_input_${i}_label`] || '').trim() || `USB video ${i}`
		connectors.push({
			id: `v4li_${i}`,
			deviceId: DEFAULT_DEVICE_ID,
			kind: 'v4l2_in',
			index: i - 1,
			label,
			externalRef: devPath,
			caspar: { ioDirection: 'in', v4l2Slot: i },
		})
	}

	// Hardware discovery: show any unassigned physical decklink devices from the server log/probe
	const hwConnectors = Array.isArray(live?.decklink?.hardware?.connectors) ? live.decklink.hardware.connectors : []
	for (const hw of hwConnectors) {
		const devIdx = parseInt(String(hw.index), 10)
		if (Number.isFinite(devIdx) && devIdx > 0 && !seenDecklinkIndices.has(devIdx)) {
			addDecklinkPort(devIdx, devIdx, 'decklink_io', hw.name || `DeckLink ${devIdx}`, {
				caspar: { ioDirection: DECKLINK_IO_UNASSIGNED },
			})
		}
	}

	const mvDestCount = (destinationsFromConfig(appConfig) || []).filter(
		(d) => d && String(d.mode || '').toLowerCase() === 'multiview',
	).length
	const mvItem = Array.isArray(live?.caspar?.generatedChannelOrder)
		? live.caspar.generatedChannelOrder.find((x) => x?.role === 'multiview')
		: null
	if (mvDestCount > 0 && (live?.caspar?.multiviewEnabled || mvItem)) {
		connectors.push({
			id: 'caspar_mv_out',
			deviceId: DEFAULT_DEVICE_ID,
			kind: 'caspar_mv_out',
			label: 'Multiview channel (virtual)',
			externalRef: String(live?.caspar?.multiviewChannel ?? mvItem?.ch ?? ''),
		})
	}
	// WO-393: seed only when the key is absent — an empty array means the operator removed all outputs.
	const streamOutputsRaw = appConfig && Array.isArray(appConfig.streamOutputs) ? appConfig.streamOutputs : [{ id: 'str_1', label: 'Str1', enabled: true }]
	for (let i = 0; i < streamOutputsRaw.length; i++) {
		const so = streamOutputsRaw[i] || {}
		const id = String(so.id || `str_${i + 1}`).trim() || `str_${i + 1}`
		const name = String(so.name || so.label || `Str${i + 1}`).trim() || `Str${i + 1}`
		connectors.push({
			id,
			deviceId: DEFAULT_DEVICE_ID,
			kind: 'stream_out',
			index: i,
			label: String(so.label || name).slice(0, 120),
			externalRef: String(so.slug || `stream_${i + 1}`),
			caspar: {
				type: String(so.type || 'rtmp').toLowerCase(),
				name,
				quality: String(so.quality || 'medium'),
				// WO-261: connectors are client-bound — never expose the raw key. Config creds are
				// blanked once migrated to the project; the inspector reads URL/status from settings.
				rtmpServerUrl: String(so.rtmpServerUrl || ''),
				streamKey: '',
				hasStreamKey: !!String(so.streamKey || ''),
				srtUrl: String(so.srtUrl || ''),
				udpUrl: String(so.udpUrl || ''),
				videoCodec: String(so.videoCodec || 'h264').toLowerCase(),
				videoBitrateKbps: Math.max(200, parseInt(String(so.videoBitrateKbps ?? 4500), 10) || 4500),
				encoderPreset: String(so.encoderPreset || 'veryfast').toLowerCase(),
				audioCodec: String(so.audioCodec || 'aac').toLowerCase(),
				audioBitrateKbps: Math.max(32, parseInt(String(so.audioBitrateKbps ?? 128), 10) || 128),
			},
		})
	}
	const vc = appConfig?.virtualCamera
	if (vc && typeof vc === 'object' && vc.showInDeviceView !== false) {
		const normalized = normalizeVirtualCameraConfig(vc)
		connectors.push({
			id: 'vcam_1',
			deviceId: DEFAULT_DEVICE_ID,
			kind: 'v4l2_out',
			index: 0,
			label: String(normalized.label || 'Virtual cam').slice(0, 120),
			externalRef: String(normalized.device || '/dev/video10'),
			caspar: {
				channel: normalized.channel,
				fps: normalized.fps,
				width: normalized.width,
				height: normalized.height,
				audioEnabled: normalized.audioEnabled,
				alsaLoopbackCardId: normalized.alsaLoopbackCardId,
				captureDevice: `hw:${effectiveAlsaCardId(normalized.alsaLoopbackCardId)},1,0`,
			},
		})
	}
	/* WO-473: suggest a record_out connector only for record outputs that actually exist — a fresh
	 * box has none, and the old fallback drew a rec_1 band in device view before one was added. */
	const recordOutputsRaw = appConfig && Array.isArray(appConfig.recordOutputs)
		? appConfig.recordOutputs
		: []
	for (let i = 0; i < recordOutputsRaw.length; i++) {
		const ro = recordOutputsRaw[i] || {}
		const id = String(ro.id || `rec_${i + 1}`).trim() || `rec_${i + 1}`
		const name = String(ro.name || ro.label || `Rec${i + 1}`).trim() || `Rec${i + 1}`
		connectors.push({
			id,
			deviceId: DEFAULT_DEVICE_ID,
			kind: 'record_out',
			index: i,
			label: String(ro.label || name).slice(0, 120),
			externalRef: String(ro.slug || `record_${i + 1}`),
			caspar: {
				name,
				source: String(ro.source || 'program_1'),
				crf: Math.min(51, Math.max(18, parseInt(String(ro.crf ?? 26), 10) || 26)),
				videoCodec: String(ro.videoCodec || 'h264').toLowerCase(),
				videoBitrateKbps: Math.max(200, parseInt(String(ro.videoBitrateKbps ?? 4500), 10) || 4500),
				encoderPreset: String(ro.encoderPreset || 'veryfast').toLowerCase(),
				audioCodec: String(ro.audioCodec || 'aac').toLowerCase(),
				audioBitrateKbps: Math.max(32, parseInt(String(ro.audioBitrateKbps ?? 128), 10) || 128),
			},
		})
	}
	// User-managed audio output connectors (like stream/record outputs — not auto-enumerated)
	const audioOutputs = Array.isArray(appConfig?.audioOutputs) ? appConfig.audioOutputs : []
	for (const ao of audioOutputs) {
		if (!ao || typeof ao !== 'object') continue
		const id = String(ao.id || '').trim()
		if (!id) continue
		connectors.push({
			id,
			deviceId: DEFAULT_DEVICE_ID,
			kind: 'audio_out',
			label: String(ao.label || ao.name || id).slice(0, 120),
			externalRef: String(ao.deviceName || ''),
		})
	}

	const destinationItems = Array.isArray(live?.caspar?.destinationIntent?.items) ? live.caspar.destinationIntent.items : []
	if (destinationItems.length) {
		devices.push({ id: DEST_DEVICE_ID, role: 'destinations', label: 'Screen destinations' })
		for (const item of destinationItems) {
			const did = String(item?.id || '').trim()
			if (!did) continue
			connectors.push({ id: `dst_in_${did}`, deviceId: DEST_DEVICE_ID, kind: 'destination_in', label: String(item?.label || did).slice(0, 120), externalRef: did })
		}
	}

	// WO-88: virtual host-channel destinations (webpage / NDI / per-input hosts) for cabling + matrix.
	const HOST_DEST_ROLES = new Set([
		'inputs_host',
		'streaming_channel',
		'extra_audio',
		'decklink_input',
		'live_audio_input',
		'v4l2_input',
		'webpage_host',
		'ndi_host',
	])
	const { hostChannelDestinationId, listHostLiveChannelEntries } = require('./host-live-sources')
	const ensureHostDestConnector = (destId, label, casparMeta = {}) => {
		if (!destId) return
		const connectorId = `dst_in_${destId}`
		if (connectors.some((c) => c.id === connectorId)) return
		if (!devices.some((d) => d.id === DEST_DEVICE_ID)) {
			devices.push({ id: DEST_DEVICE_ID, role: 'destinations', label: 'Screen destinations' })
		}
		connectors.push({
			id: connectorId,
			deviceId: DEST_DEVICE_ID,
			kind: 'destination_in',
			label: String(label || destId).slice(0, 120),
			externalRef: destId,
			...(Object.keys(casparMeta).length ? { caspar: casparMeta } : {}),
		})
	}
	for (const entry of listHostLiveChannelEntries(appConfig || {})) {
		const destId = hostChannelDestinationId(entry.kind, entry.channel, entry.sourceId)
		ensureHostDestConnector(destId, entry.label, {
			hostRole: entry.kind,
			hostChannel: entry.channel,
			hostLayer: entry.layer,
			sourceId: entry.sourceId,
		})
	}
	const channelOrder = Array.isArray(live?.caspar?.generatedChannelOrder) ? live.caspar.generatedChannelOrder : []
	const { resolveDecklinkInputSlots } = require('./decklink-input-slots')
	const configuredDecklinkInputSlots = new Set(resolveDecklinkInputSlots(appConfig || {}))
	for (const row of channelOrder) {
		const role = String(row?.role || '').trim()
		if (!HOST_DEST_ROLES.has(role)) continue
		if (role === 'decklink_input') {
			const slot = parseInt(String(row?.slot ?? ''), 10)
			if (!Number.isFinite(slot) || slot < 1 || !configuredDecklinkInputSlots.has(slot)) continue
		}
		const ch = parseInt(String(row?.ch ?? ''), 10)
		if (!Number.isFinite(ch) || ch < 1) continue
		const destId = hostChannelDestinationId(role, ch, row.sourceId ?? row.slot)
		const label = String(row?.label || '').trim() || destId
		ensureHostDestConnector(destId, label, { hostRole: role, hostChannel: ch, ...(row.slot != null ? { slot: row.slot } : {}) })
	}
	// Ensure DeckLink ports from graph are represented even if detection fails
	const graphConnectors = Array.isArray(appConfig?.deviceGraph?.connectors) ? appConfig.deviceGraph.connectors : []
	for (const c of graphConnectors) {
		if (c && c.kind === 'decklink_io' && !connectors.some((x) => x.id === c.id)) {
			connectors.push({
				...c,
				label: c.label || `SDI ${Number(c.index) + 1}`,
				isVirtual: true,
			})
		}
	}

	return { devices, connectors }
}

function mergeHardwareSync(baseGraph, suggested) {
	const g = normalizeDeviceGraph(baseGraph)
	const sug = { devices: Array.isArray(suggested?.devices) ? suggested.devices : [], connectors: Array.isArray(suggested?.connectors) ? suggested.connectors : [] }
	const newDev = new Map()
	for (const d of g.devices) newDev.set(d.id, d)
	for (const d of sug.devices) if (d && d.id) newDev.set(d.id, d)
	g.devices = [...newDev.values()]
	const keepConnector = (c) => {
		if (!c || typeof c !== 'object') return false
		if (AUTO_CASPAR_KINDS.has(c.kind) && c.deviceId === DEFAULT_DEVICE_ID) return false
		return true
	}
	const byId = new Map()
	for (const c of g.connectors) if (keepConnector(c)) byId.set(c.id, c)
	for (const c of sug.connectors) {
		if (!c || !c.id) continue
		const prev = byId.get(c.id)
		// Suggested DeckLink ports come from hardware + Caspar hints; the graph is the operator
		// source of truth for ioDirection / outputBinding. Blind replace made every port "snap back"
		// to input after reload even after marking SDI as output.
		if (prev && prev.kind === 'decklink_io' && c.kind === 'decklink_io') {
			byId.set(c.id, {
				...c,
				label: (prev.label && String(prev.label).trim()) || c.label,
				externalRef: prev.externalRef != null && String(prev.externalRef).trim() !== '' ? prev.externalRef : c.externalRef,
				index: Number.isFinite(Number(prev.index)) ? prev.index : c.index,
				caspar: { ...(c.caspar || {}), ...(prev.caspar || {}) },
			})
		} else {
			byId.set(c.id, c)
		}
	}
	g.connectors = [...byId.values()]
	// GPU connector migration: remap legacy gpu_DP-* edge endpoints to stable gpu_p* when possible.
	{
		const newGpu = (sug.connectors || []).filter((c) => c && c.kind === 'gpu_out' && /^gpu_p\d+$/i.test(String(c.id || '')))
		if (newGpu.length) {
			const mapLegacyGpuToPhysical = new Map()
			const norm = (v) => String(v || '').trim().toUpperCase().replace(/^CARD\d+-/i, '')
			const pairKeyFromName = (name) => {
				const m = norm(name).match(/^DP-(\d+)$/)
				if (!m) return ''
				const n = parseInt(m[1], 10)
				if (!Number.isFinite(n)) return ''
				const lo = n % 2 === 0 ? n : n - 1
				const hi = lo + 1
				return `DP-${lo}/DP-${hi}`
			}
			for (const legacy of (g.connectors || [])) {
				if (!legacy || legacy.kind !== 'gpu_out') continue
				const lid = String(legacy.id || '')
				if (/^gpu_p\d+$/i.test(lid)) continue
				const candidates = [legacy.externalRef, legacy.label, lid]
				let mapped = ''
				for (const c of candidates) {
					const n = norm(c)
					if (!n) continue
					const byRef = newGpu.find((x) => norm(x.externalRef) === n || norm(x.label) === n)
					if (byRef?.id) { mapped = byRef.id; break }
					const pk = pairKeyFromName(n)
					if (pk) {
						const byPair = newGpu.find((x) => norm(x?.gpuPhysical?.pair?.name || x.externalRef) === pk)
						if (byPair?.id) { mapped = byPair.id; break }
					}
					const m = n.match(/^GPU_DP-(\d+)$/)
					if (m) {
						const p = pairKeyFromName(`DP-${m[1]}`)
						const byPair = p ? newGpu.find((x) => norm(x?.gpuPhysical?.pair?.name || x.externalRef) === p) : null
						if (byPair?.id) { mapped = byPair.id; break }
					}
				}
				if (mapped) mapLegacyGpuToPhysical.set(lid, mapped)
			}
			if (mapLegacyGpuToPhysical.size) {
				g.edges = (g.edges || []).map((e) => {
					if (!e || typeof e !== 'object') return e
					const sourceId = mapLegacyGpuToPhysical.get(String(e.sourceId || '')) || e.sourceId
					const sinkId = mapLegacyGpuToPhysical.get(String(e.sinkId || '')) || e.sinkId
					return { ...e, sourceId, sinkId }
				})
			}
		}
	}
	const cIds = new Set(g.connectors.map((c) => c.id))
	g.edges = (g.edges || []).filter((e) => cIds.has(e.sourceId) && cIds.has(e.sinkId) && e.sourceId !== e.sinkId)
	return normalizeDeviceGraph(g)
}

module.exports = { suggestConnectorsAndDevicesFromLive, mergeHardwareSync }
