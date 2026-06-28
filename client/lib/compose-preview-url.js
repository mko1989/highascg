import { getApiBase } from './api-client.js'
import { resolveMainIndexForScene } from './look-stack-amcp-channel.js'
import { settingsState } from './settings-state.js'

/**
 * @returns {'canvas' | 'caspar_image' | 'ffmpeg_jpeg'}
 */
export function resolveComposePreviewMode() {
	const mode = settingsState.getSettings()?.composePreview?.mode
	if (mode === 'ffmpeg_jpeg' || mode === 'caspar_image') return mode
	return 'canvas'
}

/**
 * @returns {boolean}
 */
export function isCasparImageComposePreview() {
	return resolveComposePreviewMode() === 'caspar_image'
}

/**
 * @returns {boolean}
 */
export function isFfmpegJpegComposePreview() {
	return resolveComposePreviewMode() === 'ffmpeg_jpeg'
}

/**
 * @returns {boolean}
 */
export function isSnapshotComposePreview() {
	const mode = resolveComposePreviewMode()
	return mode === 'ffmpeg_jpeg' || mode === 'caspar_image'
}

/**
 * @param {number} channel
 * @param {string} [etag]
 */
export function getComposePreviewUrl(channel, etag) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const ext = isFfmpegJpegComposePreview() ? 'jpg' : 'png'
	const base = `${getApiBase()}/api/compose-preview/${ch}.${ext}`
	if (etag != null && String(etag).trim() !== '') {
		return `${base}?v=${encodeURIComponent(String(etag))}`
	}
	return base
}

/**
 * Companion / Stream Deck square thumb (144×144 by default).
 * @param {number} channel
 * @param {string} [etag]
 */
export function getComposePreviewCompanionUrl(channel, etag) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const base = `${getApiBase()}/api/compose-preview/${ch}/companion.jpg`
	if (etag != null && String(etag).trim() !== '') {
		return `${base}?v=${encodeURIComponent(String(etag))}`
	}
	return base
}

/**
 * @param {number} channel
 */
export function getComposePreviewMetaUrl(channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	return `${getApiBase()}/api/compose-preview/${ch}/meta`
}

/**
 * Resolve Caspar channel for a compose cell from channelMap.
 * @param {{ composeCell?: string, composeScreenIdx?: number }} meta
 * @param {{ programChannels?: number[], previewChannels?: number[] } | null | undefined} channelMap
 * @param {number} [fallbackScreenIdx]
 * @returns {number | null}
 */
export function resolveComposeChannelForCell(meta, channelMap, fallbackScreenIdx = 0) {
	const screenIdx = Number.isFinite(Number(meta?.composeScreenIdx))
		? Number(meta.composeScreenIdx)
		: fallbackScreenIdx
	const pgm = channelMap?.programChannels?.[screenIdx]
	const prv = channelMap?.previewChannels?.[screenIdx]
	if (meta?.composeCell === 'prv') {
		return prv != null && prv > 0 ? prv : null
	}
	if (meta?.composeCell === 'pgm') {
		return pgm != null && pgm > 0 ? pgm : pgm ?? 1
	}
	return pgm != null && pgm > 0 ? pgm : 1
}

/**
 * Caspar channel + main index for the compose preview of a look being edited or previewed.
 * Matches {@link resolveLookStackChannelForBus} edit routing (PRV unless edit-on-PGM).
 * @param {{ mainScope?: string } | null | undefined} scene
 * @param {{ activeScreenIndex?: number, editOnPgm?: boolean }} sceneState
 * @param {{ programChannels?: number[], previewChannels?: number[] } | null | undefined} channelMap
 * @returns {{ mainIdx: number, channel: number | null, cell: 'pgm' | 'prv' }}
 */
export function resolveComposeChannelForEditingScene(scene, sceneState, channelMap) {
	const mainIdx = scene
		? resolveMainIndexForScene(scene, sceneState)
		: Math.max(0, sceneState?.activeScreenIndex ?? 0)
	const cell = sceneState?.editOnPgm ? 'pgm' : 'prv'
	let channel = resolveComposeChannelForCell({ composeCell: cell, composeScreenIdx: mainIdx }, channelMap, mainIdx)
	if ((!channel || channel <= 0) && cell === 'prv') {
		channel = resolveComposeChannelForCell({ composeCell: 'pgm', composeScreenIdx: mainIdx }, channelMap, mainIdx)
	}
	return { mainIdx, channel: channel != null && channel > 0 ? channel : null, cell }
}
