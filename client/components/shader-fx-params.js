/**
 * WO-340 — shader modal: auto-detected tweakable parameters panel.
 *
 * Scans the modal's GLSL textareas (common + every pass) with shader-param-scan.js and renders
 * a control row per detected param — color picker for 0–1 vec3/vec4 (and `@color`), slider +
 * number input per component otherwise. Values are applied by REWRITING the source literal in
 * the textarea (span-based splice) and auto-saving through the modal's own save path, so the
 * GLSL text stays the single source of truth and the exported template needs no runtime support.
 * Controls apply on `change` (slider release / picker close), never per input tick.
 */

import { scanAllPassSources, rewriteParamValues } from '../lib/shader-param-scan.js'
import { escapeHtml } from './sources-panel-helpers.js'

const RESCAN_DEBOUNCE_MS = 300

function toHex(values) {
	const c = (v) => Math.max(0, Math.min(255, Math.round((Number(v) || 0) * 255)))
		.toString(16)
		.padStart(2, '0')
	return `#${c(values[0])}${c(values[1])}${c(values[2])}`
}

function fromHex(hex) {
	const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
	if (!m) return null
	const n = parseInt(m[1], 16)
	const r4 = (v) => Math.round((v / 255) * 10000) / 10000
	return [r4((n >> 16) & 255), r4((n >> 8) & 255), r4(n & 255)]
}

function paramSignature(params) {
	return params.map((p) => `${p.passKey}:${p.name}:${p.kind}:${p.vec}`).join('|')
}

function controlRow(p, idx) {
	const label = `<span class="shaderfx-param__name" title="${escapeHtml(p.passKey)}">${escapeHtml(p.name)}</span>`
	if (p.kind === 'color') {
		const alpha =
			p.vec === 4
				? `<input type="range" data-param="${idx}" data-comp="3" min="0" max="1" step="0.01" value="${p.values[3]}" title="alpha">`
				: ''
		return `<div class="shaderfx-param">${label}<input type="color" data-param="${idx}" data-color value="${toHex(p.values)}">${alpha}</div>`
	}
	const sliders = p.values
		.map(
			(v, ci) => `
			<input type="range" data-param="${idx}" data-comp="${ci}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}">
			<input type="number" data-param="${idx}" data-comp="${ci}" data-num min="${p.min}" max="${p.max}" step="${p.step}" value="${v}">`,
		)
		.join('')
	return `<div class="shaderfx-param">${label}${sliders}</div>`
}

/**
 * @param {HTMLElement} modal — the shaderfx modal root
 * @param {{ getSource: (passKey: string) => string, setSource: (passKey: string, src: string) => void,
 *           applyChange: () => void | Promise<void> }} deps
 *   getSource/setSource address the common/pass textareas; applyChange = the modal's save path
 *   (persists + refreshes the preview iframe).
 * @returns {{ rescan: () => void, scheduleRescan: () => void }}
 */
export function mountShaderParamsPanel(modal, deps) {
	const host = document.createElement('div')
	host.id = 'shaderfx-params'
	host.className = 'shaderfx-params'
	host.style.display = 'none'
	const anchor = modal.querySelector('.shaderfx-preview-wrap')
	anchor?.parentNode?.insertBefore(host, anchor)

	/** @type {Array<object>} */
	let params = []
	let signature = ''
	let rescanTimer = null

	function collectSources() {
		const passes = {}
		for (const key of ['image', 'bufferA', 'bufferB', 'bufferC', 'bufferD']) {
			const src = deps.getSource(key)
			if (src && src.trim()) passes[key] = { source: src }
		}
		return { passes, common: deps.getSource('common') || '' }
	}

	function rescan() {
		const { passes, common } = collectSources()
		let next = []
		try {
			next = scanAllPassSources(passes, common)
		} catch (e) {
			console.warn('Shader param scan failed:', e?.message || e)
			next = []
		}
		const nextSig = paramSignature(next)
		params = next
		if (nextSig !== signature) {
			signature = nextSig
			host.innerHTML = params.length
				? `<div class="shaderfx-param__title">Detected parameters</div>${params.map(controlRow).join('')}`
				: ''
			host.style.display = params.length ? '' : 'none'
		} else {
			// Same set — refresh control values in place (e.g. after an external source edit).
			for (const input of host.querySelectorAll('[data-param]')) {
				const p = params[Number(input.dataset.param)]
				if (!p) continue
				if (input.dataset.color != null) input.value = toHex(p.values)
				else input.value = String(p.values[Number(input.dataset.comp) || 0])
			}
		}
	}

	function scheduleRescan() {
		if (rescanTimer) clearTimeout(rescanTimer)
		rescanTimer = setTimeout(() => {
			rescanTimer = null
			rescan()
		}, RESCAN_DEBOUNCE_MS)
	}

	function applyValues(p, newValues) {
		const src = deps.getSource(p.passKey)
		let rewritten
		try {
			rewritten = rewriteParamValues(src, p, newValues)
		} catch (e) {
			// Source drifted since the scan — refresh the panel instead of corrupting the shader.
			console.warn('Shader param rewrite skipped:', e?.message || e)
			rescan()
			return
		}
		deps.setSource(p.passKey, rewritten)
		rescan()
		void deps.applyChange()
	}

	host.addEventListener('change', (e) => {
		const t = e.target
		if (!(t instanceof HTMLInputElement) || t.dataset.param == null) return
		const p = params[Number(t.dataset.param)]
		if (!p) return
		if (t.dataset.color != null) {
			const rgb = fromHex(t.value)
			if (!rgb) return
			const next = p.vec === 4 ? [...rgb, p.values[3]] : rgb
			applyValues(p, next)
			return
		}
		const comp = Number(t.dataset.comp) || 0
		const v = Number(t.value)
		if (!Number.isFinite(v)) return
		const next = [...p.values]
		next[comp] = v
		applyValues(p, next)
	})

	// Keep the paired slider/number visually in sync while dragging (apply still waits for change).
	host.addEventListener('input', (e) => {
		const t = e.target
		if (!(t instanceof HTMLInputElement) || t.dataset.param == null || t.dataset.color != null) return
		const twin = host.querySelectorAll(`[data-param="${t.dataset.param}"][data-comp="${t.dataset.comp}"]`)
		for (const other of twin) if (other !== t) other.value = t.value
	})

	return { rescan, scheduleRescan }
}
