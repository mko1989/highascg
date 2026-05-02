/**
 * Channel routing map and data resolution logic.
 */
'use strict'

function readCasparSetting(cfg, key) {
	if (!cfg || typeof cfg !== 'object') return undefined
	const cs = cfg.casparServer && typeof cfg.casparServer === 'object' ? cfg.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	if (Object.prototype.hasOwnProperty.call(cfg, key)) return cfg[key]
	return undefined
}

function resolveMainScreenCount(config) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	const a = parseInt(String(config?.screen_count ?? ''), 10); const b = parseInt(String(cs?.screen_count ?? ''), 10)
	const nA = Number.isFinite(a) && a >= 1 ? a : 1
	const nB = Number.isFinite(b) && b >= 1 ? b : 1
	const top = config?.tandemTopology && typeof config.tandemTopology === 'object' ? config.tandemTopology : null
	const destArray = top != null && Array.isArray(top.destinations) ? top.destinations : null
	const routableDests = Array.isArray(destArray)
		? destArray.filter((d) => {
			const mode = String(d?.mode || 'pgm_prv')
			return mode !== 'multiview' && mode !== 'stream'
		})
		: []
	// When destinations exist, drive screen count from topology only — stale casparServer.screen_count must not spawn extra PGM/PRV pairs.
	if (routableDests.length > 0) {
		const fromDest = Math.max(
			...routableDests.map((d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) + 1)
		)
		return Math.max(1, fromDest)
	}
	// Topology object with an explicit destinations array but no PGM/PRV mains (cleared UI, or only multiview/stream): one main bus — do not inherit stale screen_count from disk.
	if (top != null && Array.isArray(top.destinations) && routableDests.length === 0) {
		return 1
	}
	const dg = config?.deviceGraph || {}
	const mappingNodes = (Array.isArray(dg.devices) ? dg.devices : []).filter(d => d.role === 'pixel_mapping')
	const edges = Array.isArray(dg.edges) ? dg.edges : []
	const connectors = Array.isArray(dg.connectors) ? dg.connectors : []
	let mappingCount = 0
	mappingNodes.forEach(node => {
		const nodeConns = connectors.filter(c => c.deviceId === node.id && c.kind === 'pixel_map_out')
		nodeConns.forEach(conn => {
			if (edges.some(e => e.sourceId === conn.id)) mappingCount++
		})
	})

	return Math.max(1, Math.max(nA, nB)) + mappingCount
}

function resolvePreviewEnabledByMain(config, screenCount) {
	const top = config?.tandemTopology && typeof config.tandemTopology === 'object' ? config.tandemTopology : null
	const dests = Array.isArray(top?.destinations) ? top.destinations : []
	const withMode = dests.filter(d => {
		const mode = String(d?.mode || 'pgm_prv')
		return mode !== 'multiview' && mode !== 'stream'
	})
	if (!withMode.length) return Array.from({ length: screenCount }, () => true)
	const out = Array.from({ length: screenCount }, () => true)
	for (let idx = 0; idx < screenCount; idx++) {
		const perMain = withMode.filter(d => (parseInt(String(d.mainScreenIndex ?? 0), 10) || 0) === idx)
		if (!perMain.length) continue
		const picked = perMain.find(d => String(d.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]
		out[idx] = String(picked.mode || 'pgm_prv') !== 'pgm_only'
	}
	return out
}

function resolveDecklinkInputDeviceIndex(cfg, i) {
	const raw = readCasparSetting(cfg, `decklink_input_${i}_device`)
	if (raw === undefined || raw === null || raw === '' || raw === 0 || raw === '0') return i
	const n = parseInt(String(raw), 10); return Number.isFinite(n) && n > 0 ? n : i
}

function getRouteString(channel, layer) {
	return (layer !== undefined && layer !== null) ? `route://${channel}-${layer}` : `route://${channel}`
}

/**
 * Which Caspar channel should receive `ADD … STREAM` / `ADD … FILE` for streaming.
 * Default: the **existing** bus from topology (`mode: stream`) or {@link streamingChannel.videoSource} — not `nextCh++`
 * (which can point at a channel slot that was never generated on the server).
 * @param {Record<string, unknown>} config
 * @param {{ screenCount: number, programCh: (n: number) => number, previewCh: (n: number) => number|null, programChannels: number[], multiviewCh: number|null }} map
 * @param {Record<string, unknown>} sc - `streamingChannel`
 * @returns {{ kind: 'dedicated' } | { kind: 'attach', ch: number }}
 */
function resolveStreamOutputCasparChannel(config, map, sc) {
	const scObj = sc && typeof sc === 'object' ? sc : {}
	const rawA = scObj.casparChannel
	if (rawA != null && rawA !== '' && String(rawA).toLowerCase() !== 'dedicated') {
		const a = parseInt(String(rawA), 10)
		if (Number.isFinite(a) && a >= 1) return { kind: 'attach', ch: a }
	}
	if (scObj.dedicatedOutputChannel === true || scObj.dedicatedOutputChannel === 'true') {
		return { kind: 'dedicated' }
	}
	const top = config?.tandemTopology && typeof config.tandemTopology === 'object' ? config.tandemTopology : null
	const dests = Array.isArray(top?.destinations) ? top.destinations : []
	const streamDests = dests.filter((d) => d && String(d.mode || '') === 'stream')
	if (streamDests.length === 1) {
		const mainIdx = Math.max(0, parseInt(String(streamDests[0].mainScreenIndex ?? 0), 10) || 0)
		const ch = map.programChannels[mainIdx]
		if (ch != null) return { kind: 'attach', ch }
	}
	const rawVideo = String(scObj.videoSource || 'program_1').toLowerCase()
	if (rawVideo === 'multiview' && map.multiviewCh != null) return { kind: 'attach', ch: map.multiviewCh }
	const pm = rawVideo.match(/^program[_-]?(\d+)$/)
	if (pm) {
		const i = parseInt(pm[1], 10)
		if (i >= 1 && i <= map.screenCount) return { kind: 'attach', ch: map.programCh(i) }
	}
	const pr = rawVideo.match(/^preview[_-]?(\d+)$/)
	if (pr) {
		const i = parseInt(pr[1], 10)
		if (i >= 1 && i <= map.screenCount) {
			const p = map.previewCh(i)
			if (p != null) return { kind: 'attach', ch: p }
		}
	}
	return { kind: 'attach', ch: map.programCh(1) }
}

function getChannelMap(config, activeBuses = null) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const virtualMainChannels = Array.isArray(config?.virtual_main_channels) ? config.virtual_main_channels : (Array.isArray(cs?.virtual_main_channels) ? cs.virtual_main_channels : [])
	const useVirtual = virtualMainChannels.length > 0
	const screenCount = useVirtual ? Math.max(1, virtualMainChannels.length) : resolveMainScreenCount(config)
	const previewEnabledByMain = useVirtual ? Array.from({ length: screenCount }, (_, i) => { const v = virtualMainChannels[i] || {}; return !(v.prv == null || String(v.prv).trim() === '') })
		: resolvePreviewEnabledByMain(config, screenCount) || Array.from({ length: screenCount }, () => true)

	const mv = config?.multiview_enabled ?? cs.multiview_enabled
	const multiviewEnabled = mv !== false && mv !== 'false'
	const decklinkCount = Math.min(8, Math.max(0, parseInt(String(config?.decklink_input_count ?? cs.decklink_input_count ?? 0), 10) || 0))
	const inputsHostChannelEnabled = readCasparSetting(config, 'decklink_inputs_host_channel_enabled') === true || readCasparSetting(config, 'decklink_inputs_host_channel_enabled') === 'true'
	const inputsEnabled = decklinkCount > 0 || inputsHostChannelEnabled
	const extraAudioCount = Math.min(4, Math.max(0, parseInt(String(config?.extra_audio_channel_count ?? cs.extra_audio_channel_count ?? 0), 10) || 0))

	const programChannels = []; const previewChannels = []
	const switcherBus1Channels = []
	const switcherBusChannels = []
	// Switcher-bus (3-channel per destination) is retired.
	// Keep transition model forced to 2-channel PGM/PRV flow.
	const switcherBusMode = false
	if (useVirtual) {
		for (let i = 0; i < screenCount; i++) {
			const v = virtualMainChannels[i] || {}
			const pgm = parseInt(v.pgm, 10) || 1
			// When prv is empty/missing, preview is disabled for this main — do not default to pgm
			const prvRaw = v.prv != null && String(v.prv).trim() !== '' ? parseInt(v.prv, 10) : null
			const prv = prvRaw != null && Number.isFinite(prvRaw) && prvRaw >= 1 ? prvRaw : null
			programChannels.push(pgm)
			previewChannels.push(previewEnabledByMain[i] && prv != null ? prv : null)
			switcherBus1Channels.push(prv)
			switcherBusChannels.push(null)
		}
		// Warn about duplicate channel assignments in virtual mode
		const allAssigned = [...programChannels, ...previewChannels.filter(Boolean)]
		const seen = new Set()
		for (const ch of allAssigned) {
			if (seen.has(ch)) {
				if (typeof console !== 'undefined') console.warn(`[routing-map] Warning: duplicate channel number ${ch} in virtual main channel assignments`)
			}
			seen.add(ch)
		}
	} else {
		let ch = 1
		for (let i = 0; i < screenCount; i++) {
			if (switcherBusMode) {
				const out = ch++
				if (previewEnabledByMain[i]) {
					const bus1 = ch++
					const bus2 = ch++
					programChannels.push(out)
					previewChannels.push(bus1)
					switcherBus1Channels.push(bus1)
					switcherBusChannels.push(bus2)
				} else {
					programChannels.push(out)
					previewChannels.push(null)
					switcherBus1Channels.push(null)
					switcherBusChannels.push(null)
				}
			} else {
				const pgm = ch++
				const prv = previewEnabledByMain[i] ? ch++ : null
				programChannels.push(pgm)
				previewChannels.push(prv)
				switcherBus1Channels.push(prv)
				switcherBusChannels.push(null)
			}
		}
	}

	let nextCh = Math.max(0, ...programChannels, ...previewChannels.filter(c => c != null), ...switcherBusChannels.filter(c => c != null)) + 1
	
	const mvDests = Array.isArray(config?.tandemTopology?.destinations) 
		? config.tandemTopology.destinations.filter(d => d && String(d.mode || '').toLowerCase() === 'multiview')
		: []
	
	const multiviewChannels = []
	if (mvDests.length > 0) {
		mvDests.forEach(() => multiviewChannels.push(nextCh++))
	} else if (multiviewEnabled) {
		multiviewChannels.push(nextCh++)
	}
	const multiviewCh = multiviewChannels[0] || null
	const mvMode = String(readCasparSetting(config, 'multiview_mode') ?? '1080p5000')
	const inMode = String(readCasparSetting(config, 'inputs_channel_mode') ?? '1080p5000')
	const decklinkInputsHost = String(readCasparSetting(config, 'decklink_inputs_host') ?? 'multiview_if_match').toLowerCase()

	const inputsOnMvr = inputsEnabled && multiviewEnabled && multiviewCh != null && mvMode === inMode && decklinkInputsHost !== 'preview_1'
	let inputsCh = null; if (inputsEnabled) {
		if (decklinkInputsHost === 'preview_1') inputsCh = previewChannels[0] || 1
		else if (inputsOnMvr) inputsCh = multiviewCh
		else inputsCh = nextCh++
	}

	const audioOnlyChannels = []; for (let i = 0; i < extraAudioCount; i++) audioOnlyChannels.push(nextCh++)
	
	const mappingChannels = []
	const dg = config?.deviceGraph || {}
	const mappingNodes = (Array.isArray(dg.devices) ? dg.devices : []).filter(d => d.role === 'pixel_mapping')
	const edges = Array.isArray(dg.edges) ? dg.edges : []
	const connectors = Array.isArray(dg.connectors) ? dg.connectors : []

	mappingNodes.forEach(node => {
		const nodeConns = connectors.filter(c => c.deviceId === node.id && c.kind === 'pixel_map_out')
		nodeConns.forEach(conn => {
			// Is this output connected to something physical?
			const isCabled = edges.some(e => e.sourceId === conn.id)
			if (isCabled) {
				mappingChannels.push({ nodeId: node.id, connectorId: conn.id, ch: nextCh++ })
			}
		})
	})

	const monitorChannelEnabled = cs.monitor_channel_enabled === true || cs.monitor_channel_enabled === 'true'
	const monitorCh = monitorChannelEnabled ? nextCh++ : null

	const sc = config?.streamingChannel && typeof config.streamingChannel === 'object' ? config.streamingChannel : {}
	const mapSoFar = {
		screenCount,
		programCh: (n) => programChannels[n - 1] || programChannels[0],
		previewCh: (n) => {
			const idx = n - 1
			if (idx >= 0 && idx < previewChannels.length) {
				if (switcherBusMode && activeBuses) {
					const pgm = programChannels[idx]
					const active = Number(activeBuses[String(pgm)] || switcherBus1Channels[idx])
					const bus1 = Number(switcherBus1Channels[idx])
					const bus2 = Number(switcherBusChannels[idx])
					if (bus1 > 0 && bus2 > 0) return active === bus1 ? bus2 : bus1
				}
				return previewChannels[idx]
			}
			return null
		},
		programChannels,
		multiviewCh,
	}
	let streamingAttachToChannel = null
	let streamingCh = null
	let streamingDedicatedChannelSlot = false
	if (sc.enabled === true || sc.enabled === 'true') {
		const out = resolveStreamOutputCasparChannel(config, mapSoFar, sc)
		if (out.kind === 'dedicated') {
			streamingCh = nextCh++
			streamingDedicatedChannelSlot = true
		} else {
			streamingCh = out.ch
			streamingAttachToChannel = out.ch
		}
	}

	const result = {
		screenCount, multiviewEnabled, inputsEnabled, inputsOnMvr, decklinkInputsHost, decklinkCount,
		programCh: (n) => programChannels[n - 1] || programChannels[0],
		previewCh: (n) => {
			const idx = n - 1
			if (idx >= 0 && idx < previewChannels.length) {
				if (switcherBusMode && activeBuses) {
					const pgm = programChannels[idx]
					const active = Number(activeBuses[String(pgm)] || switcherBus1Channels[idx])
					const bus1 = Number(switcherBus1Channels[idx])
					const bus2 = Number(switcherBusChannels[idx])
					if (bus1 > 0 && bus2 > 0) return active === bus1 ? bus2 : bus1
				}
				return previewChannels[idx]
			}
			return null
		},
		programChannels, previewChannels, 
		playbackChannels: switcherBusMode ? switcherBus1Channels : programChannels,
		previewEnabledByMain, multiviewCh, inputsCh, audioOnlyChannels,
		mappingChannels,
		monitorCh,
		switcherBus1Channels,
		switcherBusMode,
		switcherBusChannels,
		transitionModel: switcherBusMode ? 'switcher_bus' : 'dynamic_layer',
		streamingCh,
		streamingDedicatedChannelSlot: streamingCh != null && streamingDedicatedChannelSlot,
		streamingAttachToChannel,
		streamingContentLayer: Math.max(1, parseInt(String(sc.contentLayer ?? 10), 10) || 10),
		inputsHostChannelEnabled, useVirtual, virtualMainChannels,
		multiviewChannels
	}

	return result
}

function resolveStreamingChannelRouteForRole(config, role = 'video') {
	const map = getChannelMap(config); if (map.streamingCh == null) return null
	const sc = config?.streamingChannel && typeof config.streamingChannel === 'object' ? config.streamingChannel : {}
	const rawVideo = String(sc.videoSource || 'program_1').toLowerCase()
	let src = rawVideo
	if (role === 'audio') {
		const rawAudio = String(sc.audioSource == null || sc.audioSource === '' ? 'follow_video' : sc.audioSource).trim().toLowerCase()
		src = (rawAudio === 'follow_video' || rawAudio === 'follow') ? rawVideo : rawAudio
	}
	if (src === 'multiview' && map.multiviewCh != null) return getRouteString(map.multiviewCh)
	const pm = src.match(/^program[_-]?(\d+)$/); if (pm) { const i = parseInt(pm[1], 10); if (i >= 1 && i <= map.screenCount) return getRouteString(map.programCh(i)) }
	const pr = src.match(/^preview[_-]?(\d+)$/); if (pr) { const i = parseInt(pr[1], 10); if (i >= 1 && i <= map.screenCount) return getRouteString(map.previewCh(i)) }
	return getRouteString(map.programCh(1))
}

module.exports = {
	getChannelMap,
	getRouteString,
	resolveMainScreenCount,
	resolvePreviewEnabledByMain,
	resolveStreamOutputCasparChannel,
	resolveDecklinkInputDeviceIndex,
	readCasparSetting,
	resolveStreamingChannelRoute: (config) => resolveStreamingChannelRouteForRole(config, 'video'),
	resolveStreamingChannelRouteForRole,
}
