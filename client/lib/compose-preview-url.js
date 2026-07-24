import { getApiBase } from './api-client.js'
import { resolveMainIndexForScene } from './look-stack-amcp-channel.js'
import { settingsState } from './settings-state.js'
import { isOperatorGuiModeActive } from './operator-gui-mode.js'

/**
 * Operator-GUI pages force 'native': the shaped Caspar overlay IS the preview there, so neither
 * canvas thumbnails nor the ffmpeg JPEG poll should run (owner 2026-07-16: "start with the
 * compose preview setting set to native so it doesnt interfere"). This is a per-page override —
 * the shared server setting is untouched, so normal browsers keep their configured mode.
 *
 * This returns the BASE rendering mode. The 'stream' setting (WO-319 Live preview) is not a base
 * mode — it is a hardware-encoded video that OVERLAYS the compose surfaces (driven separately via
 * isStreamComposePreview() → the operator live canvas). Its base underneath is canvas thumbnails,
 * so 'stream' maps to 'canvas' here and the stream blits on top once frames arrive (and falls back
 * to plain thumbnails when the gui-stream channel / WebCodecs is unavailable on this client).
 * @returns {'canvas' | 'ffmpeg_jpeg' | 'native'}
 */
export function resolveComposePreviewMode() {
	if (isOperatorGuiModeActive()) return 'native'
	const mode = settingsState.getSettings()?.composePreview?.mode
	if (mode === 'ffmpeg_jpeg' || mode === 'canvas') return mode
	if (mode === 'stream') return 'canvas'
	return 'canvas'
}

/**
 * True when the shared compose-preview setting selects the WO-319 Live preview stream, EXCEPT on
 * operator-GUI pages (which use their own shaped 'native' overlay and must not also decode a stream).
 * Drives the per-client operator live canvas; actual acquisition still gates on the gui-stream
 * channel being available AND the browser supporting WebCodecs (see preview-canvas-live-stream.js).
 * @returns {boolean}
 */
export function isStreamComposePreview() {
	if (isOperatorGuiModeActive()) return false
	return settingsState.getSettings()?.composePreview?.mode === 'stream'
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
	return isFfmpegJpegComposePreview()
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
 * Caspar PGM/PRV channels used for compose-preview JPEG polling (not MVR / live inputs).
 * @param {{ screenCount?: number, programChannels?: number[], previewChannels?: number[], previewEnabledByMain?: boolean[], multiviewCh?: number, multiviewChannels?: number[] } | null | undefined} cm
 * @returns {number[]}
 */
export function resolveComposePreviewChannelsFromChannelMap(cm = {}) {
	const ch = new Set()
	const push = (n) => {
		const v = parseInt(String(n), 10)
		if (Number.isFinite(v) && v > 0) ch.add(v)
	}
	const mv = new Set()
	for (const c of cm.multiviewChannels || []) mv.add(Number(c))
	if (cm.multiviewCh != null) mv.add(Number(cm.multiviewCh))

	const screenCount = Math.max(1, cm.screenCount || cm.programChannels?.length || 1)
	for (let i = 0; i < screenCount; i++) {
		if (cm.previewEnabledByMain?.[i] === false) {
			push(cm.programChannels?.[i])
			continue
		}
		push(cm.programChannels?.[i])
		push(cm.previewChannels?.[i])
	}
	for (const n of mv) {
		if (Number.isFinite(n) && n > 0) ch.delete(n)
	}
	const out = [...ch].sort((a, b) => a - b)
	return out.length ? out : [1]
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
