/**
 * Collect media clip paths and template ids referenced by a project JSON export.
 */

const SKIP_VALUE_RE = /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route):/i

/**
 * @param {object} project
 * @returns {object[]}
 */
export function listProjectScenes(project) {
	const scenesBlock = project?.scenes
	if (Array.isArray(scenesBlock)) return scenesBlock
	if (Array.isArray(scenesBlock?.scenes)) return scenesBlock.scenes
	return []
}

/**
 * @param {object} project
 * @returns {object[]}
 */
export function listProjectTimelines(project) {
	const timelinesBlock = project?.timelines
	if (Array.isArray(timelinesBlock)) return timelinesBlock
	if (Array.isArray(timelinesBlock?.timelines)) return timelinesBlock.timelines
	return []
}

/**
 * Visit every layer/playlist/timeline clip media source in a project export.
 * @param {object} project
 * @param {(source: object) => void} visit
 */
export function forEachProjectMediaSource(project, visit) {
	if (!project || typeof project !== 'object' || typeof visit !== 'function') return

	for (const scene of listProjectScenes(project)) {
		for (const layer of scene?.layers || []) {
			if (layer?.source) visit(layer.source)
			for (const item of layer?.playlist || []) {
				if (item) visit(item)
			}
		}
	}

	for (const tl of listProjectTimelines(project)) {
		for (const layer of tl?.layers || []) {
			for (const clip of layer?.clips || []) {
				if (clip?.source) visit(clip.source)
			}
		}
	}

	const scenesBlock = project.scenes
	const layerPresets = Array.isArray(scenesBlock?.layerPresets) ? scenesBlock.layerPresets : []
	for (const preset of layerPresets) {
		const data = preset?.data
		if (data?.source) visit(data.source)
		for (const item of data?.playlist || []) {
			if (item) visit(item)
		}
	}

	for (const cell of project.multiview?.cells || []) {
		if (cell?.source && typeof cell.source === 'object') visit(cell.source)
	}
}

/**
 * @param {object | null | undefined} source
 * @param {Set<string>} media
 * @param {Set<string>} templates
 */
function addSourceRef(source, media, templates) {
	if (!source || typeof source !== 'object') return
	if (source.isPlaceholder || String(source.type || '').toLowerCase() === 'placeholder') return

	const value = String(source.value || '').trim()
	if (!value) return

	const t = String(source.type || 'media').toLowerCase()
	if (t === 'template' || t === 'html') {
		templates.add(value.replace(/\.html$/i, ''))
		return
	}
	if (t === 'timeline' || t === 'effect' || t === 'live') return
	if (SKIP_VALUE_RE.test(value)) return

	if (t === 'media' || t === 'file' || !t) {
		media.add(value)
	}
}

/**
 * @param {object} project
 * @returns {{ media: string[], templates: string[] }}
 */
export function collectProjectAssetRefs(project) {
	const media = new Set()
	const templates = new Set()
	if (!project || typeof project !== 'object') {
		return { media: [], templates: [] }
	}

	forEachProjectMediaSource(project, (source) => addSourceRef(source, media, templates))

	return {
		media: [...media].sort((a, b) => a.localeCompare(b)),
		templates: [...templates].sort((a, b) => a.localeCompare(b)),
	}
}
