import { buildInspectorTable, roleLabel } from './device-view-ui-utils.js'
import { mountWebpageHostPageControls } from './inspector-webpage-host.js'
import { createNdiAttributionElement } from '../lib/ndi-attribution.js'
import { PROGRAM_LAYOUT_OPTIONS } from '../lib/audio-channel-layouts.js'
import { defaultVideoModeForProjectFps, resolveProjectFpsFromSettings } from '../lib/project-fps.js'

export const STANDARD_VIDEO_MODES = [
	'PAL', 'NTSC', '576p2500', '720p2398', '720p2400', '720p2500', '720p2997', '720p3000', '720p5000', '720p5994', '720p6000',
	'1080i5000', '1080i5994', '1080i6000', '1080p2398', '1080p2400', '1080p2500', '1080p2997', '1080p3000', '1080p5000', '1080p5994', '1080p6000',
	'1556p2398', '1556p2400', '1556p2500', '2160p2398', '2160p2400', '2160p2500', '2160p2997', '2160p3000', '2160p5000', '2160p5994', '2160p6000',
	'dci1080p2398', 'dci1080p2400', 'dci1080p2500', 'dci2160p2398', 'dci2160p2400', 'dci2160p2500',
]

/** Matches server `src/config/config-modes.js` — used for OS override / xrandr pixel mode from Caspar video mode. */
export const CASPAR_VIDEO_MODE_SPECS = {
	PAL: { width: 720, height: 576, fps: 25 },
	NTSC: { width: 720, height: 486, fps: 29.97 },
	'576p2500': { width: 720, height: 576, fps: 25 },
	'720p2398': { width: 1280, height: 720, fps: 23.98 },
	'720p2400': { width: 1280, height: 720, fps: 24 },
	'720p2500': { width: 1280, height: 720, fps: 25 },
	'720p5000': { width: 1280, height: 720, fps: 50 },
	'720p2997': { width: 1280, height: 720, fps: 29.97 },
	'720p5994': { width: 1280, height: 720, fps: 59.94 },
	'720p3000': { width: 1280, height: 720, fps: 30 },
	'720p6000': { width: 1280, height: 720, fps: 60 },
	'1080p2398': { width: 1920, height: 1080, fps: 23.98 },
	'1080p2400': { width: 1920, height: 1080, fps: 24 },
	'1080p2500': { width: 1920, height: 1080, fps: 25 },
	'1080p5000': { width: 1920, height: 1080, fps: 50 },
	'1080p2997': { width: 1920, height: 1080, fps: 29.97 },
	'1080p5994': { width: 1920, height: 1080, fps: 59.94 },
	'1080p3000': { width: 1920, height: 1080, fps: 30 },
	'1080p6000': { width: 1920, height: 1080, fps: 60 },
	'1080i5000': { width: 1920, height: 1080, fps: 50 },
	'1080i5994': { width: 1920, height: 1080, fps: 59.94 },
	'1080i6000': { width: 1920, height: 1080, fps: 60 },
	'1556p2398': { width: 2048, height: 1556, fps: 23.98 },
	'1556p2400': { width: 2048, height: 1556, fps: 24 },
	'1556p2500': { width: 2048, height: 1556, fps: 25 },
	'2160p2398': { width: 3840, height: 2160, fps: 23.98 },
	'2160p2400': { width: 3840, height: 2160, fps: 24 },
	'2160p2500': { width: 3840, height: 2160, fps: 25 },
	'2160p2997': { width: 3840, height: 2160, fps: 29.97 },
	'2160p3000': { width: 3840, height: 2160, fps: 30 },
	'2160p5000': { width: 3840, height: 2160, fps: 50 },
	'2160p5994': { width: 3840, height: 2160, fps: 59.94 },
	'2160p6000': { width: 3840, height: 2160, fps: 60 },
	'dci1080p2398': { width: 2048, height: 1080, fps: 23.98 },
	'dci1080p2400': { width: 2048, height: 1080, fps: 24 },
	'dci1080p2500': { width: 2048, height: 1080, fps: 25 },
	'dci2160p2398': { width: 4096, height: 2160, fps: 23.98 },
	'dci2160p2400': { width: 4096, height: 2160, fps: 24 },
	'dci2160p2500': { width: 4096, height: 2160, fps: 25 },
}

/**
 * @param {string} modeId
 * @param {{ customWidth?: number, customHeight?: number, customFps?: number }} [opts]
 * @returns {{ osMode: string, osRate: number } | null}
 */
export function casparVideoModeToOsModeAndRate(modeId, opts) {
	const raw = String(modeId || '').trim()
	const aliases = {
		'1080p50': '1080p5000',
		'720p50': '720p5000',
		'1080p60': '1080p6000',
		'720p60': '720p6000',
		'1080p59.94': '1080p5994',
		'720p59.94': '720p5994',
	}
	const id = aliases[raw] || raw
	if (!id || id === 'custom') {
		const w = Math.max(64, parseInt(String(opts?.customWidth ?? 1920), 10) || 1920)
		const h = Math.max(64, parseInt(String(opts?.customHeight ?? 1080), 10) || 1080)
		const fps = Math.max(1, parseFloat(String(opts?.customFps ?? 50)) || 50)
		return { osMode: `${w}x${h}`, osRate: fps }
	}
	const spec = CASPAR_VIDEO_MODE_SPECS[id]
	if (spec) return { osMode: `${spec.width}x${spec.height}`, osRate: spec.fps }
	const m = id.match(/^(\d+)\s*x\s*(\d+)$/i)
	if (m) {
		const w = parseInt(m[1], 10) || 1920
		const h = parseInt(m[2], 10) || 1080
		const fps = Math.max(1, parseFloat(String(opts?.customFps ?? 50)) || 50)
		return { osMode: `${w}x${h}`, osRate: fps }
	}
	return null
}

const CASPAR_VIDEO_MODE_ALIASES = {
	'1080p50': '1080p5000',
	'720p50': '720p5000',
	'1080p60': '1080p6000',
	'720p60': '720p6000',
	'1080p59.94': '1080p5994',
	'720p59.94': '720p5994',
	'1080p25': '1080p2500',
	'720p25': '720p2500',
	'2160p50': '2160p5000',
	'2160p60': '2160p6000',
}

function fpsNear(a, b) {
	return Math.abs(Number(a) - Number(b)) <= 0.06
}

/**
 * Normalize shorthand / legacy Caspar mode ids to canonical STANDARD_VIDEO_MODES entries.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeCasparVideoModeId(raw) {
	const id = String(raw || '').trim()
	if (!id) return ''
	if (id === 'custom') return 'custom'
	const aliased = CASPAR_VIDEO_MODE_ALIASES[id] || id
	if (STANDARD_VIDEO_MODES.includes(aliased)) return aliased
	const px = aliased.match(/^(\d+)\s*x\s*(\d+)p?([\d.]+)?$/i)
	if (px) {
		const w = parseInt(px[1], 10) || 0
		const h = parseInt(px[2], 10) || 0
		const fps = px[3] ? parseFloat(px[3]) : NaN
		const matched = matchCasparVideoModeFromDimensions(w, h, fps)
		if (matched) return matched
		return 'custom'
	}
	return aliased
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} [fps]
 * @returns {string | null}
 */
export function matchCasparVideoModeFromDimensions(width, height, fps) {
	const w = Math.max(0, parseInt(String(width), 10) || 0)
	const h = Math.max(0, parseInt(String(height), 10) || 0)
	if (w <= 0 || h <= 0) return null
	const rate = Number.isFinite(Number(fps)) && Number(fps) > 0 ? Number(fps) : null
	for (const mode of STANDARD_VIDEO_MODES) {
		const spec = CASPAR_VIDEO_MODE_SPECS[mode]
		if (!spec) continue
		if (spec.width === w && spec.height === h && (rate == null || fpsNear(spec.fps, rate))) return mode
	}
	return null
}

/**
 * @param {{ resolution?: string, refreshHz?: number, modes?: object[] }} [display]
 * @param {{ mode: string, rate?: string, current?: boolean }[]} [detectedModes]
 * @param {number} [preferredIdx]
 * @returns {{ modeId: string, width?: number, height?: number, fps?: number } | null}
 */
export function casparVideoModeFromDetectedDisplay(display, detectedModes, preferredIdx = -1) {
	const modes = Array.isArray(detectedModes) ? detectedModes : []
	let pick = null
	if (preferredIdx >= 0 && preferredIdx < modes.length) pick = modes[preferredIdx]
	if (!pick) pick = modes.find((m) => m?.current) || modes[0] || null
	if (pick?.mode) {
		const mm = String(pick.mode).match(/^(\d+)x(\d+)$/i)
		if (mm) {
			const w = parseInt(mm[1], 10)
			const h = parseInt(mm[2], 10)
			const fps = parseFloat(String(pick.rate || display?.refreshHz || '')) || NaN
			const matched = matchCasparVideoModeFromDimensions(w, h, fps)
			if (matched) return { modeId: matched }
			return {
				modeId: 'custom',
				width: w,
				height: h,
				fps: Number.isFinite(fps) && fps > 0 ? fps : 50,
			}
		}
	}
	const mr = String(display?.resolution || '').match(/^(\d+)x(\d+)$/)
	if (mr) {
		const w = parseInt(mr[1], 10)
		const h = parseInt(mr[2], 10)
		const fps = Number(display?.refreshHz)
		const matched = matchCasparVideoModeFromDimensions(w, h, fps)
		if (matched) return { modeId: matched }
		return {
			modeId: 'custom',
			width: w,
			height: h,
			fps: Number.isFinite(fps) && fps > 0 ? fps : 50,
		}
	}
	return null
}

/**
 * Resolve Video Mode dropdown value for a GPU jack (display only — does not mutate settings).
 * @param {object} opts
 */
export function resolveGpuInspectorVideoMode(opts) {
	const {
		cs = {},
		currentSettings = {},
		screenN = 1,
		conn = null,
		inherited = null,
		detectedDisplay = null,
		uniqueDetectedModes = [],
		defaultModeIdx = 0,
		physicalCasparMode = null,
	} = opts
	const projectMode = defaultVideoModeForProjectFps(resolveProjectFpsFromSettings(currentSettings))
	const keyMode = `screen_${screenN}_mode`
	const savedRaw = cs[keyMode] ?? currentSettings?.casparServer?.[keyMode] ?? currentSettings?.[keyMode]
	const savedNorm = savedRaw != null && String(savedRaw).trim() !== '' ? normalizeCasparVideoModeId(savedRaw) : ''

	const readCustom = (suffix, fallback) => {
		const k = `screen_${screenN}_${suffix}`
		return cs[k] ?? currentSettings?.casparServer?.[k] ?? fallback
	}

	const fromCandidate = (raw, customDims) => {
		const norm = normalizeCasparVideoModeId(raw)
		if (norm === 'custom' || (!STANDARD_VIDEO_MODES.includes(norm) && customDims)) {
			return {
				modeId: 'custom',
				width: customDims?.width ?? 1920,
				height: customDims?.height ?? 1080,
				fps: customDims?.fps ?? 50,
			}
		}
		if (STANDARD_VIDEO_MODES.includes(norm)) return { modeId: norm }
		return null
	}

	const savedCandidate = savedNorm
		? fromCandidate(savedNorm, {
				width: readCustom('custom_width', 1920),
				height: readCustom('custom_height', 1080),
				fps: readCustom('custom_fps', 50),
			})
		: null

	const liveCandidates = []
	if (conn?.caspar?.mode) liveCandidates.push(fromCandidate(conn.caspar.mode, inherited))
	if (inherited?.mode) {
		liveCandidates.push(
			fromCandidate(inherited.mode, {
				width: inherited.width,
				height: inherited.height,
				fps: inherited.fps,
			}),
		)
	}
	if (physicalCasparMode) liveCandidates.push(fromCandidate(physicalCasparMode, inherited))
	const edid = casparVideoModeFromDetectedDisplay(detectedDisplay, uniqueDetectedModes, defaultModeIdx)
	if (edid) liveCandidates.push(edid)

	const genericDefaults = new Set([projectMode, '1080p5000', '720p5000', ''])
	const firstLive = liveCandidates.find((c) => c && c.modeId) || null
	if (savedCandidate?.modeId && genericDefaults.has(savedCandidate.modeId) && firstLive?.modeId) {
		return firstLive
	}
	if (savedCandidate?.modeId && !genericDefaults.has(savedCandidate.modeId)) {
		return savedCandidate
	}
	if (firstLive) return firstLive
	if (savedCandidate) return savedCandidate
	return { modeId: projectMode }
}

export function edgeOutputLayer(edge) {
	const raw = edge?.note
	if (raw == null || raw === '') return 1
	if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(1, Math.round(raw))
	const s = String(raw || '').trim()
	if (!s) return 1
	try {
		const j = JSON.parse(s)
		const n = Number(j?.outputLayer)
		return Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1
	} catch {
		const m = s.match(/outputLayer\s*[:=]\s*(\d+)/i)
		return m ? Math.max(1, parseInt(m[1], 10) || 1) : 1
	}
}

export function renderDestinationInspector(args) {
	const {
		host,
		d,
		mode,
		intent,
		mappedOutputEdges,
		connectorById,
		patchDestination,
		removeDestination,
		updateDestinationOutputLayer,
		currentSettings,
		lastPayload,
		onWebpageHostApplied,
	} = args
	const projectDefaultMode = defaultVideoModeForProjectFps(resolveProjectFpsFromSettings(currentSettings))

	if (mode === 'host_channel' || d?.virtual === true) {
		const role = d?.hostRole || intent?.hostRole
		const ch = d?.casparChannel ?? intent?.pgmChannel
		const inputEntry = (Array.isArray(lastPayload?.live?.caspar?.channelMap?.inputChannels)
			? lastPayload.live.caspar.channelMap.inputChannels
			: []
		).find((e) => Number(e?.channel) === Number(ch) && (e?.kind === role || !role))
		const extraLive = Array.isArray(lastPayload?.extraLiveSources) ? lastPayload.extraLiveSources : []
		const liveSource =
			extraLive.find((x) => {
				const sid = String(x?.sourceId || '').trim()
				if (!sid) return false
				return String(d?.id || '') === `host_webpage_${sid}` || String(d?.id || '') === `host_ndi_${sid}`
			}) ||
			extraLive.find(
				(x) =>
					Number(x?.hostChannel) === Number(ch) &&
					(x?.routeType === role || x?.hostRole === role),
			) ||
			null
		const rows = [
			{ label: 'Label', value: String(d?.label || d?.id || 'Host channel') },
			{ label: 'Type', value: roleLabel({ role }) },
			{ label: 'Caspar channel', value: String(ch ?? '-') },
		]
		if (inputEntry?.layer != null) rows.push({ label: 'Host layer', value: String(inputEntry.layer) })
		if (inputEntry?.route) rows.push({ label: 'Route', value: String(inputEntry.route) })
		if (liveSource?.sourceId) rows.push({ label: 'Source ID', value: String(liveSource.sourceId) })
		if (role === 'ndi_host' && liveSource?.ndiName) {
			rows.push({ label: 'NDI name', value: String(liveSource.ndiName) })
		}
		host.append(buildInspectorTable(rows))
		if (role === 'webpage_host' && liveSource) {
			mountWebpageHostPageControls(host, {
				source: liveSource,
				onApplied: (r) => {
					if (Array.isArray(r?.extraLiveSources)) {
						lastPayload.extraLiveSources = r.extraLiveSources
					}
					onWebpageHostApplied?.(r, liveSource)
				},
			})
		}
		const note = document.createElement('p')
		note.className = 'device-view__note'
		note.textContent =
			role === 'webpage_host'
				? 'Persistent webpage host — Caspar plays HTML with LOOP on this channel. Drag route:// onto PGM or multiview for on-air; clearing the route does not destroy page state. Cable to Record or Stream to capture this bus.'
				: role === 'ndi_host'
					? 'Dedicated NDI host channel — the feed plays once here; on-air uses route:// only. Cable to Record or Stream to capture this NDI source directly.'
					: role === 'decklink_input'
				? 'Dedicated DeckLink input host channel. Cable this destination to Record or Stream on the rear panel to capture that input directly.'
				: role === 'live_audio_input'
					? 'Dedicated live-audio input host channel. Cable to Record or Stream to capture that ALSA/USB input bus.'
					: role === 'inputs_host'
				? 'Dedicated inputs host bus — Caspar plays DeckLink / live audio here so layers can route:// it everywhere. Cable this to Record or Stream on the rear panel to capture that bus directly.'
				: role === 'streaming_channel'
					? 'Encode / streaming bus — RTMP and file record consumers attach here. Cable another destination (e.g. PGM) into Stream on the rear panel, or cable this host channel to Record to file from the encode bus.'
					: 'Auxiliary Caspar channel. Cable to Record or Stream outputs on the rear panel.'
		host.append(note)
		if (role === 'ndi_host') {
			host.append(createNdiAttributionElement('device-view__note ndi-attribution'))
		}
		if (mappedOutputEdges.length) {
			const outputMapWrap = document.createElement('div')
			outputMapWrap.className = 'device-view__kv'
			const outputMapTitle = document.createElement('div')
			outputMapTitle.className = 'device-view__kv-row'
			outputMapTitle.innerHTML = '<span class="device-view__kv-key">Cabled to</span><span class="device-view__kv-val"></span>'
			outputMapWrap.appendChild(outputMapTitle)
			for (const edge of mappedOutputEdges) {
				const c = connectorById.get(String(edge?.sinkId || '')) || null
				const row = document.createElement('div')
				row.className = 'device-view__kv-row'
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'device-view__inspector-link-btn'
				btn.textContent = String(c?.label || edge?.sinkId || 'Output')
				btn.onclick = () => {
					window.dispatchEvent(new CustomEvent('highascg-device-view-focus-connector', {
						detail: { connectorId: edge.sinkId },
					}))
				}
				row.append(btn)
				outputMapWrap.appendChild(row)
			}
			host.append(outputMapWrap)
		}
		return
	}

	const rows = [
		{ label: 'Label', value: String(d?.label || d?.id || 'Destination') },
		{ label: 'Mode', value: mode === 'pgm_only' ? 'PGM only' : (mode === 'multiview' ? 'Multiview' : 'PGM/PRV') },
		{ label: 'Main index', value: String(d?.mainScreenIndex ?? 0) },
		...(mode !== 'multiview' && mode !== 'stream'
			? [{
				label: 'Audio outputs',
				value: PROGRAM_LAYOUT_OPTIONS.find((o) => o.value === String(d?.audioLayout || 'stereo'))?.label
					|| String(d?.audioLayout || 'stereo'),
			}]
			: []),
		{ label: 'Video mode', value: String(d?.videoMode || '1080p5000') },
		{ label: 'Resolution', value: `${Math.max(64, parseInt(String(d?.width ?? 1920), 10) || 1920)}x${Math.max(64, parseInt(String(d?.height ?? 1080), 10) || 1080)}` },
		{ label: 'FPS', value: String(Math.max(1, parseFloat(String(d?.fps ?? 50)) || 50)) },
		{ label: 'PGM channel', value: intent?.pgmChannel != null ? String(intent.pgmChannel) : '-' },
	]
	if (mode !== 'pgm_only' && mode !== 'multiview') {
		rows.push({
			label: 'PRV channel',
			value: intent == null ? '-' : String(intent.previewChannelIntended ?? intent.previewChannelGenerated ?? '-'),
		})
	}
	const table = buildInspectorTable(rows)
	const summaryValByLabel = new Map()
	for (const row of table.querySelectorAll('.device-view__kv-row')) {
		const label = row.querySelector('.device-view__kv-key')?.textContent
		const val = row.querySelector('.device-view__kv-val')
		if (label && val) summaryValByLabel.set(label, val)
	}
	const syncVideoModeSummary = (mode, width, height, fps) => {
		summaryValByLabel.get('Video mode')?.replaceChildren(document.createTextNode(String(mode)))
		summaryValByLabel.get('Resolution')?.replaceChildren(document.createTextNode(`${width}x${height}`))
		summaryValByLabel.get('FPS')?.replaceChildren(document.createTextNode(String(fps)))
	}
	const syncAudioOutputsSummary = (layoutId) => {
		const opt = PROGRAM_LAYOUT_OPTIONS.find((o) => o.value === String(layoutId || 'stereo'))
		summaryValByLabel.get('Audio outputs')?.replaceChildren(
			document.createTextNode(opt?.label || String(layoutId || 'stereo')),
		)
	}
	const edits = document.createElement('div')
	edits.className = 'device-view__inspector-links'
	const outputMapWrap = document.createElement('div')
	outputMapWrap.className = 'device-view__kv'
	const outputMapTitle = document.createElement('div')
	outputMapTitle.className = 'device-view__kv-row'
	outputMapTitle.innerHTML = '<span class="device-view__kv-key">Mapped outputs</span><span class="device-view__kv-val"></span>'
	outputMapWrap.appendChild(outputMapTitle)
	if (mappedOutputEdges.length) {
		for (const edge of mappedOutputEdges) {
			const c = connectorById.get(String(edge?.sinkId || '')) || null
			const row = document.createElement('div')
			row.className = 'device-view__kv-row'
			
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = 'device-view__inspector-link-btn'
			btn.textContent = String(c?.label || edge?.sinkId || 'Output')
			btn.title = 'Click to go to this output connector inspector'
			btn.onclick = () => {
				window.dispatchEvent(new CustomEvent('highascg-device-view-focus-connector', { 
					detail: { connectorId: edge.sinkId } 
				}))
			}

			const layerInfo = document.createElement('span')
			layerInfo.className = 'device-view__kv-val'
			layerInfo.style.opacity = '0.5'
			layerInfo.style.fontSize = '11px'
			const layer = edgeOutputLayer(edge)
			if (layer > 1) {
				layerInfo.textContent = ` (Layer ${layer})`
			}

			row.append(btn, layerInfo)
			outputMapWrap.appendChild(row)
		}
	} else {
		const row = document.createElement('div')
		row.className = 'device-view__kv-row'
		row.innerHTML = '<span class="device-view__kv-key"></span><span class="device-view__kv-val">No mapped outputs yet.</span>'
		outputMapWrap.appendChild(row)
	}

	const nameIn = document.createElement('input')
	nameIn.type = 'text'
	nameIn.className = 'device-view__destinations-type'
	nameIn.value = String(d?.label || d?.id || '')
	nameIn.placeholder = 'Destination label'
	nameIn.addEventListener('change', () => patchDestination(d.id, { label: String(nameIn.value || '').trim() || String(d?.label || d?.id || 'Destination') }))

	const mainIn = document.createElement('input')
	mainIn.type = 'number'
	mainIn.min = '0'
	mainIn.step = '1'
	mainIn.className = 'device-view__destinations-type'
	mainIn.value = String(Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0))
	mainIn.title = 'Main index (zero-based)'
	mainIn.addEventListener('change', () => patchDestination(d.id, { mainScreenIndex: Math.max(0, parseInt(String(mainIn.value || 0), 10) || 0) }))

	const modeSel = document.createElement('select')
	modeSel.className = 'device-view__destinations-type'
	modeSel.innerHTML = '<option value="pgm_prv">PGM/PRV</option><option value="pgm_only">PGM only</option><option value="multiview">Multiview</option>'
	modeSel.value = mode === 'pgm_only' ? 'pgm_only' : (mode === 'multiview' ? 'multiview' : 'pgm_prv')
	modeSel.addEventListener('change', () => patchDestination(d.id, { mode: modeSel.value }))

	const audioOutputsFieldId = `dest_audio_outputs_${String(d?.id || 'dest').replace(/[^a-zA-Z0-9_-]/g, '_')}`
	const audioLayoutSel = document.createElement('select')
	audioLayoutSel.id = audioOutputsFieldId
	audioLayoutSel.className = 'device-view__destinations-type'
	audioLayoutSel.title = 'Number of audio output channels for this destination (program bus width)'
	for (const o of PROGRAM_LAYOUT_OPTIONS) {
		const opt = document.createElement('option')
		opt.value = o.value
		opt.textContent = o.label
		audioLayoutSel.appendChild(opt)
	}
	audioLayoutSel.value = PROGRAM_LAYOUT_OPTIONS.some((o) => o.value === String(d?.audioLayout || 'stereo'))
		? String(d?.audioLayout || 'stereo')
		: 'stereo'
	audioLayoutSel.addEventListener('change', () => {
		patchDestination(d.id, { audioLayout: audioLayoutSel.value })
		syncAudioOutputsSummary(audioLayoutSel.value)
	})

	const vmSel = document.createElement('select')
	vmSel.className = 'device-view__destinations-type'
	vmSel.innerHTML = `<option value="custom">Custom</option>${STANDARD_VIDEO_MODES.map((m) => `<option value="${m}">${m}</option>`).join('')}`
	const currentMode = String(
		d?.videoMode || (d?.inheritsProjectFps !== false ? projectDefaultMode : '1080p5000'),
	)
	vmSel.value = STANDARD_VIDEO_MODES.includes(currentMode) ? currentMode : 'custom'

	const widthIn = document.createElement('input')
	widthIn.type = 'number'
	widthIn.min = '64'
	widthIn.step = '1'
	widthIn.className = 'device-view__destinations-type'
	widthIn.placeholder = 'Width'
	widthIn.value = String(Math.max(64, parseInt(String(d?.width ?? 1920), 10) || 1920))
	widthIn.disabled = vmSel.value !== 'custom'

	const heightIn = document.createElement('input')
	heightIn.type = 'number'
	heightIn.min = '64'
	heightIn.step = '1'
	heightIn.className = 'device-view__destinations-type'
	heightIn.placeholder = 'Height'
	heightIn.value = String(Math.max(64, parseInt(String(d?.height ?? 1080), 10) || 1080))
	heightIn.disabled = vmSel.value !== 'custom'

	const fpsIn = document.createElement('input')
	fpsIn.type = 'number'
	fpsIn.min = '1'
	fpsIn.step = '0.01'
	fpsIn.className = 'device-view__destinations-type'
	fpsIn.placeholder = 'Frame rate'
	fpsIn.value = String(Math.max(1, parseFloat(String(d?.fps ?? 50)) || 50))
	fpsIn.disabled = vmSel.value !== 'custom'

	const applyStandardVideoMode = (modeId) => {
		const spec = CASPAR_VIDEO_MODE_SPECS[modeId]
		if (!spec) return
		widthIn.value = String(spec.width)
		heightIn.value = String(spec.height)
		fpsIn.value = String(spec.fps)
		widthIn.disabled = true
		heightIn.disabled = true
		fpsIn.disabled = true
		syncVideoModeSummary(modeId, spec.width, spec.height, spec.fps)
		patchDestination(d.id, { videoMode: modeId, width: spec.width, height: spec.height, fps: spec.fps, inheritsProjectFps: false })
	}
	vmSel.addEventListener('change', () => {
		if (vmSel.value === 'custom') {
			const width = Math.max(64, parseInt(String(d?.width ?? 1920), 10) || 1920)
			const height = Math.max(64, parseInt(String(d?.height ?? 1080), 10) || 1080)
			const fps = Math.max(1, parseFloat(String(d?.fps ?? 50)) || 50)
			widthIn.value = String(width)
			heightIn.value = String(height)
			fpsIn.value = String(fps)
			widthIn.disabled = false
			heightIn.disabled = false
			fpsIn.disabled = false
			syncVideoModeSummary('custom', width, height, fps)
			patchDestination(d.id, { videoMode: 'custom', width, height, fps, inheritsProjectFps: false })
			return
		}
		applyStandardVideoMode(vmSel.value)
	})

	const ensureCustomModeSelected = () => {
		if (vmSel.value !== 'custom') vmSel.value = 'custom'
		widthIn.disabled = false
		heightIn.disabled = false
		fpsIn.disabled = false
	}
	widthIn.addEventListener('change', () => {
		ensureCustomModeSelected()
		const width = Math.max(64, parseInt(String(widthIn.value || 1920), 10) || 1920)
		const fallbackHeight = d?.height ?? 1080
		const height = Math.max(64, parseInt(String(heightIn.value || fallbackHeight), 10) || 1080)
		const fps = Math.max(1, parseFloat(String(fpsIn.value || (d?.fps ?? 50))) || 50)
		syncVideoModeSummary('custom', width, height, fps)
		patchDestination(d.id, { videoMode: 'custom', width, height })
	})

	heightIn.addEventListener('change', () => {
		ensureCustomModeSelected()
		const fallbackWidth = d?.width ?? 1920
		const width = Math.max(64, parseInt(String(widthIn.value || fallbackWidth), 10) || 1920)
		const height = Math.max(64, parseInt(String(heightIn.value || 1080), 10) || 1080)
		const fps = Math.max(1, parseFloat(String(fpsIn.value || (d?.fps ?? 50))) || 50)
		syncVideoModeSummary('custom', width, height, fps)
		patchDestination(d.id, { videoMode: 'custom', width, height })
	})

	fpsIn.addEventListener('change', () => {
		ensureCustomModeSelected()
		const width = Math.max(64, parseInt(String(widthIn.value || (d?.width ?? 1920)), 10) || 1920)
		const height = Math.max(64, parseInt(String(heightIn.value || (d?.height ?? 1080)), 10) || 1080)
		const fps = Math.max(1, parseFloat(String(fpsIn.value || 50)) || 50)
		syncVideoModeSummary('custom', width, height, fps)
		patchDestination(d.id, { videoMode: 'custom', fps })
	})
	const rm = document.createElement('button')
	rm.type = 'button'
	rm.className = 'header-btn'
	rm.textContent = 'Remove destination'
	rm.addEventListener('click', () => removeDestination(d.id))

	edits.append(nameIn, mainIn, modeSel)
	if (mode !== 'multiview' && mode !== 'stream') {
		const audioOutputsWrap = Object.assign(document.createElement('div'), {
			style: 'display:flex; flex-direction:column; gap:4px; width:100%',
		})
		const audioLab = Object.assign(document.createElement('label'), {
			className: 'device-view__inspector-label',
			htmlFor: audioOutputsFieldId,
			textContent: 'Audio outputs',
			style: 'font-size:10px;opacity:.7',
		})
		audioOutputsWrap.append(audioLab, audioLayoutSel)
		edits.append(audioOutputsWrap)
	}
	edits.append(vmSel, widthIn, heightIn, fpsIn, rm)
	host.append(
		Object.assign(document.createElement('p'), { className: 'device-view__status', textContent: 'Selected destination' }),
		table,
		outputMapWrap,
		edits
	)
}
