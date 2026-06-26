/**
 * Collect media clip paths and template ids referenced by a project JSON export.
 */

const SKIP_VALUE_RE = /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route):/i

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
 * @param {object | null | undefined} layer
 * @param {Set<string>} media
 * @param {Set<string>} templates
 */
function walkSceneLayer(layer, media, templates) {
	if (!layer || typeof layer !== 'object') return
	addSourceRef(layer.source, media, templates)
	for (const item of layer.playlist || []) {
		addSourceRef(item, media, templates)
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

	const scenesBlock = project.scenes
	const sceneList = Array.isArray(scenesBlock)
		? scenesBlock
		: Array.isArray(scenesBlock?.scenes)
			? scenesBlock.scenes
			: []

	for (const scene of sceneList) {
		for (const layer of scene?.layers || []) {
			walkSceneLayer(layer, media, templates)
		}
	}

	const timelinesBlock = project.timelines
	const timelineList = Array.isArray(timelinesBlock)
		? timelinesBlock
		: Array.isArray(timelinesBlock?.timelines)
			? timelinesBlock.timelines
			: []

	for (const tl of timelineList) {
		for (const layer of tl?.layers || []) {
			for (const clip of layer?.clips || []) {
				addSourceRef(clip?.source, media, templates)
			}
		}
	}

	return {
		media: [...media].sort((a, b) => a.localeCompare(b)),
		templates: [...templates].sort((a, b) => a.localeCompare(b)),
	}
}
