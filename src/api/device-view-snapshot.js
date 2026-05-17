/**
 * Live system snapshot construction for Device View.
 */
'use strict'

const os = require('os')
const { getDisplayDetails, getGpuConnectorInventory } = require('../utils/hardware-info')
const { readSystemInventoryFile } = require('../bootstrap/system-inventory-file')
const { casparSnapshot } = require('./device-view-caspar-snapshot')
const { resolveMainScreenCount, getChannelMap } = require('../config/routing')
const { destinationsFromConfig } = require('../config/screen-destinations')
const { probeDecklinkHardware, probeDecklinkFromCasparLog } = require('../utils/decklink-enum')
const { buildGpuPhysicalMap } = require('../utils/gpu-physical-map')
const { listPortAudioDevices } = require('../audio/audio-devices')

function isPseudoGpuConnectorName(name) {
	const s = String(name || '').trim().toLowerCase()
	if (!s) return true
	if (/^card\d+($|[\s:])/.test(s)) return true
	if (/^gpu\d+($|[\s:])/.test(s)) return true
	if (/^renderd\d+($|[\s:])/.test(s)) return true
	return false
}

function buildDecklinkSummary(ctx, decklinkHardware) {
	const cs = ctx.config?.casparServer || {}
	const configured = Math.min(8, Math.max(0, parseInt(String(cs.decklink_input_count ?? 0), 10) || 0))
	let highestConfiguredDeviceSlot = 0
	for (let i = 1; i <= 8; i++) {
		const device = parseInt(String(cs[`decklink_input_${i}_device`] ?? 0), 10) || 0
		if (device > 0) highestConfiguredDeviceSlot = i
	}
	// Device View is now the main workflow. Keep slot count stable from graph/hardware model,
	// not from partial per-slot keys that may exist for only one edited connector.
	let graphMaxSlot = 0
	const graphConnectors = Array.isArray(ctx.config?.deviceGraph?.connectors) ? ctx.config.deviceGraph.connectors : []
	for (const c of graphConnectors) {
		if (!c || c.kind !== 'decklink_io') continue
		const slot = (parseInt(String(c.index ?? -1), 10) || 0) + 1
		if (slot > graphMaxSlot) graphMaxSlot = slot
	}
	const runtimeRequested = Math.min(
		8,
		Math.max(0, parseInt(String(ctx._decklinkInputsStatus?.requestedSlots ?? 0), 10) || 0)
	)
	const hardwareCount = Math.min(
		8,
		Math.max(
			0,
			Array.isArray(decklinkHardware?.connectors) ? decklinkHardware.connectors.length : 0
		)
	)
	const strongestHint = Math.max(runtimeRequested, highestConfiguredDeviceSlot)
	let n = 0
	// Deterministic behavior:
	// - show real ports when detected by probe/log parser
	// - otherwise do NOT fabricate DeckLink ports on pure config hints
	//   (prevents phantom ports when no card is present)
	if (hardwareCount > 0) n = hardwareCount
	else n = 0
	n = Math.min(8, Math.max(0, n))
	const rt = ctx._decklinkInputsStatus; const inputs = []
	for (let i = 1; i <= n; i++) {
		const device = parseInt(String(cs[`decklink_input_${i}_device`] ?? 0), 10) || 0
		const ioRaw = String(cs[`decklink_input_${i}_direction`] || 'in').toLowerCase()
		const ioDirection = ioRaw === 'out' ? 'out' : 'in'
		const fail = (rt?.failed || []).find(x => Number(x?.layer) === i); let state = 'ready', message = ''
		if (!rt || rt.enabled === false) { state = 'disabled'; message = rt?.reason || 'disabled' }
		else if ((rt.skippedConflicts || []).find(x => Number(x?.input) === i)) { state = 'conflict_output_device'; message = 'conflict' }
		else if ((rt.skippedDuplicates || []).find(x => Number(x?.input) === i)) { state = 'duplicate_device'; message = 'duplicate' }
		else if (fail) { state = 'failed'; message = fail.message }
		else if (device <= 0) { state = 'unassigned'; message = '0' }
		inputs.push({ slot: i, device, ioDirection, state, message, hostingChannel: rt?.hostingChannel ?? null, hostLabel: rt?.hostLabel || '', updatedAt: rt?.updatedAt || null })
	}
	const screenCount = Math.max(1, resolveMainScreenCount(ctx.config))
	const screenOutputs = []
	for (let s = 1; s <= screenCount; s++) {
		const device = parseInt(String(cs[`screen_${s}_decklink_device`] ?? 0), 10) || 0
		const replaceScreen = !!cs[`screen_${s}_decklink_replace_screen`]
		if (device > 0 || replaceScreen) screenOutputs.push({ screen: s, device, replaceScreen })
	}
	return {
		inputs,
		screenOutputs,
		multiviewDevice: parseInt(String(cs.multiview_decklink_device ?? 0), 10) || 0,
		runtime: rt || null,
		hardware: decklinkHardware || { source: 'none', connectors: [] },
		detected: hardwareCount > 0,
		configHints: {
			decklinkInputCount: configured,
			graphMaxSlot,
			runtimeRequested,
			highestConfiguredDeviceSlot,
			strongestHint,
		},
	}
}

function buildDestinationCasparIntent(ctx) {
	const list = destinationsFromConfig(ctx.config || {}); const map = getChannelMap(ctx.config || {})
	const items = []; let pgmOnlyCount = 0, generatedPreviewCount = 0
	for (const d of list) {
		if (!d) continue; const mainIdx = Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0)
		const modeRaw = String(d.mode || 'pgm_prv')
		const mode = modeRaw === 'pgm_only' ? 'pgm_only' : (modeRaw === 'multiview' ? 'multiview' : (modeRaw === 'stream' ? 'stream' : 'pgm_prv'))
		const pgmCh = mode === 'multiview' ? (map.multiviewCh ?? null) : (map.programChannels?.[mainIdx] ?? null)
		const prvGen = (mode === 'multiview' || mode === 'stream') ? null : (map.previewChannels?.[mainIdx] ?? null)
		if (mode === 'pgm_only') pgmOnlyCount++; if (prvGen != null) generatedPreviewCount++
		items.push({ id: String(d.id || ''), label: String(d.label || d.id || ''), mainScreenIndex: mainIdx, mode, pgmChannel: pgmCh, previewChannelIntended: mode === 'pgm_only' ? null : prvGen, previewChannelGenerated: prvGen, previewChannelGeneratedEnabled: (map.previewEnabledByMain || [])[mainIdx] !== false, videoMode: String(d.videoMode || ''), width: d.width || null, height: d.height || null, fps: d.fps || null })
	}
	return { items, pgmOnlyCount, generatedPreviewCount }
}

function buildGeneratedChannelOrder(ctx) {
	const map = getChannelMap(ctx.config || {}); const out = []
	for (let i = 0; i < map.screenCount; i++) {
		if (map.programChannels?.[i] != null) out.push({ ch: map.programChannels[i], role: 'pgm', mainIndex: i })
		if (map.previewChannels?.[i] != null && (map.previewEnabledByMain || [])[i] !== false) {
			out.push({ ch: map.previewChannels[i], role: map.switcherBusMode ? 'bus1' : 'prv', mainIndex: i })
		}
		if (map.switcherBusMode && map.switcherBusChannels?.[i] != null) {
			out.push({ ch: map.switcherBusChannels[i], role: 'bus2', mainIndex: i })
		}
	}
	(map.multiviewChannels || []).forEach((ch, i) => {
		out.push({ ch, role: 'multiview', mainIndex: i })
	})
	if (map.inputsCh != null && !map.inputsOnMvr) out.push({ ch: map.inputsCh, role: 'inputs_host' })
	for (const ch of map.audioOnlyChannels || []) out.push({ ch: ch, role: 'extra_audio' })
	if (map.streamingCh != null) {
		const c = map.streamingCh
		const inPgm = (map.programChannels || []).includes(c)
		const inPrv = (map.previewChannels || []).includes(c)
		const inBus2 = (map.switcherBusChannels || []).includes(c)
		const isMv = c === map.multiviewCh; const isInp = c === map.inputsCh
		if (!inPgm && !inPrv && !inBus2 && !isMv && !isInp) out.push({ ch: c, role: 'streaming_channel' })
	}
	return out.sort((a, b) => a.ch - b.ch)
}

async function buildLiveSnapshot(ctx) {
	const warnings = []; const inv = readSystemInventoryFile(); let displays = []
	try { displays = getDisplayDetails() || [] } catch (e) { warnings.push(`gpu_enum: ${e.message}`) }
	let decklinkHw =
		inv?.payload?.decklink && Array.isArray(inv.payload.decklink.connectors)
			? inv.payload.decklink
			: { source: 'none', connectors: [] }
	if (!decklinkHw.connectors.length) {
		try {
			decklinkHw = await probeDecklinkHardware({ timeoutMs: 1200 })
			if (decklinkHw?.warning) warnings.push(`decklink_enum: ${decklinkHw.warning}`)
		} catch (e) {
			warnings.push(`decklink_enum: ${e.message}`)
		}
	}
	if (!Array.isArray(decklinkHw?.connectors) || decklinkHw.connectors.length === 0) {
		const fromCasparLog = probeDecklinkFromCasparLog({ maxBytes: 4 * 1024 * 1024 })
		if (Array.isArray(fromCasparLog?.connectors) && fromCasparLog.connectors.length > 0) {
			decklinkHw = fromCasparLog
		} else if (fromCasparLog?.warning) {
			warnings.push(`decklink_log_parse: ${fromCasparLog.warning}`)
		}
	}
	if (decklinkHw?.warning) warnings.push(`decklink_log: ${decklinkHw.warning}`)
	if ((!Array.isArray(decklinkHw?.connectors) || decklinkHw.connectors.length === 0) && ctx.gatheredInfo?.decklinkFromConfig) {
		const fromConfig = ctx.gatheredInfo.decklinkFromConfig
		const connectors = []
		Object.keys(fromConfig).forEach((ch) => {
			const info = fromConfig[ch]
			if (Array.isArray(info?.consumers)) {
				info.consumers.forEach((c) => {
					if (c.device > 0 && !connectors.some((x) => x.index === c.device)) {
						connectors.push({ index: c.device, label: `DeckLink ${c.device} (from config)` })
					}
				})
			}
		})
		if (connectors.length > 0) {
			decklinkHw = { source: 'caspar_config', connectors: connectors.sort((a, b) => a.index - b.index), detected: true }
		}
	}
	const caspar = casparSnapshot(ctx); caspar.destinationIntent = buildDestinationCasparIntent(ctx)
	caspar.generatedChannelOrder = buildGeneratedChannelOrder(ctx); caspar.applyPlan = null // built on demand
	
	const casparScreens = Array.isArray(decklinkHw?.screens) ? decklinkHw.screens : []
	const decoratedDisplays = displays.map(d => {
		// Attempt to match CasparCG screen consumer to physical display by coordinate/index
		const s = casparScreens.find(cs => {
			if (cs.index === 1 && d.x === 0 && d.y === 0) return true
			// Fallback: if we only have one screen and one display, they match
			if (casparScreens.length === 1 && displays.length === 1) return true
			return false
		})
		return {
			...d,
			casparScreenIndex: s?.index || null,
			casparMode: s?.mode || null
		}
	})

	const gpuConnectors = getGpuConnectorInventory() || []
	const sanitizedGpuConnectors = (Array.isArray(gpuConnectors) ? gpuConnectors : [])
		.filter((c) => !isPseudoGpuConnectorName(c?.shortName || c?.name))
	const gpuPhysicalMap = buildGpuPhysicalMap({
		config: ctx.config || {},
		displays: decoratedDisplays,
		connectors: sanitizedGpuConnectors,
	})
	// PortAudio device enumeration for rear panel audio slots and inspector device selectors
	const { listPortAudioDevices, listAudioDevices } = require('../audio/audio-devices')
	let portaudioDevices = []
	try {
		const paResult = listPortAudioDevices({ outputsOnly: false })
		portaudioDevices = Array.isArray(paResult?.devices) ? paResult.devices : []
	} catch (e) {
		warnings.push(`portaudio_enum: ${e.message}`)
	}
	let genericAudioDevices = []
	try {
		const genericResult = listAudioDevices()
		genericAudioDevices = Array.isArray(genericResult?.devices) ? genericResult.devices : []
	} catch (e) {
		warnings.push(`audio_enum: ${e.message}`)
	}

	return {
		host: {
			hostname: inv?.payload?.host?.hostname || os.hostname(),
			platform: process.platform,
			collectedAt: new Date().toISOString(),
		},
		gpu: {
			displays: decoratedDisplays.map(d => ({ 
				name: d.name, 
				resolution: d.resolution, 
				refreshHz: d.refreshHz, 
			modes: (d.modes || []).slice(0, 64),
				casparScreenIndex: d.casparScreenIndex,
				casparMode: d.casparMode,
				connected: d.connected
			})),
			connectors: sanitizedGpuConnectors,
			physicalMap: gpuPhysicalMap,
		},
		decklink: buildDecklinkSummary(ctx, decklinkHw),
		audio: {
			portaudio: portaudioDevices,
			devices: genericAudioDevices,
		},
		caspar,
		warnings,
	}
}

module.exports = { buildLiveSnapshot, buildDecklinkSummary, buildDestinationCasparIntent, buildGeneratedChannelOrder }
