'use strict'

import { api } from '../lib/api-client.js'

/** @param {string} name */
export function drmShort(name) {
	return String(name || '').replace(/^card\d+-/i, '')
}

/**
 * @param {Array<{ name?: string } | string>} displayList
 * @param {string} selectedId
 */
export function findDisplayDetail(displayList, selectedId) {
	if (!selectedId) return null
	const s = String(selectedId)
	return (
		displayList.find((d) => {
			const n = typeof d === 'string' ? d : d.name
			return n === s || drmShort(n) === drmShort(s)
		}) || null
	)
}

/**
 * Matches generated Caspar multiview: show X11 mapping row only when multiview uses a screen window.
 * @param {Record<string, unknown>} cs
 */
export function multiviewUiShowsScreenRow(cs) {
	const mode = String(cs?.multiview_output_mode || '').trim()
	if (mode === 'stream_only' || mode === 'decklink_only' || mode === 'decklink_stream') return false
	if (
		mode === 'screen_only' ||
		mode === 'screen_decklink' ||
		mode === 'screen_stream_decklink' ||
		mode === 'screen_stream'
	) {
		return true
	}
	if (!mode) return cs.multiview_screen_consumer !== false && cs.multiview_screen_consumer !== 'false'
	return false
}

/**
 * @param {string} mode
 * @param {string|number} rate
 */
export function packOsValue(mode, rate) {
	const m = String(mode || '').trim()
	const r = String(rate || '').trim()
	if (!m) return ''
	if (!r) return m
	return `${m}@${r}`
}

export function escAttr(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
}

export function escHtml(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

/**
 * Caspar OpenAL device names per screen — dropdowns use the same list as ALSA/PipeWire discovery (device name strings).
 * @param {HTMLElement} mount
 * @param {Array<{ name?: string, id?: string }>} devices
 * @param {Record<string, unknown>} cs - casparServer slice (needs screen_count)
 * @param {Record<string, unknown>} audioAr
 */
export function renderCasparOpenalSection(mount, devices, cs, audioAr) {
	const prog = audioAr.programSystemAudioDevices || []
	const prevEn = audioAr.previewSystemAudioEnabled || []
	const prevDev = audioAr.previewSystemAudioDevices || []
	const count = Math.min(4, Math.max(1, parseInt(String(cs?.screen_count ?? 1), 10) || 1))
	const names = []
	const seen = new Set()
	for (const d of devices) {
		const n = d.name || d.id
		if (n && !seen.has(n)) {
			seen.add(n)
			names.push(n)
		}
	}

	function selectHtml(id, current) {
		const cur = String(current ?? '').trim()
		let html = '<option value="">Default</option>'
		for (const name of names) {
			const sel = cur === name ? ' selected' : ''
			html += `<option value="${escAttr(name)}"${sel}>${escHtml(name)}</option>`
		}
		if (cur && !names.includes(cur)) {
			html += `<option value="${escAttr(cur)}" selected>${escHtml(cur)} (saved)</option>`
		}
		return `<select id="${id}" class="sys-openal-select" style="width:100%">${html}</select>`
	}

	let html = ''
	for (let n = 1; n <= count; n++) {
		const pgmVal = prog[n - 1]
		const prvE = prevEn[n - 1] === true
		const prvVal = prevDev[n - 1]
		html +=
			`<div class="settings-group settings-group--openal-screen" style="border-left:3px solid var(--border);padding-left:0.75rem;margin-bottom:0.75rem">` +
			`<h4 style="margin:0 0 0.4rem;font-size:13px;font-weight:600">Screen ${n} — Caspar (OpenAL)</h4>` +
			`<label>Program (PGM)</label>` +
			selectHtml(`set-caspar-screen-${n}-pgm-openal`, pgmVal) +
			`<label style="margin-top:0.5rem;display:inline-flex;align-items:center;gap:0.35rem">` +
			`<input type="checkbox" id="set-caspar-screen-${n}-prv-openal-en"${prvE ? ' checked' : ''}> Preview → system audio</label>` +
			`<label style="margin-top:0.5rem">Preview (PRV)</label>` +
			selectHtml(`set-caspar-screen-${n}-prv-openal`, prvVal) +
			`</div>`
	}
	mount.innerHTML = html
}

/**
 * Refresh OpenAL rows when Screens tab changes screen count (mount lives in System tab).
 * @param {Record<string, unknown>} cs
 * @param {Record<string, unknown>} [audioAr]
 */
export async function refreshSystemTabOpenal(cs, audioAr) {
	const mount = document.getElementById('sys-caspar-openal-rows')
	if (!mount) return
	const hwA = await api.get('/api/audio/devices')
	renderCasparOpenalSection(mount, hwA.devices || [], cs, audioAr || {})
}
