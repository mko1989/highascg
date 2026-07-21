'use strict'

const defaults = require('./defaults')
const { mergeAudioRoutingIntoConfig } = require('./config-generator')
const { normalizeRtmpConfig } = require('./rtmp-output')
const { resolveMainScreenCount } = require('./routing')
const { isMainBusDestinationMode } = require('./routing-map')
const { STANDARD_VIDEO_MODES, normalizeVideoModeId } = require('./config-modes')
const { normalizeScreenDestinations, destinationsFromConfig } = require('./screen-destinations')
const { applyPixelMappingProgramScreens } = require('./pixel-mapping-config')
const { applyStreamRecordMappingsFromGraph } = require('./device-graph-output-mapping')
const { isDecklinkIoOut } = require('./decklink-io-direction')
const {
	reachesGpuFromSource,
	createDestinationWiringContext,
	destinationSourceIds,
	applyMultiviewOutputOverridesFromCabling,
} = require('./device-graph-destination-wiring')
const {
	parseDecklinkDeviceIndex,
	readDecklinkKeyFillFromConnectorCaspar,
	writeDecklinkKeyFillToCasparServer,
	applyDecklinkConsumerSettingsFromConnector,
} = require('./decklink-key-fill')
const { channelCountFromLayout, normalizeProgramLayout, maxProgramLayout } = require('./audio-channel-layouts')
const { destinationAudioLayoutsByMain } = require('./screen-destinations')
const {
	getDestinationList,
	parseCustomVideoModeString,
} = require('./build-caspar-generator-destination-utils')
const {
	copyLegacyScreenAndMultiviewSettings,
	applyLayoutPositionsToMerged,
} = require('./build-caspar-generator-layout-sync')

/**
 * Owner spec (todos21.07.26): an NDI stream output "should not have a start stream but be treated
 * as an sdi out, it gets added as a screen consumer in the config and is on always without any
 * settings other than changing the id/label".
 *
 * So: for every enabled `type: 'ndi'` entry in streamOutputs that is CABLED from a main
 * destination in the device graph (edge dst_in_<destId> ↔ <outputId>), collect its name onto that
 * destination's screen as `screen_${n}_ndi_stream_names`. config-generator-consumer-attach.js
 * emits one `<ndi>` consumer per name, right next to the existing per-screen
 * `screen_${n}_ndi_enabled` block — same consumer, different source of truth. No runtime process
 * and no Start button: the consumer lives in casparcg.config and is on for as long as Caspar runs.
 * @param {Record<string, unknown>} merged flat generator config (mutated)
 * @param {Record<string, unknown>} appConfig
 */
function applyNdiStreamOutputsToScreens(merged, appConfig) {
	const outputs = Array.isArray(appConfig?.streamOutputs) ? appConfig.streamOutputs : []
	const ndiOutputs = outputs.filter(
		(o) => o && String(o.type || '').toLowerCase() === 'ndi' && o.enabled !== false,
	)
	if (!ndiOutputs.length) return
	const graph = appConfig?.deviceGraph
	const edges = Array.isArray(graph?.edges) ? graph.edges : []
	const dests = getDestinationList(appConfig)

	for (const out of ndiOutputs) {
		const outId = String(out.id || '').trim()
		if (!outId) continue
		// Cables are stored dst_in_<destId> → <outputId> today, but match both directions — the
		// graph editor has produced either depending on which end the operator grabbed first.
		const edge = edges.find(
			(e) =>
				(String(e?.sinkId || '') === outId && String(e?.sourceId || '').startsWith('dst_in_')) ||
				(String(e?.sourceId || '') === outId && String(e?.sinkId || '').startsWith('dst_in_')),
		)
		if (!edge) continue
		const destInId = String(edge.sinkId || '') === outId ? String(edge.sourceId || '') : String(edge.sinkId || '')
		const destId = destInId.slice('dst_in_'.length)
		const dest = dests.find((d) => String(d?.id || '') === destId)
		if (!dest || !isMainBusDestinationMode(dest.mode)) continue
		const n = Math.max(1, (parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0) + 1)
		const key = `screen_${n}_ndi_stream_names`
		const list = Array.isArray(merged[key]) ? merged[key] : (merged[key] = [])
		const name = String(out.name || out.label || outId).trim() || outId
		if (!list.includes(name)) list.push(name)
	}
}

/**
 * Project destination panel state into Caspar generator screen settings.
 * Priority: destination `videoMode` when standard, otherwise destination `width/height/fps` as custom mode.
 * @param {Record<string, unknown>} merged
 * @param {Record<string, unknown>} appConfig
 */
function applyDestinationOverridesToScreens(merged, appConfig) {
	const rawList = destinationsFromConfig(appConfig || {})
	const list = getDestinationList(appConfig)
	if (!list.length) return
	// WO-274: must match routing-map's main-bus predicate exactly. This filter previously omitted
	// `operator_gui`, so an operator GUI destination parked on a high mainScreenIndex pushed
	// `merged.screen_count` past the real PGM/PRV count that resolveMainScreenCount had just computed.
	const routable = list.filter((d) => isMainBusDestinationMode(d?.mode))
	if (!routable.length) return
	const mainIdxs = routable.map((d) => Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0))
	const dstCount = Math.max(...mainIdxs, 0) + 1
	merged.screen_count = Math.max(1, dstCount)

	const hasPanelOverrides = rawList.some(
		(d) => d && typeof d === 'object' && ('mode' in d || 'videoMode' in d || 'width' in d || 'height' in d || 'fps' in d)
	)
	if (!hasPanelOverrides) return
	for (let idx = 0; idx < merged.screen_count; idx++) {
		const perMain = routable.filter((d) => (parseInt(String(d.mainScreenIndex ?? 0), 10) || 0) === idx)
		if (!perMain.length) continue
		const picked = perMain.find((d) => d.videoMode && d.videoMode !== '1080p5000') || perMain.find((d) => String(d.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]
		const modeRaw = String(picked.videoMode || '').trim()
		const width = Math.max(64, parseInt(String(picked.width ?? 0), 10) || 0)
		const height = Math.max(64, parseInt(String(picked.height ?? 0), 10) || 0)
		const fps = Math.max(1, parseFloat(String(picked.fps ?? 50)) || 50)
		const n = idx + 1
		// Normalize mode aliases (e.g. '1080p50' → '1080p5000') and check if standard
		const normalized = modeRaw ? normalizeVideoModeId(modeRaw) : ''
		if (normalized && STANDARD_VIDEO_MODES[normalized]) {
			merged[`screen_${n}_mode`] = normalized
			continue
		}
		const customFromMode = parseCustomVideoModeString(modeRaw)
		if (customFromMode) {
			merged[`screen_${n}_mode`] = 'custom'
			merged[`screen_${n}_custom_width`] = customFromMode.w
			merged[`screen_${n}_custom_height`] = customFromMode.h
			merged[`screen_${n}_custom_fps`] = customFromMode.fps
			continue
		}
		if (width > 0 && height > 0) {
			merged[`screen_${n}_mode`] = 'custom'
			merged[`screen_${n}_custom_width`] = width
			merged[`screen_${n}_custom_height`] = height
			merged[`screen_${n}_custom_fps`] = fps
		}
	}
}

function applyDecklinkOverridesToScreens(merged, appConfig) {
	const g = appConfig?.deviceGraph
	if (!g || !Array.isArray(g.connectors)) return

	const edges = Array.isArray(g.edges) ? g.edges : []
	const destinations = destinationsFromConfig(appConfig || {})
	const byId = new Map(g.connectors.map((c) => [String(c?.id || ''), c]))
	const outgoing = new Map()
	for (const e of edges) {
		const src = String(e?.sourceId || '')
		if (!src) continue
		if (!outgoing.has(src)) outgoing.set(src, [])
		outgoing.get(src).push(String(e?.sinkId || ''))
	}

	function applyDecklinkKeyFillFromConnector(merged, prefix, connector) {
		const keyFill = readDecklinkKeyFillFromConnectorCaspar(connector?.caspar)
		if (!keyFill.enabled) return
		writeDecklinkKeyFillToCasparServer(merged, prefix, {
			fillDevice: parseDecklinkDeviceIndex(connector?.externalRef),
			keyDevice: keyFill.keyDevice,
			keyer: keyFill.keyer,
		})
	}

	function resolveDestinationSourceForConnector(sourceId) {
		const seen = new Set()
		const queue = [String(sourceId || '')]
		while (queue.length) {
			const cur = queue.shift()
			if (!cur || seen.has(cur)) continue
			seen.add(cur)
			if (cur.startsWith('dst_in_') || cur.startsWith('dst_ch') || cur.startsWith('dst_mv') || cur.startsWith('caspar_pgm_') || cur === 'caspar_mv_out') return cur
			const conn = byId.get(cur)
			if (conn?.kind === 'destination_in') {
				const did = String(conn.externalRef || '').trim()
				if (did) return `dst_in_${did}`
			}
			// Pixel mapping passthrough: input of same node can feed all node outputs.
			if (conn?.kind === 'pixel_map_out') {
				const nodeId = String(conn.deviceId || '')
				const nodeInputs = g.connectors.filter((c) => String(c?.deviceId || '') === nodeId && c?.kind === 'pixel_map_in')
				for (const ni of nodeInputs) {
					const inEdges = edges.filter((e) => String(e?.sinkId || '') === String(ni?.id || ''))
					for (const ie of inEdges) queue.push(String(ie?.sourceId || ''))
				}
			}
		}
		return ''
	}

	/**
	 * WO-275: this projection is additive — `merged` is seeded from the persisted `casparServer`
	 * blob, so a `screen_N_decklink_device` written by an *earlier* binding survives forever once
	 * the operator re-cables that physical DeckLink to a different destination. The graph is the
	 * source of truth, so before claiming `devNum` for a target, drop every other target still
	 * pointing at the same device. Without this, rebinding DeckLink 3 from "PGM 2" to "Multiview"
	 * left `screen_2_decklink_device: 3` in place and the generator emitted TWO `<decklink>`
	 * consumers on device 3 (one under the PGM 2 channel, one under multiview) — Caspar opens the
	 * screen one first, so the output kept showing PGM 2 across restarts.
	 * @param {number} devNum
	 * @param {'multiview' | number} keep - target that legitimately owns `devNum`
	 */
	function releaseDecklinkDeviceFromOtherTargets(devNum, keep) {
		if (!Number.isFinite(devNum) || devNum <= 0) return
		// Scan the full 1..16 screen key space, not just `merged.screen_count` — a stale binding on a
		// screen index that no longer exists still has to be cleared out of the flat config.
		for (let n = 1; n <= 16; n++) {
			if (keep === n) continue
			const cur = parseInt(String(merged[`screen_${n}_decklink_device`] || '0'), 10) || 0
			if (cur !== devNum) continue
			// Tiled (LED-wall) screens own the device through `screen_N_decklink_tiles`, not this key —
			// assignDecklinkToScreen refuses to touch them, so releasing them here would be inconsistent.
			const tiles = merged[`screen_${n}_decklink_tiles`]
			if (Array.isArray(tiles) && tiles.length > 0) continue
			merged[`screen_${n}_decklink_device`] = 0
			merged[`screen_${n}_decklink_key_device`] = 0
			merged[`screen_${n}_decklink_replace_screen`] = false
		}
		if (keep !== 'multiview') {
			const mv = parseInt(String(merged.multiview_decklink_device || '0'), 10) || 0
			if (mv === devNum) {
				merged.multiview_decklink_device = 0
				merged.multiview_decklink_key_device = 0
			}
		}
	}

	function assignDecklinkToScreen(n, devNum, connector) {
		const existingTiles = merged[`screen_${n}_decklink_tiles`]
		if (Array.isArray(existingTiles) && existingTiles.length > 0) return
		releaseDecklinkDeviceFromOtherTargets(devNum, n)
		merged[`screen_${n}_decklink_device`] = devNum
		if (merged[`screen_${n}_decklink_replace_screen`] === undefined) {
			merged[`screen_${n}_decklink_replace_screen`] = true
		}
		applyDecklinkKeyFillFromConnector(merged, `screen_${n}_`, connector)
		applyDecklinkConsumerSettingsFromConnector(merged, `screen_${n}_`, connector)
	}

	g.connectors.forEach((c) => {
		if (c.kind !== 'decklink_io' && c.kind !== 'decklink_out') return
		const devNum = parseInt(String(c.externalRef || ''), 10)
		if (!Number.isFinite(devNum) || devNum <= 0) return

		const incomingEdge = edges.find((e) => e.sinkId === c.id)
		if (!incomingEdge) {
			// Fallback to legacy binding if no cable exists
			if (c.kind === 'decklink_io' && !isDecklinkIoOut(c)) return
			const binding = c.caspar?.outputBinding
			if (binding?.type === 'screen') {
				const n = Math.min(8, Math.max(1, parseInt(String(binding.index ?? 1), 10) || 1))
				assignDecklinkToScreen(n, devNum, c)
			} else if (binding?.type === 'multiview') {
				releaseDecklinkDeviceFromOtherTargets(devNum, 'multiview')
				merged.multiview_decklink_device = devNum
				applyDecklinkKeyFillFromConnector(merged, 'multiview_', c)
				applyDecklinkConsumerSettingsFromConnector(merged, 'multiview_', c)
			}
			return
		}

		const sourceId = resolveDestinationSourceForConnector(String(incomingEdge.sourceId || ''))
		
		if (sourceId.startsWith('dst_in_') || sourceId.startsWith('dst_ch')) {
			// Cabled to a Destination feed
			let dest = null
			if (sourceId.startsWith('dst_in_')) {
				const destId = sourceId.slice('dst_in_'.length)
				dest = destinations.find((d) => String(d.id) === destId)
			} else {
				const n = parseInt(sourceId.slice('dst_ch'.length), 10)
				if (Number.isFinite(n) && n >= 1) {
					const idx = n - 1
					dest = destinations.find((d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) === idx)
				}
			}
			if (!dest) return
			if (String(dest.mode || '') === 'multiview') {
				releaseDecklinkDeviceFromOtherTargets(devNum, 'multiview')
				merged.multiview_decklink_device = devNum
				applyDecklinkKeyFillFromConnector(merged, 'multiview_', c)
				applyDecklinkConsumerSettingsFromConnector(merged, 'multiview_', c)
			} else {
				const idx = Number.isFinite(Number(dest.mainScreenIndex)) ? Number(dest.mainScreenIndex) : 0
				const n = idx + 1
				assignDecklinkToScreen(n, devNum, c)
			}
		} else if (sourceId.startsWith('caspar_pgm_')) {
			// Cabled directly to a raw Caspar Program output
			const idx = parseInt(sourceId.slice('caspar_pgm_'.length), 10) - 1
			const n = idx + 1
			if (n > 0) assignDecklinkToScreen(n, devNum, c)
		} else if (sourceId === 'caspar_mv_out') {
			releaseDecklinkDeviceFromOtherTargets(devNum, 'multiview')
			merged.multiview_decklink_device = devNum
			applyDecklinkKeyFillFromConnector(merged, 'multiview_', c)
			applyDecklinkConsumerSettingsFromConnector(merged, 'multiview_', c)
		}
	})
}

/**
 * Project multiview destination panel videoMode into `multiview_mode` for generator + channel plan.
 * @param {Record<string, unknown>} merged
 * @param {Record<string, unknown>} appConfig
 */
function applyMultiviewDestinationOverrides(merged, appConfig) {
	const list = destinationsFromConfig(appConfig || {})
	const mvDest = list.find((d) => d && String(d.mode || '') === 'multiview')
	if (!mvDest) return

	const modeRaw = String(mvDest.videoMode || '').trim()
	const width = Math.max(64, parseInt(String(mvDest.width ?? 0), 10) || 0)
	const height = Math.max(64, parseInt(String(mvDest.height ?? 0), 10) || 0)
	const fps = Math.max(1, parseFloat(String(mvDest.fps ?? 50)) || 50)

	if (modeRaw && STANDARD_VIDEO_MODES[modeRaw]) {
		merged.multiview_mode = modeRaw
		return
	}
	const customFromMode = parseCustomVideoModeString(modeRaw)
	if (customFromMode) {
		merged.multiview_mode = 'custom'
		merged.multiview_custom_width = customFromMode.w
		merged.multiview_custom_height = customFromMode.h
		merged.multiview_custom_fps = customFromMode.fps
		return
	}
	if (width > 0 && height > 0) {
		merged.multiview_mode = 'custom'
		merged.multiview_custom_width = width
		merged.multiview_custom_height = height
		merged.multiview_custom_fps = fps
	}
}

function applyScreenConsumerOverridesFromCabling(merged, appConfig) {
	const destinations = destinationsFromConfig(appConfig || {})
	const ctx = createDestinationWiringContext(appConfig)
	if (!ctx.g.connectors?.length || !destinations.length) return

	for (const dest of destinations) {
		const mode = String(dest?.mode || 'pgm_prv')
		if (mode === 'multiview' || mode === 'stream') continue
		const idx = Math.max(0, parseInt(String(dest?.mainScreenIndex ?? 0), 10) || 0)
		const n = idx + 1
		const srcCandidates = destinationSourceIds(dest, idx, ctx)
		merged[`screen_${n}_screen_consumer`] = srcCandidates.some((src) => reachesGpuFromSource(src, ctx))
	}
}

/**
 * DeckLink tiles + GPU screen consumer can coexist; stale saved `decklink_replace_screen` must not suppress `<screen>`.
 * @param {Record<string, unknown>} merged
 */
function reconcileDecklinkScreenConsumerFlags(merged) {
	const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 4), 10) || 4))
	for (let n = 1; n <= sc; n++) {
		const tiles = merged[`screen_${n}_decklink_tiles`]
		const decklinkDevice = parseInt(String(merged[`screen_${n}_decklink_device`] || '0'), 10) || 0
		const hasDecklink = decklinkDevice > 0 || (Array.isArray(tiles) && tiles.length > 0)
		if (!hasDecklink) continue
		const wantsScreen =
			merged[`screen_${n}_screen_consumer`] === true || merged[`screen_${n}_screen_consumer`] === 'true'
		merged[`screen_${n}_decklink_replace_screen`] = !wantsScreen
	}
}

/**
 * Device View destination `audioLayout` → `screen_N_audio_layout` for Caspar PGM bus width.
 * @param {Record<string, unknown>} merged
 * @param {Record<string, unknown>} appConfig
 */
function applyDestinationAudioLayoutsToScreens(merged, appConfig) {
	const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 4), 10) || 4))
	const byMain = destinationAudioLayoutsByMain(appConfig || {})
	for (let n = 1; n <= sc; n++) {
		const layout = byMain[n - 1] != null ? normalizeProgramLayout(String(byMain[n - 1])) : 'stereo'
		merged[`screen_${n}_audio_layout`] = layout
	}
}

function applyAudioOutputOverridesToScreens(merged, appConfig) {
	const audioOutputs = Array.isArray(appConfig?.audioOutputs) ? appConfig.audioOutputs : []
	const destinations = destinationsFromConfig(appConfig || {})
	const edges = Array.isArray(appConfig?.deviceGraph?.edges) ? appConfig.deviceGraph.edges : []

	// Map each cabled audio output to the corresponding screen in Caspar (Device View).
	audioOutputs.forEach((out) => {
		if (!out || typeof out !== 'object') return
		if (out.enabled === false || out.enabled === 'false') return
		const id = String(out.id || '').trim()
		if (!id) return
		const consumerType = String(out.type || 'portaudio').toLowerCase()
		const deviceName = String(out.deviceName || '').trim()
		// OpenAL default sink uses empty device name → bare `<system-audio />`; PortAudio needs a device.
		if (consumerType !== 'system-audio' && !deviceName) return

		// Find edge pointing to this audio output
		const edge = edges.find((e) => String(e.sinkId) === id)
		if (!edge) return

		// Source is likely a destination feed: dst_in_DESTID
		const srcId = String(edge.sourceId)
		let destId = ''
		if (srcId.startsWith('dst_in_')) {
			destId = srcId.slice('dst_in_'.length)
		}

		const dest = destinations.find((d) => String(d.id) === destId)
		if (!dest) return

		const isMv = String(dest.mode || '') === 'multiview'
		const idx = Number.isFinite(Number(dest.mainScreenIndex)) ? Number(dest.mainScreenIndex) : 0
		const prefix = isMv ? 'multiview_' : `screen_${idx + 1}_`

		if (consumerType === 'system-audio') {
			merged[`${prefix}system_audio_enabled`] = true
			merged[`${prefix}system_audio_device_name`] = deviceName
			// If this is a main screen and we enabled system audio via cabling,
			// make sure we don't accidentally enable PortAudio fallback if not cabled.
			if (!merged[`${prefix}portaudio_consumers`]) {
				merged[`${prefix}portaudio_enabled`] = false
			}
		} else {
			// PortAudio
			if (!merged[`${prefix}portaudio_consumers`]) {
				merged[`${prefix}portaudio_consumers`] = []
			}
			merged.caspar_global_portaudio = true

			const layout = normalizeProgramLayout(String(out.channelLayout || 'stereo'))
			const chCount = channelCountFromLayout(layout)

			const consumer = {
				deviceName: out.deviceName,
				hostApi: out.hostApi || 'auto',
				outputChannels: chCount,
				audioLayout: layout,
				bufferFrames: parseInt(String(out.bufferFrames), 10) || 128,
				latencyMs: parseInt(String(out.latencyMs), 10) || 40,
				fifoMs: parseInt(String(out.fifoMs), 10) || 50,
				autoTune: out.autoTuneLatency !== false && out.autoTuneLatency !== 'false',
			}

			merged[`${prefix}portaudio_consumers`].push(consumer)
			merged[`${prefix}portaudio_enabled`] = true

			// PortAudio consumer width must match PGM `<channel-layout>` on the cabled program channel.
			if (!isMv) {
				const layoutKey = `screen_${idx + 1}_audio_layout`
				const current = normalizeProgramLayout(String(merged[layoutKey] || 'stereo'))
				merged[layoutKey] = maxProgramLayout(current, layout)
			}
		}

		// Ensure we are in custom_live profile if we are using either PortAudio or System Audio device names
		if (merged.caspar_build_profile === 'stock' || !merged.caspar_build_profile) {
			merged.caspar_build_profile = 'custom_live'
		}
	})

	reconcileCustomLivePortAudioVsOpenAl(merged)
	assignStereoBusPatchesOnScreens(merged)
}

/**
 * When several stereo PortAudio outputs share one PGM channel, map each device to the next bus pair (1+2, 3+4, …).
 * @param {Record<string, unknown>} merged
 */
function assignStereoBusPatchesOnScreens(merged) {
	const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 4), 10) || 4))
	for (let n = 1; n <= sc; n++) {
		const list = merged[`screen_${n}_portaudio_consumers`]
		if (!Array.isArray(list) || list.length <= 1) continue
		let nextMixCh = 1
		for (const c of list) {
			if (!c || typeof c !== 'object') continue
			const outCh = parseInt(String(c.outputChannels || 2), 10) || 2
			if (outCh !== 2) {
				nextMixCh += outCh
				continue
			}
			if (nextMixCh > 15) break
			const patch = c.audioPatch && typeof c.audioPatch === 'object' ? c.audioPatch : {}
			if (Object.keys(patch).length === 0) {
				c.audioPatch = { '1-2': `${nextMixCh}-${nextMixCh + 1}` }
			}
			nextMixCh += 2
		}
	}
}

/**
 * `mergeAudioRoutingIntoConfig` runs before device-graph PortAudio wiring. When this pass adds
 * `<portaudio/>` consumers, OpenAL `<system-audio>` on the same program channel must be off —
 * otherwise Caspar can end up with two real-world sinks (silent/wrong device, flaky meters).
 * @param {Record<string, unknown>} merged
 */
function reconcileCustomLivePortAudioVsOpenAl(merged) {
	const profile = String(merged.caspar_build_profile || 'stock').toLowerCase()
	if (profile !== 'custom_live') return
	const globalPa = merged.caspar_global_portaudio === true || merged.caspar_global_portaudio === 'true'
	const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 4), 10) || 4))
	for (let n = 1; n <= sc; n++) {
		const pref = `screen_${n}_`
		const paEn = merged[`${pref}portaudio_enabled`] === true || merged[`${pref}portaudio_enabled`] === 'true'
		const list = merged[`${pref}portaudio_consumers`]
		const hasList = Array.isArray(list) && list.length > 0
		if (hasList || (globalPa && paEn)) {
			merged[`${pref}system_audio_enabled`] = false
		}
	}
}



/**
 * Flat config for {@link buildConfigXml}: persisted `casparServer` + `audioRouting` + `streaming`
 * + OSC ports for the `<osc>` predefined client block (same machine → 127.0.0.1).
 * @param {Record<string, unknown>} appConfig - `ctx.config` / highascg.config.json shape
 * @returns {Record<string, unknown>}
 */
function buildCasparGeneratorFlatConfig(appConfig) {
	const base = { ...(defaults.casparServer || {}), ...((appConfig && appConfig.casparServer) || {}) }
	const merged = mergeAudioRoutingIntoConfig({
		...base,
		audioRouting: { ...(defaults.audioRouting || {}), ...((appConfig && appConfig.audioRouting) || {}) },
		streaming: (appConfig && appConfig.streaming) || {},
	})
	const lp = appConfig && appConfig.osc && appConfig.osc.listenPort != null ? Number(appConfig.osc.listenPort) : 6251
	const port = Number.isFinite(lp) ? lp : 6251
	merged.osc_port = port
	if (merged.osc_target_port == null || merged.osc_target_port === '') merged.osc_target_port = port
	else merged.osc_target_port = parseInt(String(merged.osc_target_port), 10) || port
	const host = String(merged.osc_target_host || '127.0.0.1').trim() || '127.0.0.1'
	merged.osc_target_host = host
	merged.highascg_host = host
	/** Same rule as routing-map `screen_count`: max of root `screen_count` and `casparServer.screen_count`. */
	merged.screen_count = resolveMainScreenCount(appConfig || {})
	applyDestinationOverridesToScreens(merged, appConfig || {})
	applyMultiviewDestinationOverrides(merged, appConfig || {})
	applyPixelMappingProgramScreens(merged, appConfig || {})
	applyDecklinkOverridesToScreens(merged, appConfig || {})
	applyScreenConsumerOverridesFromCabling(merged, appConfig || {})
	applyMultiviewOutputOverridesFromCabling(merged, appConfig || {})
	const { applyPhysicalPortConsumerFlagsToScreens } = require('./screen-consumer-port-resolve')
	applyPhysicalPortConsumerFlagsToScreens(merged, appConfig || {})
	applyNdiStreamOutputsToScreens(merged, appConfig || {})
	reconcileDecklinkScreenConsumerFlags(merged)
	applyDestinationAudioLayoutsToScreens(merged, appConfig || {})
	applyAudioOutputOverridesToScreens(merged, appConfig || {})
	merged.rtmp = normalizeRtmpConfig(appConfig && appConfig.rtmp)
	merged.composePreview = {
		...(defaults.composePreview || {}),
		...(appConfig && appConfig.composePreview && typeof appConfig.composePreview === 'object'
			? appConfig.composePreview
			: {}),
	}
	merged.streamingChannel = {
		...(defaults.streamingChannel || {}),
		...(appConfig && appConfig.streamingChannel && typeof appConfig.streamingChannel === 'object'
			? appConfig.streamingChannel
			: {}),
	}
	merged.screenDestinations = normalizeScreenDestinations(appConfig?.screenDestinations)
	// WO-268: the generator reads operatorTools (cefInteractiveBridge, cefRemoteDebuggingPort,
	// and now cefEnableGpu) but the flat config never carried it — those flags silently used
	// their fallbacks on the production path. Pass it through.
	merged.operatorTools = {
		...((appConfig && typeof appConfig.operatorTools === 'object' && appConfig.operatorTools) || {}),
	}
	merged.extraLiveSources = Array.isArray(appConfig?.extraLiveSources) ? appConfig.extraLiveSources : []
	
	// Attach layout-related bits for buildChannelsSection -> calculateLayoutPositions
	merged.deviceGraph = appConfig && appConfig.deviceGraph
	merged.x11_horizontal_swap = appConfig && appConfig.x11_horizontal_swap

	copyLegacyScreenAndMultiviewSettings(merged, appConfig)
	applyLayoutPositionsToMerged(merged)

	try {
		applyStreamRecordMappingsFromGraph({
			deviceGraph: appConfig?.deviceGraph,
			screenDestinations: appConfig?.screenDestinations,
			streamingChannel: merged.streamingChannel,
			recordOutputs: Array.isArray(appConfig?.recordOutputs) ? appConfig.recordOutputs : [],
		})
	} catch (_) {}

	return merged
}

module.exports = { buildCasparGeneratorFlatConfig }
