/**
 * Channel output consumers from OSC `channel.outputs[portId]` (type, frames, maxFrames).
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'

/**
 * @param {{ type?: string | null, frames?: number | null, maxFrames?: number | null } | null | undefined} out
 */
export function formatOutputLine(out) {
	if (!out) return '—'
	const type = String(out.type || '').trim() || 'output'
	const t = type.toLowerCase()
	const fr = out.frames
	const mx = out.maxFrames
	const hasFr = Number.isFinite(fr)
	const fileLike = t.includes('file') || t.includes('ffmpeg') || (hasFr && Number.isFinite(mx))
	if (fileLike && hasFr) {
		return `${type} · ${fr}/${Number.isFinite(mx) ? mx : '—'} fr`
	}
	const streamLike = t.includes('stream') || t.includes('rtmp') || t.includes('udp') || t.includes('srt')
	if (streamLike) {
		return hasFr ? `${type} · ${fr} fr` : `${type} · live`
	}
	return hasFr ? `${type} · ${fr} fr` : type
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   channel: number,
 *   oscClient: import('../lib/osc-client.js').OscClient,
 *   portId?: number | string | null,
 *   compact?: boolean,
 *   pollMs?: number,
 * }} opts
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountOutputStatus(container, opts) {
	const { channel, oscClient, portId = null, compact = false, pollMs = 200 } = opts
	if (!oscClient) throw new Error('mountOutputStatus: oscClient required')
	container.className = 'output-status'
	container.style.cssText = compact
		? `font:11px ${UI_FONT_FAMILY};opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:28em`
		: `font:12px ${UI_FONT_FAMILY};line-height:1.4`
	const el = document.createElement('div')
	container.appendChild(el)

	function paint() {
		const ch = oscClient.channels[String(channel)] || oscClient.channels[channel]
		const outs = ch?.outputs || {}
		let keys = Object.keys(outs).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
		if (portId != null && portId !== '') keys = keys.filter((k) => String(k) === String(portId))
		if (keys.length === 0) {
			el.textContent = '—'
			return
		}
		const lines = keys.map((k) => `P${k}: ${formatOutputLine(outs[k])}`)
		el.textContent = compact ? lines.join(' · ') : lines.join('\n')
	}

	paint()
	const iv = setInterval(paint, pollMs)
	return {
		destroy() {
			clearInterval(iv)
			container.textContent = ''
			container.className = ''
			container.style.cssText = ''
		},
		refresh: paint,
	}
}
