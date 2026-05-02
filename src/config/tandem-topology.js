'use strict'

const defaults = require('./defaults')

/**
 * @param {any} d
 * @returns {object | null}
 */
function normalizeDestination(d) {
	if (!d || typeof d !== 'object') return null
	const id = String(d.id || '').trim()
	const label = String(d.label != null && d.label !== '' ? d.label : id).trim() || 'Destination'
	if (!id) return null
	const m = parseInt(String(d.mainScreenIndex ?? 0), 10)
	const mainScreenIndex = Number.isFinite(m) && m >= 0 ? m : 0
	const bus = d.caspar && d.caspar.bus === 'prv' ? 'prv' : 'pgm'
	const ph = d.pixelhue && typeof d.pixelhue === 'object' ? d.pixelhue : {}
	const layerId = ph.layerId != null && ph.layerId !== '' ? parseInt(String(ph.layerId), 10) : null
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
		pixelhue: {
			layerId: layerId != null && Number.isFinite(layerId) ? layerId : null,
			screenGuid: ph.screenGuid != null ? String(ph.screenGuid) : '',
			role: ph.role === 'camera' || ph.role === 'caspar_pgm' ? ph.role : 'caspar_pgm',
		},
		signalPathId: d.signalPathId != null ? String(d.signalPathId).trim() : '',
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

/**
 * @param {any} s
 * @returns {object | null}
 */
function normalizeSignalPath(s) {
	if (!s || typeof s !== 'object') return null
	const id = String(s.id || '').trim()
	if (!id) return null
	const k = s.kind === 'camera_in' || s.kind === 'caspar_in' || s.kind === 'caspar_out' ? s.kind : 'caspar_in'
	const phId = s.phInterfaceId
	const phInterfaceId =
		phId != null && phId !== '' ? parseInt(String(phId), 10) : null
	return {
		id,
		label: String(s.label != null ? s.label : id),
		kind: k,
		phInterfaceId: phInterfaceId != null && Number.isFinite(phInterfaceId) ? phInterfaceId : null,
		caspar:
			s.caspar && typeof s.caspar === 'object'
				? {
						bus: s.caspar.bus === 'prv' ? 'prv' : 'pgm',
						mainIndex: Math.max(0, parseInt(String(s.caspar.mainIndex ?? 0), 10) || 0),
					}
				: { bus: 'pgm', mainIndex: 0 },
		edidLabel: s.edidLabel != null ? String(s.edidLabel) : '',
		notes: s.notes != null ? String(s.notes) : '',
	}
}

/**
 * @param {any} raw
 * @returns {object}
 */
function normalizeTandemTopology(raw) {
	const base = defaults.tandemTopology && typeof defaults.tandemTopology === 'object' ? defaults.tandemTopology : {}
	const x = raw && typeof raw === 'object' ? raw : {}
	return {
		version: 1,
		destinations: Array.isArray(x.destinations)
			? x.destinations.map(normalizeDestination).filter(Boolean)
			: Array.isArray(base.destinations)
				? base.destinations
				: [],
		signalPaths: Array.isArray(x.signalPaths)
			? x.signalPaths.map(normalizeSignalPath).filter(Boolean)
			: Array.isArray(base.signalPaths)
				? base.signalPaths
				: [],
		edidNotes: typeof x.edidNotes === 'string' ? x.edidNotes : (base.edidNotes != null ? String(base.edidNotes) : ''),
	}
}

module.exports = { normalizeTandemTopology, normalizeDestination, normalizeSignalPath }
