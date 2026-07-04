/**
 * Shared DeckLink inspector helpers and constants.
 */
import { CASPAR_HOST } from './device-view-helpers.js'

export const DECKLINK_LATENCY_OPTIONS = ['normal', 'low', 'default']
export const DECKLINK_COLOR_SPACE_OPTIONS = ['bt709', 'bt601', 'bt2020']
export const DECKLINK_CHANNEL_LAYOUT_OPTIONS = [
	{ id: 'stereo', label: 'Stereo' },
	{ id: 'mono', label: 'Mono' },
	{ id: '8ch', label: '8ch (discrete)' },
]

export function decklinkOutputStatusForConnector(lastPayload, connectorId) {
	const outputs = Array.isArray(lastPayload?.live?.decklink?.outputs) ? lastPayload.live.decklink.outputs : []
	return outputs.find((o) => String(o?.connectorId || '') === String(connectorId || '')) || null
}

export function formatInheritedDecklinkMode(inherited) {
	if (!inherited) return '—'
	const mode = String(inherited.standardModeId || inherited.videoMode || '').trim()
	const w = inherited.width
	const h = inherited.height
	const fps = inherited.fps
	if (mode && w && h && fps) return `${mode} (${w}×${h} @ ${fps} Hz)`
	if (mode) return mode
	if (w && h && fps) return `${w}×${h} @ ${fps} Hz`
	return '—'
}

export function appendDecklinkSectionHeading(parent, text) {
	parent.append(
		Object.assign(document.createElement('h4'), {
			className: 'device-view__decklink-io-heading',
			textContent: text,
		}),
	)
}

export function appendDecklinkSectionNote(parent, text) {
	parent.append(
		Object.assign(document.createElement('p'), {
			className: 'device-view__decklink-io-note',
			textContent: text,
		}),
	)
}

export function readDecklinkConsumerCaspar(conn) {
	const c = conn?.caspar || {}
	return {
		outputVideoMode: String(c.decklinkOutputVideoMode || '').trim(),
		embeddedAudio: c.decklinkEmbeddedAudio !== false && c.decklinkEmbeddedAudio !== 'false',
		channelLayout: String(c.decklinkChannelLayout || 'stereo').toLowerCase(),
		latency: String(c.decklinkLatency || 'normal').toLowerCase(),
		bufferDepth: Math.min(3, Math.max(1, parseInt(String(c.decklinkBufferDepth ?? 3), 10) || 3)),
		colorSpace: String(c.decklinkColorSpace || 'bt709').toLowerCase(),
	}
}

export function decklinkMergedConnectors(lastPayload) {
	const sug = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	const deckIo = sug.filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_io')
	const deckOut = sug.filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_out')
	return [...deckIo, ...deckOut].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
}
