/**
 * Channel routing map and data resolution logic.
 */
'use strict'

const { resolveOutputSourceToChannel } = require('./output-source-name')
const { resolveMonitorBus } = require('./monitor-bus')

const { routingDestinationsFromConfig, screenLabelsFromConfig } = require('./screen-destinations')

function readCasparSetting(cfg, key) {
	if (!cfg || typeof cfg !== 'object') return undefined
	const cs = cfg.casparServer && typeof cfg.casparServer === 'object' ? cfg.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	if (Object.prototype.hasOwnProperty.call(cfg, key)) return cfg[key]
	return undefined
}

/**
 * Does this destination `mode` occupy a `mainScreenIndex` PGM/PRV bus slot?
 *
 * `multiview`, `stream` and `operator_gui` are dedicated utility channels allocated on their own
 * (see {@link getChannelMap}'s multiview/operatorGui blocks) — they carry a `mainScreenIndex` only
 * as a monitor-placement hint, never as a claim on a PGM/PRV pair.
 * @param {unknown} mode
 * @returns {boolean}
 */
// Canonical definition moved to screen-destinations.js (this module already imports from there;
// the reverse would be a cycle). Kept in module.exports so existing importers are untouched.
const { isMainBusDestinationMode } = require('./screen-destinations')

function inferGraphMainUsage(config) {
	const out = {
		maxMainCount: 0,
		pgmOnlyMainIndices: new Set(),
	}
	const graph = config?.deviceGraph
	if (!graph || !Array.isArray(graph.edges) || !Array.isArray(graph.connectors)) return out
	const byConnId = new Map(graph.connectors.map((c) => [String(c?.id || ''), c]))
	for (const e of graph.edges) {
		const srcId = String(e?.sourceId || '')
		if (!srcId) continue
		const m = srcId.match(/^dst_ch(\d+)$/i)
		if (m) {
			const n = parseInt(m[1], 10)
			if (Number.isFinite(n) && n >= 1) {
				out.maxMainCount = Math.max(out.maxMainCount, n)
				out.pgmOnlyMainIndices.add(n - 1)
			}
			continue
		}
		const srcConn = byConnId.get(srcId)
		if (!srcConn || srcConn.kind !== 'destination_in') continue
		const ref = String(srcConn.externalRef || '').trim()
		if (!ref) continue
		const topDests = routingDestinationsFromConfig(config) ?? []
		const match = topDests.find((d) => String(d?.id || '') === ref)
		if (!match) continue
		// WO-274: resolveMainScreenCount deliberately filters multiview/stream/operator_gui out of
		// `routableDests`, then re-admits whatever this function counted via
		// `Math.max(..., graphMainUsage.maxMainCount)`. Without the same filter here, merely *cabling*
		// a multiview/stream/operator_gui destination (e.g. multiview → DeckLink) inflated the screen
		// count and generated a phantom PGM+PRV channel pair for a screen index that has no PGM/PRV
		// destination behind it — channels that are never routed to and never shown in the GUI.
		if (!isMainBusDestinationMode(match.mode)) continue
		const idx = Math.max(0, parseInt(String(match.mainScreenIndex ?? 0), 10) || 0)
		out.maxMainCount = Math.max(out.maxMainCount, idx + 1)
	}
	return out
}

function resolveMainScreenCount(config) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	const a = parseInt(String(config?.screen_count ?? ''), 10); const b = parseInt(String(cs?.screen_count ?? ''), 10)
	const nA = Number.isFinite(a) && a >= 1 ? a : 1
	const nB = Number.isFinite(b) && b >= 1 ? b : 1
	const graphMainUsage = inferGraphMainUsage(config)
	const routedDests = routingDestinationsFromConfig(config)
	if (routedDests === null) {
		return Math.max(1, Math.max(nA, nB, graphMainUsage.maxMainCount))
	}
	if (routedDests.length === 0) {
		/* A blank slate generates NO channels. Every other path here keeps a floor of 1, and this one
		 * used to as well, so a factory-reset box (destinations: [], no edges) still emitted a
		 * Screen 1 PGM + PRV pair that nothing routed to — the owner reads that as a leftover, and
		 * it is: there is no destination behind it.
		 *
		 * Scoped deliberately to "no destinations AT ALL". The `routedDests === null` path above
		 * means the config predates the destinations key entirely, and must keep its floor or every
		 * legacy config loses its channels. The "destinations exist but none are main" path below
		 * also keeps its floor — an operator-GUI-only project still gets a phantom PGM+PRV pair, a
		 * separate question I have not decided unilaterally. */
		return graphMainUsage.maxMainCount
	}
	// WO-243: operator_gui is a dedicated utility channel (like multiview) — it never occupies a
	// mainScreenIndex/programChannels slot. Same predicate is applied in inferGraphMainUsage (WO-274).
	const routableDests = routedDests.filter((d) => isMainBusDestinationMode(d?.mode))
	// When destinations exist, drive screen count from topology only — stale casparServer.screen_count must not spawn extra PGM/PRV pairs.
	if (routableDests.length > 0) {
		const fromDest = Math.max(
			...routableDests.map((d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) + 1)
		)
		return Math.max(1, fromDest, graphMainUsage.maxMainCount)
	}
	/* Destinations exist but none are PGM/PRV mains — only multiview / stream / operator_gui. This
	 * used to force one main bus, which invented a Screen 1 PGM+PRV pair that no destination stood
	 * behind: owner, with a single operator_gui destination configured, "i still get the stale
	 * pgm/prv channels in the casparcg config". Main channels now exist only when a main destination
	 * does, same rule as the empty-destinations path above. */
	return graphMainUsage.maxMainCount
}

function resolvePreviewEnabledByMain(config, screenCount) {
	const dests = routingDestinationsFromConfig(config) ?? []
	const graphMainUsage = inferGraphMainUsage(config)
	const withMode = dests.filter((d) => isMainBusDestinationMode(d?.mode))
	if (!withMode.length) {
		return Array.from({ length: screenCount }, (_, idx) => !graphMainUsage.pgmOnlyMainIndices.has(idx))
	}
	const out = Array.from({ length: screenCount }, () => true)
	for (let idx = 0; idx < screenCount; idx++) {
		const perMain = withMode.filter(d => (parseInt(String(d.mainScreenIndex ?? 0), 10) || 0) === idx)
		if (!perMain.length) {
			if (graphMainUsage.pgmOnlyMainIndices.has(idx)) out[idx] = false
			continue
		}
		const picked = perMain.find(d => String(d.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]
		// WO-242: pixelmap screens are PGM-only (native <artnet> consumer channel), same as pgm_only —
		// no PRV bus is allocated (routing-map.js previewChannels[idx] stays null for them).
		const pickedMode = String(picked.mode || 'pgm_prv')
		out[idx] = pickedMode !== 'pgm_only' && pickedMode !== 'pixelmap'
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
	const dests = routingDestinationsFromConfig(config) ?? []
	const streamDests = dests.filter((d) => d && String(d.mode || '') === 'stream')
	if (streamDests.length === 1) {
		const mainIdx = Math.max(0, parseInt(String(streamDests[0].mainScreenIndex ?? 0), 10) || 0)
		const ch = map.programChannels[mainIdx]
		if (ch != null) return { kind: 'attach', ch }
	}
	/* WO-378: shared vocabulary — a stream can now be fed by `channel_<N>` (any Caspar channel,
	 * including a cabled host channel), not only by the screen buses. */
	const resolved = resolveOutputSourceToChannel(map, scObj.videoSource || 'program_1')
	if (resolved != null) return { kind: 'attach', ch: resolved }
	return { kind: 'attach', ch: map.programCh(1) }
}

function getChannelMap(config, activeBuses = null) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const virtualMainChannels = Array.isArray(config?.virtual_main_channels) ? config.virtual_main_channels : (Array.isArray(cs?.virtual_main_channels) ? cs.virtual_main_channels : [])
	const useVirtual = virtualMainChannels.length > 0
	const screenCount = useVirtual ? Math.max(1, virtualMainChannels.length) : resolveMainScreenCount(config)
	const previewEnabledByMain = useVirtual ? Array.from({ length: screenCount }, (_, i) => { const v = virtualMainChannels[i] || {}; return !(v.prv == null || String(v.prv).trim() === '') })
		: resolvePreviewEnabledByMain(config, screenCount) || Array.from({ length: screenCount }, () => true)

	const decklinkCount = Math.min(8, Math.max(0, parseInt(String(config?.decklink_input_count ?? cs.decklink_input_count ?? 0), 10) || 0))
	const { resolveDecklinkInputSlots } = require('./decklink-input-slots')
	const decklinkInputSlots = resolveDecklinkInputSlots(config)
	const liveAudioCount = Math.min(8, Math.max(0, parseInt(String(config?.live_audio_input_count ?? cs.live_audio_input_count ?? 0), 10) || 0))
	const v4l2InputCount = Math.min(8, Math.max(0, parseInt(String(config?.v4l2_input_count ?? cs.v4l2_input_count ?? 0), 10) || 0))
	const inputsHostChannelEnabled =
		readCasparSetting(config, 'decklink_inputs_host_channel_enabled') === true ||
		readCasparSetting(config, 'decklink_inputs_host_channel_enabled') === 'true' ||
		readCasparSetting(config, 'live_audio_inputs_host_channel_enabled') === true ||
		readCasparSetting(config, 'live_audio_inputs_host_channel_enabled') === 'true'
	const inputsEnabled = decklinkInputSlots.length > 0 || liveAudioCount > 0 || v4l2InputCount > 0 || inputsHostChannelEnabled
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
	// WO-414: stored host-live sources PIN their channel (pins never move, WO-377/381), so
	// dynamic allocation flows AROUND them — the monitor bus landing on the NDI host's pinned
	// ch5 gave two owners one channel (generator clobbered the NDI block; the mixer metered
	// monitor-bus audio as "macbook NDI input"). Lazy require: circular with this module.
	const hostLive = require('./host-live-sources')
	const pinnedHostChannels = new Set(hostLive.listHostLiveChannelEntries(config).map((e) => e.channel))
	const allocCh = () => { while (pinnedHostChannels.has(nextCh)) nextCh++; return nextCh++ }

	const mvDests = (routingDestinationsFromConfig(config) ?? []).filter((d) => d && String(d.mode || '').toLowerCase() === 'multiview')
	
	const multiviewChannels = []
	if (mvDests.length > 0) {
		mvDests.forEach(() => multiviewChannels.push(allocCh()))
	}
	const multiviewCh = multiviewChannels[0] || null

	// WO-243: operator_gui is a dedicated utility channel (CEF web-UI over routed preview holes),
	// allocated the same way as multiview — never a programChannels[] slot. At most one is expected
	// (validated in device-view-crud.js), but this mirrors multiview's array shape defensively.
	const ogDests = (routingDestinationsFromConfig(config) ?? []).filter((d) => d && String(d.mode || '').toLowerCase() === 'operator_gui')
	const operatorGuiChannels = []
	if (ogDests.length > 0) {
		ogDests.forEach(() => operatorGuiChannels.push(allocCh()))
	}
	const operatorGuiCh = operatorGuiChannels[0] || null
	const decklinkInputsHost = String(readCasparSetting(config, 'decklink_inputs_host') ?? 'multiview_if_match').toLowerCase()

	// WO-53: each live input gets its own Caspar channel so its audio meter is isolated (channel-level
	// OSC meter == one input). DeckLink inputs get a full-quality channel (inputs_channel_mode); the
	// DeckLink plays at layer = slot. Audio-only (ALSA) inputs get a cheap channel (lowest standard
	// mode); ALSA plays at LIVE_AUDIO_INPUT_LAYER. Inputs are no longer bundled onto a shared host.
	const _modes = require('./config-modes')
	const decklinkInputModeRaw = String(readCasparSetting(config, 'inputs_channel_mode') ?? '1080p5000').trim()
	const decklinkInputMode = _modes.STANDARD_VIDEO_MODES[decklinkInputModeRaw] ? decklinkInputModeRaw : '1080p5000'
	const v4l2InputModeRaw = String(
		readCasparSetting(config, 'v4l2_input_channel_mode') || readCasparSetting(config, 'inputs_channel_mode') || '1080p5000',
	).trim()
	const v4l2InputMode = _modes.STANDARD_VIDEO_MODES[v4l2InputModeRaw] ? v4l2InputModeRaw : decklinkInputMode
	const liveAudioInputMode = _modes.resolveLiveAudioInputChannelMode(config)
	const LIVE_AUDIO_INPUT_LAYER = 10
	const V4L2_HOST_LAYER = 1

	const inputsOnMvr = false // WO-53: inputs are never bundled onto the MVR/preview host channel.
	const inputChannels = []
	const decklinkInputChannels = []
	for (const i of decklinkInputSlots) {
		const channel = allocCh()
		decklinkInputChannels.push(channel)
		inputChannels.push({
			kind: 'decklink',
			slot: i,
			channel,
			layer: i,
			mode: decklinkInputMode,
			route: getRouteString(channel, i),
			label: `DeckLink ${i}`,
		})
	}
	const effectiveDecklinkInputCount = decklinkInputChannels.length
	const liveAudioInputChannels = []
	for (let i = 1; i <= liveAudioCount; i++) {
		const channel = allocCh()
		liveAudioInputChannels.push(channel)
		inputChannels.push({
			kind: 'live_audio',
			slot: i,
			channel,
			layer: LIVE_AUDIO_INPUT_LAYER,
			mode: liveAudioInputMode,
			route: getRouteString(channel),
			label: `Live audio ${i}`,
		})
	}
	const v4l2InputChannels = []
	for (let i = 1; i <= v4l2InputCount; i++) {
		const channel = allocCh()
		v4l2InputChannels.push(channel)
		inputChannels.push({
			kind: 'v4l2',
			slot: i,
			channel,
			layer: V4L2_HOST_LAYER,
			mode: v4l2InputMode,
			route: getRouteString(channel, V4L2_HOST_LAYER),
			label: String(readCasparSetting(config, `v4l2_input_${i}_label`) || `USB video ${i}`).trim() || `USB video ${i}`,
		})
	}
	// Legacy: explicit empty inputs-host toggle with no real inputs configured.
	let legacyHostCh = null
	if (inputsHostChannelEnabled && decklinkCount === 0 && liveAudioCount === 0 && v4l2InputCount === 0) legacyHostCh = allocCh()
	const inputsCh = decklinkInputChannels[0] ?? liveAudioInputChannels[0] ?? v4l2InputChannels[0] ?? legacyHostCh ?? null

	const audioOnlyChannels = []; for (let i = 0; i < extraAudioCount; i++) audioOnlyChannels.push(allocCh())

	/** @deprecated Always empty — pixel-map DeckLink routing is merged onto the program channel in generated Caspar XML. */
	const mappingChannels = []

	const monitorCh = resolveMonitorBus(config).enabled ? allocCh() : null

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
		operatorGuiCh,
	}
	let streamingAttachToChannel = null
	let streamingCh = null
	let streamingDedicatedChannelSlot = false
	if (sc.enabled === true || sc.enabled === 'true') {
		const out = resolveStreamOutputCasparChannel(config, mapSoFar, sc)
		if (out.kind === 'dedicated') {
			streamingCh = allocCh()
			streamingDedicatedChannelSlot = true
		} else {
			streamingCh = out.ch
			streamingAttachToChannel = out.ch
		}
	}

	const hostMerge = hostLive.mergeHostLiveChannelsIntoRouting(config, nextCh)
	for (const entry of hostMerge.entries) {
		inputChannels.push({
			kind: entry.kind,
			slot: 0,
			channel: entry.channel,
			layer: entry.layer,
			mode: entry.mode,
			route: entry.route,
			label: entry.label,
			sourceId: entry.sourceId,
		})
	}
	nextCh = hostMerge.nextCh

	const result = {
		screenCount,
		/** WO-385: the owning destination's label IS the screen name (stored array only as fallback). */
		screenLabels: screenLabelsFromConfig(config, screenCount),
		/** True only when at least one multiview Caspar channel is allocated (topology includes a multiview destination). */
		multiviewEnabled: multiviewChannels.length > 0,
		/** WO-243: true only when an operator_gui destination is allocated a Caspar channel. */
		operatorGuiEnabled: operatorGuiChannels.length > 0,
		operatorGuiCh,
		operatorGuiChannels,
		inputsEnabled: effectiveDecklinkInputCount > 0 || liveAudioCount > 0 || v4l2InputCount > 0 || inputsHostChannelEnabled,
		inputsOnMvr,
		decklinkInputsHost,
		decklinkCount: effectiveDecklinkInputCount,
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
		inputsHostChannelEnabled,
		liveAudioCount,
		v4l2InputCount,
		useVirtual,
		virtualMainChannels,
		multiviewChannels,
		inputChannels,
		decklinkInputChannels,
		liveAudioInputChannels,
		v4l2InputChannels,
		decklinkInputMode,
		liveAudioInputMode,
		v4l2InputMode,
		hostLiveChannels: hostMerge.entries,
		webpageHostChannels: hostMerge.entries.filter((e) => e.kind === 'webpage_host').map((e) => e.channel),
		ndiHostChannels: hostMerge.entries.filter((e) => e.kind === 'ndi_host').map((e) => e.channel),
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
	isMainBusDestinationMode,
	resolveStreamOutputCasparChannel,
	resolveDecklinkInputDeviceIndex,
	readCasparSetting,
	resolveStreamingChannelRoute: (config) => resolveStreamingChannelRouteForRole(config, 'video'),
	resolveStreamingChannelRouteForRole,
}
