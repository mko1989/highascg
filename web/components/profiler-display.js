/**
 * Channel profiler from OSC `channel.profiler` (frame time actual vs expected).
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'

/** @param {number} a @param {number} e */
export function profilerTier(a, e) {
	if (!Number.isFinite(a) || !Number.isFinite(e) || e <= 0) return 'muted'
	const r = a / e
	if (r <= 1.02) return 'green'
	if (r <= 1.05) return 'yellow'
	return 'red'
}

const DOT = { green: '#2ecc71', yellow: '#f1c40f', red: '#e74c3c', muted: '#666' }

/**
 * @param {HTMLElement} container
 * @param {{ channel: number, oscClient: import('../lib/osc-client.js').OscClient, compact?: boolean }} opts
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountProfilerDisplay(container, opts) {
	const { channel, oscClient, compact = false } = opts
	if (!oscClient) throw new Error('mountProfilerDisplay: oscClient required')
	container.className = 'profiler-display'
	container.style.cssText = compact
		? `display:inline-flex;align-items:center;gap:4px;font:11px ${UI_FONT_FAMILY}`
		: `display:flex;align-items:center;gap:8px;font:12px ${UI_FONT_FAMILY}`
	container.innerHTML =
		'<span class="profiler-display__dot" style="width:' +
		(compact ? 8 : 10) +
		'px;height:' +
		(compact ? 8 : 10) +
		'px;border-radius:50%;flex-shrink:0;background:#666"></span>' +
		'<span class="profiler-display__label"></span>'
	const dot = container.querySelector('.profiler-display__dot')
	const label = container.querySelector('.profiler-display__label')

	function paint(p) {
		const a = p?.actual
		const e = p?.expected
		const t = profilerTier(a, e)
		dot.style.background = DOT[t] || DOT.muted
		if (compact) {
			label.textContent = ''
			container.title = Number.isFinite(a) && Number.isFinite(e) ? `${a.toFixed(2)} / ${e.toFixed(2)} ms` : ''
		} else {
			container.title = ''
			label.textContent =
				Number.isFinite(a) && Number.isFinite(e) ? `${a.toFixed(2)} / ${e.toFixed(2)} ms` : '—'
		}
	}

	function refresh() {
		const ch = oscClient.channels[String(channel)] || oscClient.channels[channel]
		paint(ch?.profiler || {})
	}

	const unsub = oscClient.onProfiler(channel, (p) => paint(p))
	refresh()
	return {
		destroy() {
			unsub()
			container.textContent = ''
			container.className = ''
			container.style.cssText = ''
			container.title = ''
		},
		refresh,
	}
}
