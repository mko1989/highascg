'use strict'

const defaults = require('./defaults')
const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { normalizeProgramLayout } = require('./audio-channel-layouts')

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * `parseInt(...) || def` silently discards a legitimate `0` (falsy) and substitutes `def` instead
 * of clamping it — wrong whenever `def !== min` (e.g. refresh-rate default 10, min 1; port default
 * 6454, min 1). This clamps the *parsed* value, only substituting `def` when parsing truly failed.
 * @param {unknown} raw
 * @param {number} def
 * @param {number} min
 * @param {number} max
 */
function clampedInt(raw, def, min, max) {
	const n = parseInt(String(raw ?? def), 10)
	const v = Number.isFinite(n) ? n : def
	return Math.min(max, Math.max(min, v))
}

function isValidIpv4(s) {
	const m = IPV4_RE.exec(String(s || '').trim())
	if (!m) return false
	return m.slice(1, 5).every((oct) => {
		const n = parseInt(oct, 10)
		return Number.isFinite(n) && n >= 0 && n <= 255
	})
}

/**
 * WO-242: `pixelmap` destination fixture-array params, mapped 1:1 onto the real native `<artnet>`
 * consumer schema documented (with `artnet_consumer.cpp` cites) in
 * docs/WALKTHROUGH_ARTNET_LED_WALL.md — only schema elements listed there are used.
 * `rows` x `cols` become one `<fixture-count>cols x rows</fixture-count>` group covering the
 * whole channel raster (row-major grid, per the walkthrough's 8x4-wall example).
 * @param {Record<string, unknown>} raw
 */
function normalizeArtnetFixtureArray(raw) {
	const a = raw && typeof raw === 'object' ? raw : {}
	const ip = isValidIpv4(a.ip) ? String(a.ip).trim() : ''
	// artnet_consumer.cpp:595-600 — fixture/port, 1-65535 (Art-Net standard 6454).
	const port = clampedInt(a.port, 6454, 1, 65535)
	// artnet_consumer.cpp:602-607 — fixture/universe, 0-32767.
	const startUniverse = clampedInt(a.startUniverse, 0, 0, 32767)
	// artnet_consumer.cpp:577-583 — fixture/start-address, 1-based DMX, 1-512.
	const startAddress = clampedInt(a.startAddress, 1, 1, 512)
	// artnet_consumer.cpp:633-645 — fixture/type: DIMMER | RGB | RGBW (case-insensitive). WO-242's
	// model exposes RGB/RGBW only (no per-pixel dimmer walls in this flow).
	const colorOrder = String(a.colorOrder || 'RGB').trim().toUpperCase() === 'RGBW' ? 'RGBW' : 'RGB'
	// artnet_consumer.cpp:609-631 — fixture/fixture-count "WxH" grid; rows/cols map to H/W (walkthrough step 3).
	const rows = clampedInt(a.rows, 1, 1, 4096)
	const cols = clampedInt(a.cols, 1, 1, 4096)
	// artnet_consumer.cpp:748-751,:67 — refresh-rate, int >= 1 DMX sends/sec, default 10.
	const refreshRateHz = clampedInt(a.refreshRateHz, 10, 1, 1000)
	return { ip, port, startUniverse, startAddress, colorOrder, rows, cols, refreshRateHz }
}

function normalizeDestination(d) {
	if (!d || typeof d !== 'object') return null
	const id = String(d.id || '').trim()
	const label = String(d.label != null && d.label !== '' ? d.label : id).trim() || 'Destination'
	if (!id) return null
	const m = parseInt(String(d.mainScreenIndex ?? 0), 10)
	const mainScreenIndex = Number.isFinite(m) && m >= 0 ? m : 0
	const bus = d.caspar && d.caspar.bus === 'prv' ? 'prv' : 'pgm'
	const modeRaw = String(d.mode || '')
	const mode =
		modeRaw === 'pgm_only'
			? 'pgm_only'
			: modeRaw === 'multiview'
				? 'multiview'
				: modeRaw === 'stream'
					? 'stream'
					: modeRaw === 'host_channel'
						? 'host_channel'
						: modeRaw === 'pixelmap'
							? 'pixelmap'
							: 'pgm_prv'
	const width = Math.max(64, parseInt(String(d.width ?? 1920), 10) || 1920)
	const height = Math.max(64, parseInt(String(d.height ?? 1080), 10) || 1080)
	const fps = Math.max(1, parseFloat(String(d.fps ?? 50)) || 50)
	// WO-242: pixelmap screens are raster-exact by default (custom WxH), not a standard mode,
	// since the fixture grid is normally sized to the wall, not a stock broadcast resolution.
	const videoMode = String(
		d.videoMode != null && d.videoMode !== '' ? d.videoMode : mode === 'pixelmap' ? 'custom' : '1080p5000',
	).trim() || (mode === 'pixelmap' ? 'custom' : '1080p5000')
	const std = videoMode !== 'custom' ? STANDARD_VIDEO_MODES[videoMode] : null
	const hostRole = String(d.hostRole || '').trim()
	const casparChannel = parseInt(String(d.casparChannel ?? ''), 10)
	const inputSlot = parseInt(String(d.inputSlot ?? ''), 10)
	const base = {
		id,
		label,
		mainScreenIndex,
		mode,
		/** Caspar program bus width for this destination's PGM output (`stereo` | `4ch` | `8ch` | `16ch`). */
		audioLayout: normalizeProgramLayout(d.audioLayout || 'stereo'),
		videoMode,
		width: std ? std.width : width,
		height: std ? std.height : height,
		fps: std ? std.fps : fps,
		caspar: { bus },
		edidLabel: d.edidLabel != null ? String(d.edidLabel) : '',
		/** When true (default), video mode tracks machineProfile.defaultProjectFps until customized. */
		inheritsProjectFps: d.inheritsProjectFps !== false,
		stream:
			d.stream && typeof d.stream === 'object'
				? {
					type: String(d.stream.type || 'rtmp') === 'ndi' ? 'ndi' : 'rtmp',
					source: d.stream.source != null ? String(d.stream.source) : 'program_1',
					url: d.stream.url != null ? String(d.stream.url) : '',
					key: d.stream.key != null ? String(d.stream.key) : '',
					quality: String(d.stream.quality || 'medium'),
				}
				: { type: 'rtmp', source: 'program_1', url: '', key: '', quality: 'medium' },
	}
	if (mode === 'host_channel') {
		base.virtual = true
		if (hostRole) base.hostRole = hostRole
		if (Number.isFinite(casparChannel) && casparChannel >= 1) base.casparChannel = casparChannel
		if (Number.isFinite(inputSlot) && inputSlot >= 1) base.inputSlot = inputSlot
		if (d.sourceId) base.sourceId = String(d.sourceId)
	}
	if (mode === 'pixelmap') {
		base.artnet = normalizeArtnetFixtureArray(d.artnet)
	}
	return base
}

function normalizeScreenDestinations(raw) {
	const base = defaults.screenDestinations && typeof defaults.screenDestinations === 'object' ? defaults.screenDestinations : {}
	const x = raw && typeof raw === 'object' ? raw : {}
	return {
		version: 1,
		destinations: Array.isArray(x.destinations)
			? x.destinations.map(normalizeDestination).filter(Boolean)
			: Array.isArray(base.destinations)
				? base.destinations
				: [],
		edidNotes: typeof x.edidNotes === 'string' ? x.edidNotes : (base.edidNotes != null ? String(base.edidNotes) : ''),
	}
}

/**
 * Copy legacy `tandemTopology` into `screenDestinations` and drop the old key.
 * @param {object} cfg
 * @returns {object}
 */
function finalizeScreenDestinationsConfig(cfg) {
	if (!cfg || typeof cfg !== 'object') return cfg
	let rawSd =
		cfg.screenDestinations && typeof cfg.screenDestinations === 'object' ? { ...cfg.screenDestinations } : {}
	if (cfg.tandemTopology && typeof cfg.tandemTopology === 'object') {
		const leg = cfg.tandemTopology
		const legDest = Array.isArray(leg.destinations) ? leg.destinations : []
		const curDest = Array.isArray(rawSd.destinations) ? rawSd.destinations : []
		rawSd.destinations = curDest.length ? curDest : legDest
		const legNotes = typeof leg.edidNotes === 'string' ? leg.edidNotes : ''
		if (rawSd.edidNotes == null || rawSd.edidNotes === '') rawSd.edidNotes = legNotes
		delete cfg.tandemTopology
	}
	cfg.screenDestinations = normalizeScreenDestinations(rawSd)
	return cfg
}

function destinationsFromConfig(cfg) {
	return normalizeScreenDestinations(cfg?.screenDestinations).destinations
}

/**
 * Destinations for routing / channel math. When `screenDestinations.destinations` is **absent**, returns
 * `null` so screen counts follow Caspar (`screen_count`). When present (including `[]`), uses that list only.
 */
function routingDestinationsFromConfig(cfg) {
	if (!cfg || typeof cfg !== 'object') return null
	const sd = cfg.screenDestinations
	if (!sd || typeof sd !== 'object') return null
	if (!Object.prototype.hasOwnProperty.call(sd, 'destinations')) return null
	const raw = sd.destinations
	if (!Array.isArray(raw)) return []
	return raw.map(normalizeDestination).filter(Boolean)
}

/**
 * Program bus layout per main screen index from Device View destinations.
 * @param {object} [cfg]
 * @returns {Record<number, string>}
 */
function destinationAudioLayoutsByMain(cfg) {
	const byMain = /** @type {Record<number, string>} */ ({})
	for (const dest of destinationsFromConfig(cfg)) {
		const mode = String(dest.mode || '')
		if (mode === 'multiview' || mode === 'stream') continue
		const idx = Math.max(0, parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0)
		byMain[idx] = normalizeProgramLayout(dest.audioLayout || 'stereo')
	}
	return byMain
}

module.exports = {
	normalizeDestination,
	normalizeScreenDestinations,
	finalizeScreenDestinationsConfig,
	destinationsFromConfig,
	routingDestinationsFromConfig,
	destinationAudioLayoutsByMain,
	clampedInt,
}
