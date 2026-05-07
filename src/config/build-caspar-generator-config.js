'use strict'

const defaults = require('./defaults')
const { mergeAudioRoutingIntoConfig } = require('./config-generator')
const { normalizeRtmpConfig } = require('./rtmp-output')
const { resolveMainScreenCount } = require('./routing-map')
const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { normalizeTandemTopology } = require('./tandem-topology')

/**
 * @param {Record<string, unknown>} appConfig
 * @returns {Array<any>}
 */
function getDestinationList(appConfig) {
	const top = normalizeTandemTopology(appConfig && appConfig.tandemTopology)
	const list = Array.isArray(top?.destinations) ? top.destinations : []
	return list.filter((d) => d && typeof d === 'object')
}

function parseCustomVideoModeString(modeRaw) {
	const s = String(modeRaw || '').trim().toLowerCase()
	if (!s) return null
	// 5120x1024, 5120x1024p50, 5120x1024@50
	const m = s.match(/^(\d{2,5})x(\d{2,5})(?:p|@)?(\d+(?:\.\d+)?)?$/i)
	if (!m) return null
	const w = Math.max(64, parseInt(m[1], 10) || 0)
	const h = Math.max(64, parseInt(m[2], 10) || 0)
	const fps = Math.max(1, parseFloat(m[3] || '50') || 50)
	if (!w || !h) return null
	return { w, h, fps }
}

/**
 * Project destination panel state into Caspar generator screen settings.
 * Priority: destination `videoMode` when standard, otherwise destination `width/height/fps` as custom mode.
 * @param {Record<string, unknown>} merged
 * @param {Record<string, unknown>} appConfig
 */
function applyDestinationOverridesToScreens(merged, appConfig) {
	const rawList =
		appConfig &&
			appConfig.tandemTopology &&
			typeof appConfig.tandemTopology === 'object' &&
			Array.isArray(appConfig.tandemTopology.destinations)
			? appConfig.tandemTopology.destinations
			: []
	const list = getDestinationList(appConfig)
	if (!list.length) return
	const routable = list.filter((d) => {
		const mode = String(d?.mode || 'pgm_prv')
		return mode !== 'multiview' && mode !== 'stream'
	})
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
		const picked = perMain.find((d) => String(d.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]
		const modeRaw = String(picked.videoMode || '').trim()
		const width = Math.max(64, parseInt(String(picked.width ?? 0), 10) || 0)
		const height = Math.max(64, parseInt(String(picked.height ?? 0), 10) || 0)
		const fps = Math.max(1, parseFloat(String(picked.fps ?? 50)) || 50)
		const n = idx + 1
		if (modeRaw && STANDARD_VIDEO_MODES[modeRaw]) {
			merged[`screen_${n}_mode`] = modeRaw
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
	const destinations = Array.isArray(appConfig?.tandemTopology?.destinations) ? appConfig.tandemTopology.destinations : []
	const byId = new Map(g.connectors.map((c) => [String(c?.id || ''), c]))
	const outgoing = new Map()
	for (const e of edges) {
		const src = String(e?.sourceId || '')
		if (!src) continue
		if (!outgoing.has(src)) outgoing.set(src, [])
		outgoing.get(src).push(String(e?.sinkId || ''))
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

	g.connectors.forEach((c) => {
		if (c.kind !== 'decklink_io') return
		const devNum = parseInt(String(c.externalRef || ''), 10)
		if (!Number.isFinite(devNum) || devNum <= 0) return

		const incomingEdge = edges.find((e) => e.sinkId === c.id)
		if (!incomingEdge) {
			// Fallback to legacy binding if no cable exists
			if (c.caspar?.ioDirection !== 'out') return
			const binding = c.caspar?.outputBinding
			if (binding?.type === 'screen') {
				const n = Math.min(8, Math.max(1, parseInt(String(binding.index ?? 1), 10) || 1))
				merged[`screen_${n}_decklink_device`] = devNum
				if (merged[`screen_${n}_decklink_replace_screen`] === undefined) merged[`screen_${n}_decklink_replace_screen`] = true
			} else if (binding?.type === 'multiview') {
				merged.multiview_decklink_device = devNum
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
				merged.multiview_decklink_device = devNum
			} else {
				const idx = Number.isFinite(Number(dest.mainScreenIndex)) ? Number(dest.mainScreenIndex) : 0
				const n = idx + 1
				merged[`screen_${n}_decklink_device`] = devNum
				if (merged[`screen_${n}_decklink_replace_screen`] === undefined) merged[`screen_${n}_decklink_replace_screen`] = true
			}
		} else if (sourceId.startsWith('caspar_pgm_')) {
			// Cabled directly to a raw Caspar Program output
			const idx = parseInt(sourceId.slice('caspar_pgm_'.length), 10) - 1
			const n = idx + 1
			if (n > 0) {
				merged[`screen_${n}_decklink_device`] = devNum
				if (merged[`screen_${n}_decklink_replace_screen`] === undefined) merged[`screen_${n}_decklink_replace_screen`] = true
			}
		} else if (sourceId === 'caspar_mv_out') {
			merged.multiview_decklink_device = devNum
		}
	})
}

function applyScreenConsumerOverridesFromCabling(merged, appConfig) {
	const g = appConfig?.deviceGraph
	const destinations = Array.isArray(appConfig?.tandemTopology?.destinations) ? appConfig.tandemTopology.destinations : []
	if (!g || !Array.isArray(g.connectors) || !Array.isArray(g.edges) || !destinations.length) return

	const byId = new Map(g.connectors.map((c) => [String(c?.id || ''), c]))
	const edges = g.edges
	const outgoing = new Map()
	for (const e of edges) {
		const src = String(e?.sourceId || '')
		if (!src) continue
		if (!outgoing.has(src)) outgoing.set(src, [])
		outgoing.get(src).push(String(e?.sinkId || ''))
	}

	function reachesGpuFromSource(sourceId) {
		const queue = [String(sourceId || '')]
		const seen = new Set()
		while (queue.length) {
			const cur = queue.shift()
			if (!cur || seen.has(cur)) continue
			seen.add(cur)
			const next = outgoing.get(cur) || []
			for (const sinkId of next) {
				const sink = byId.get(String(sinkId || ''))
				if (!sink) continue
				if (sink.kind === 'gpu_out') return true
				if (sink.kind === 'pixel_map_in') {
					const nodeId = String(sink.deviceId || '')
					const nodeOut = g.connectors.filter((c) => String(c?.deviceId || '') === nodeId && c?.kind === 'pixel_map_out')
					for (const no of nodeOut) queue.push(String(no?.id || ''))
				}
			}
		}
		return false
	}

	function destinationSourceIds(dest, idx) {
		const out = new Set()
		const did = String(dest?.id || '').trim()
		if (did) out.add(`dst_in_${did}`)
		const n = idx + 1
		out.add(`dst_ch${n}`)
		if (String(dest?.mode || '') === 'multiview') out.add(`dst_mv${n}`)
		for (const c of g.connectors || []) {
			if (String(c?.kind || '') !== 'destination_in') continue
			const ref = String(c?.externalRef || '').trim()
			const cid = String(c?.id || '').trim()
			if (did && ref === did && cid) out.add(cid)
		}
		return [...out].filter(Boolean)
	}

	for (const dest of destinations) {
		const mode = String(dest?.mode || 'pgm_prv')
		if (mode === 'multiview' || mode === 'stream') continue
		const idx = Math.max(0, parseInt(String(dest?.mainScreenIndex ?? 0), 10) || 0)
		const n = idx + 1
		const srcCandidates = destinationSourceIds(dest, idx)
		merged[`screen_${n}_screen_consumer`] = srcCandidates.some((src) => reachesGpuFromSource(src))
	}
}

function applyAudioOutputOverridesToScreens(merged, appConfig) {
	const audioOutputs = Array.isArray(appConfig?.audioOutputs) ? appConfig.audioOutputs : []
	const destinations = Array.isArray(appConfig?.tandemTopology?.destinations) ? appConfig.tandemTopology.destinations : []
	const edges = Array.isArray(appConfig?.deviceGraph?.edges) ? appConfig.deviceGraph.edges : []

	if (audioOutputs.length > 0) {
		merged.caspar_global_portaudio = true
	}

	// Map each audio output to the corresponding screen in Caspar via cabling.
	audioOutputs.forEach((out) => {
		if (!out || !out.deviceName) return
		const id = String(out.id).trim()

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

		if (!merged[`${prefix}portaudio_consumers`]) {
			merged[`${prefix}portaudio_consumers`] = []
		}

		const layout = String(out.channelLayout || 'stereo')
		const chCount = layout === '16ch' ? 16 : layout === '8ch' ? 8 : layout === '4ch' ? 4 : 2

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

		merged[`${prefix}portaudio_consumers`.replace('__', '_')].push(consumer)
		merged[`${prefix}portaudio_enabled`] = true // Backward compat for checks

		// Ensure we are in custom_live profile if we are using PortAudio
		if (merged.caspar_build_profile === 'stock' || !merged.caspar_build_profile) {
			merged.caspar_build_profile = 'custom_live'
		}
	})
}

/**
 * Map pixel_mapping outputs onto the **program channel that feeds the node's input** (see `work/caspar_extended.config`):
 * one wide custom video-mode plus a single `<decklink>` with `<subregion>` and synced `<ports>` for extra SDI devices.
 */
function resolvePixelMapFeedToProgramScreen(appConfig, nodeId) {
	const dg = appConfig?.deviceGraph
	if (!dg || !Array.isArray(dg.connectors) || !Array.isArray(dg.edges)) return null
	const connectors = dg.connectors
	const edges = dg.edges
	const destinations = Array.isArray(appConfig?.tandemTopology?.destinations) ? appConfig.tandemTopology.destinations : []
	const inConn = connectors.find((c) => String(c?.deviceId || '') === nodeId && c.kind === 'pixel_map_in')
	if (!inConn) return null
	const inEdge = edges.find((e) => String(e?.sinkId || '') === String(inConn.id || ''))
	if (!inEdge) return null
	const srcId = String(inEdge.sourceId || '')
	if (srcId.startsWith('dst_in_')) {
		const destId = srcId.slice('dst_in_'.length)
		const dest = destinations.find((d) => String(d?.id || '') === destId)
		if (!dest) return null
		if (String(dest.mode || '') === 'multiview') return { kind: 'multiview' }
		const idx = Math.max(0, parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0)
		return { kind: 'program', screenIndex: idx + 1 }
	}
	if (srcId.startsWith('dst_ch')) {
		const n = parseInt(srcId.slice('dst_ch'.length), 10)
		if (Number.isFinite(n) && n >= 1) return { kind: 'program', screenIndex: n }
	}
	if (srcId.startsWith('dst_mv')) return { kind: 'multiview' }
	if (srcId.startsWith('caspar_pgm_')) {
		const n = parseInt(srcId.slice('caspar_pgm_'.length), 10)
		if (Number.isFinite(n) && n >= 1) return { kind: 'program', screenIndex: n }
	}
	return null
}

function applyPixelMappingProgramScreens(merged, appConfig) {
	const dg = appConfig?.deviceGraph
	if (!dg || !Array.isArray(dg.devices) || !Array.isArray(dg.connectors) || !Array.isArray(dg.edges)) return

	const devices = dg.devices
	const connectors = dg.connectors
	const edges = dg.edges
	const byId = new Map(connectors.map((c) => [String(c?.id || ''), c]))
	const hardwareDisplays = Array.isArray(appConfig?.hardware?.displays) ? appConfig.hardware.displays : []
	const mappingNodes = devices.filter((d) => d && d.role === 'pixel_mapping')

	for (const node of mappingNodes) {
		const nodeId = String(node.id || '')
		if (!nodeId) continue

		const feed = resolvePixelMapFeedToProgramScreen(appConfig, nodeId)
		const outputs = Array.isArray(node.settings?.outputs) ? node.settings.outputs : []
		const mappings = Array.isArray(node.settings?.mappings) ? node.settings.mappings : []
		if (!outputs.length) continue

		const nodeOutConns = connectors.filter((c) => c.deviceId === nodeId && c.kind === 'pixel_map_out')

		let hasNonDeckCable = false
		for (const c of nodeOutConns) {
			const e = edges.find((x) => String(x.sourceId) === String(c.id))
			if (!e) continue
			const sk = byId.get(String(e.sinkId || ''))
			if (!sk) continue
			if (sk.kind === 'decklink_io' || sk.kind === 'decklink_out') continue
			hasNonDeckCable = true
			break
		}

		if (feed?.kind === 'program' && !hasNonDeckCable) {
			let srcX = 0
			let maxH = 1080
			/** @type {{ device: number, srcX: number, srcY: number, destX: number, destY: number, width: number, height: number, videoMode: string }[]} */
			const tiles = []
			let fps = 50

			for (let idx = 0; idx < outputs.length; idx++) {
				const outDef = outputs[idx]
				const modeId = String(outDef?.mode || '1080p5000').trim()
				const spec = STANDARD_VIDEO_MODES[modeId]
				const w = spec?.width ?? 1920
				const h = spec?.height ?? 1080
				const f = spec?.fps ?? 50
				
				const slice = mappings.find(m => String(m.outputId) === String(outDef?.id || ''))
				const tileSrcX = slice?.rect?.x ?? srcX
				const tileSrcY = slice?.rect?.y ?? 0
				const tileW = slice?.rect?.w ?? w
				const tileH = slice?.rect?.h ?? h

				maxH = Math.max(maxH, tileSrcY + tileH)

				const conn =
					nodeOutConns.find((c) => Number(c?.index) === idx) ||
					nodeOutConns.find((c) => String(c?.id || '') === `${nodeId}_${String(outDef?.id || '')}`)
				if (!conn) {
					srcX += w
					continue
				}
				const edge = edges.find((e) => String(e.sourceId) === String(conn.id))
				if (!edge) {
					srcX += w
					continue
				}
				const sink = byId.get(String(edge.sinkId || ''))
				if (!sink || (sink.kind !== 'decklink_io' && sink.kind !== 'decklink_out')) {
					srcX += w
					continue
				}
				const devNum = parseInt(String(sink.externalRef || ''), 10)
				if (!(Number.isFinite(devNum) && devNum > 0)) {
					srcX += w
					continue
				}

				tiles.push({
					device: devNum,
					srcX: tileSrcX,
					srcY: tileSrcY,
					destX: 0,
					destY: 0,
					width: tileW,
					height: tileH,
					videoMode: modeId,
				})
				fps = f
				srcX += w
			}

			if (tiles.length > 0) {
				const n = feed.screenIndex
				const totalW = tiles.reduce((acc, t) => acc + t.width, 0)
				merged[`screen_${n}_mode`] = 'custom'
				merged[`screen_${n}_custom_width`] = totalW
				merged[`screen_${n}_custom_height`] = maxH
				merged[`screen_${n}_custom_fps`] = fps
				// Keep screen consumer when destination is also cabled to GPU.
				if (merged[`screen_${n}_screen_consumer`] === true) merged[`screen_${n}_decklink_replace_screen`] = false
				else merged[`screen_${n}_decklink_replace_screen`] = true
				merged[`screen_${n}_decklink_tiles`] = tiles
				delete merged[`screen_${n}_decklink_device`]
				continue
			}
		}

		if (feed?.kind !== 'program') continue
		const n = feed.screenIndex
		for (const conn of nodeOutConns) {
			const edge = edges.find((e) => String(e.sourceId) === String(conn.id))
			if (!edge) continue
			const sink = byId.get(String(edge.sinkId || ''))
			if (!sink || (sink.kind !== 'gpu_out' && sink.kind !== 'gpu_output')) continue
			const displayId = String(sink.externalRef || '')
			const disp = hardwareDisplays.find((d) => String(d.id) === displayId)
			if (disp) {
				merged[`screen_${n}_mode`] = 'custom'
				merged[`screen_${n}_custom_width`] = disp.width
				merged[`screen_${n}_custom_height`] = disp.height
				merged[`screen_${n}_custom_fps`] = disp.fps || 60
			}
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
	applyDecklinkOverridesToScreens(merged, appConfig || {})
	applyScreenConsumerOverridesFromCabling(merged, appConfig || {})
	applyAudioOutputOverridesToScreens(merged, appConfig || {})
	applyPixelMappingProgramScreens(merged, appConfig || {})
	merged.rtmp = normalizeRtmpConfig(appConfig && appConfig.rtmp)
	merged.streamingChannel = {
		...(defaults.streamingChannel || {}),
		...(appConfig && appConfig.streamingChannel && typeof appConfig.streamingChannel === 'object'
			? appConfig.streamingChannel
			: {}),
	}
	merged.tandemTopology = normalizeTandemTopology(appConfig && appConfig.tandemTopology)
	
	// Attach layout-related bits for buildChannelsSection -> calculateLayoutPositions
	merged.deviceGraph = appConfig && appConfig.deviceGraph
	merged.x11_horizontal_swap = appConfig && appConfig.x11_horizontal_swap
	
	// Copy legacy screen/mv settings that are top-level in appConfig
	if (appConfig) {
		for (let i = 1; i <= 16; i++) {
			const prefix = `screen_${i}_`
			if (appConfig[prefix + 'system_id']) merged[prefix + 'system_id'] = appConfig[prefix + 'system_id']
			if (appConfig[prefix + 'os_mode']) merged[prefix + 'os_mode'] = appConfig[prefix + 'os_mode']
			if (appConfig[prefix + 'os_rate']) merged[prefix + 'os_rate'] = appConfig[prefix + 'os_rate']
			if (appConfig[prefix + 'os_x'] !== undefined) merged[prefix + 'os_x'] = appConfig[prefix + 'os_x']
			if (appConfig[prefix + 'os_y'] !== undefined) merged[prefix + 'os_y'] = appConfig[prefix + 'os_y']
		}
		if (appConfig.multiview_system_id) merged.multiview_system_id = appConfig.multiview_system_id
		if (appConfig.multiview_os_mode) merged.multiview_os_mode = appConfig.multiview_os_mode
		if (appConfig.multiview_os_rate) merged.multiview_os_rate = appConfig.multiview_os_rate
		if (appConfig.multiview_os_x !== undefined) merged.multiview_os_x = appConfig.multiview_os_x
		if (appConfig.multiview_os_y !== undefined) merged.multiview_os_y = appConfig.multiview_os_y
	}
	
	return merged
}

module.exports = { buildCasparGeneratorFlatConfig }
