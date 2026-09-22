/**
 * shader-live-rows.js — pure HTML builders for the Shader Live editor rows/groups
 * (split from shader-live-editor.js for the 500-line limit; markup contract unchanged).
 */

import { escapeHtml } from '../lib/dom-escape.js'
import { DEEP_CATEGORY_ORDER, baseLabelOf } from '../lib/shader-param-naming.js'

export function toHex(v) {
	const c = (x) => Math.max(0, Math.min(255, Math.round((Number(x) || 0) * 255))).toString(16).padStart(2, '0')
	return `#${c(v[0])}${c(v[1])}${c(v[2])}`
}

/* Universal Caspar-mixer rides — available for EVERY shader (no GLSL literals needed). */
export const MIXER_ROWS = [
	{ cmd: 'OPACITY', label: 'opacity', min: 0, max: 1, step: 0.01, def: 1 },
	{ cmd: 'BRIGHTNESS', label: 'brightness', min: 0, max: 3, step: 0.01, def: 1 },
	{ cmd: 'SATURATION', label: 'saturation', min: 0, max: 3, step: 0.01, def: 1 },
	{ cmd: 'CONTRAST', label: 'contrast', min: 0, max: 3, step: 0.01, def: 1 },
]

export function mixerRowsHtml() {
	return MIXER_ROWS.map(
		(r, i) => `<div class="shader-live__param"><span class="shader-live__pname">${r.label}</span>
			<input type="range" data-mixer="${i}" min="${r.min}" max="${r.max}" step="${r.step}" value="${r.def}">
			<input type="number" data-mixer="${i}" data-num min="${r.min}" max="${r.max}" step="${r.step}" value="${r.def}"></div>`,
	).join('')
}

/* todos27: each category renders as a bordered rect (title + compact grid of rows). */
export function groupHtml(title, rowsHtml) {
	if (!rowsHtml) return ''
	return `<div class="shader-live__group"><div class="shader-live__group-title">${escapeHtml(title)}</div><div class="shader-live__group-grid">${rowsHtml}</div></div>`
}

/** @param {object} p @param {number} idx @param {string|undefined} custom operator label */
export function paramRowHtml(p, idx, custom) {
	const cls = p.deep ? 'shader-live__param shader-live__param--deep' : 'shader-live__param'
	/* todos27: WHAT the value does (idiom decode), falling back to the raw calculation;
	 * tooltip always carries the code. */
	const line = p.desc || p.expr
	const exprHtml = p.deep && line ? `<div class="shader-live__expr" title="${escapeHtml(p.expr || '')}">${escapeHtml(line)}</div>` : ''
	/* Tooltip = the decode: pass + auto name + the raw ◆ code context. */
	const tip = `${p.passKey} — ${p.name}${p.context ? `\n${p.context}` : ''}`
	const name = `<button type="button" class="shader-live__pin" data-pin="${idx}" title="Add to the main controls">★</button><button type="button" class="shader-live__reset" data-reset="${idx}" title="Revert to the library value">↺</button><button type="button" class="shader-live__rename" data-rename="${idx}" title="Name this parameter (saved to the shader library)">✎</button><button type="button" class="shader-live__wiggle" data-wiggle="${idx}" title="SHOW me: briefly wiggles this value on the preview output, then restores">≋</button><span class="shader-live__pname${custom ? ' shader-live__pname--custom' : ''}" title="${escapeHtml(tip)}">${escapeHtml(custom || p.name)}</span>`
	if (p.kind === 'color') {
		const alpha = p.vec === 4 ? `<input type="range" data-p="${idx}" data-c="3" min="0" max="1" step="0.01" value="${p.values[3]}">` : ''
		return `<div class="${cls}">${name}<input type="color" data-p="${idx}" data-color value="${toHex(p.values)}">${alpha}${exprHtml}</div>`
	}
	const sliders = p.values
		.map(
			(v, ci) => `<input type="range" data-p="${idx}" data-c="${ci}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}">
			<input type="number" data-p="${idx}" data-c="${ci}" data-num min="${p.min}" max="${p.max}" step="${p.step}" value="${v}">`,
		)
		.join('')
	return `<div class="${cls}">${name}${sliders}${exprHtml}</div>`
}

/**
 * The Advanced fold-away: every detected value, named params first, then the auto-extracted
 * literals grouped by category (Colors, Speed & time, …) with same-base names clustered.
 * @param {Array<object>} params @param {(p: object, idx: number) => string} row
 */
export function advancedHtml(params, row) {
	const named = params.map((p, i) => (p.deep ? '' : row(p, i))).join('')
	const byCat = new Map()
	params.forEach((p, i) => {
		if (!p.deep) return
		const cat = p.category || 'Other values'
		if (!byCat.has(cat)) byCat.set(cat, [])
		byCat.get(cat).push({ p, i })
	})
	for (const items of byCat.values()) {
		items.sort((a, b) => {
			const ba = baseLabelOf(a.p.name)
			const bb = baseLabelOf(b.p.name)
			return ba < bb ? -1 : ba > bb ? 1 : a.i - b.i
		})
	}
	const order = [...DEEP_CATEGORY_ORDER, ...[...byCat.keys()].filter((c) => !DEEP_CATEGORY_ORDER.includes(c))]
	const deep = order
		.filter((c) => byCat.has(c))
		.map((c) => groupHtml(c, byCat.get(c).map(({ p, i }) => row(p, i)).join('')))
		.join('')
	return groupHtml('Shader parameters', named) + deep
}
