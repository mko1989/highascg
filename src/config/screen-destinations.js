'use strict'

const defaults = require('./defaults')

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
					: 'pgm_prv'
	const width = Math.max(64, parseInt(String(d.width ?? 1920), 10) || 1920)
	const height = Math.max(64, parseInt(String(d.height ?? 1080), 10) || 1080)
	const fps = Math.max(1, parseFloat(String(d.fps ?? 50)) || 50)
	const videoMode = String(d.videoMode || '1080p5000').trim() || '1080p5000'
	return {
		id,
		label,
		mainScreenIndex,
		mode,
		videoMode,
		width,
		height,
		fps,
		caspar: { bus },
		edidLabel: d.edidLabel != null ? String(d.edidLabel) : '',
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

module.exports = {
	normalizeDestination,
	normalizeScreenDestinations,
	finalizeScreenDestinationsConfig,
	destinationsFromConfig,
	routingDestinationsFromConfig,
}
