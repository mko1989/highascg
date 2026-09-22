/**
 * shader-controls-panel.js — the curated "main panel" of Shader Live: the handful of controls
 * synthesized by lib/shader-controls.js (sections, palette swatches, macro rides, toggles), plus
 * presets / randomize / pin / hide. Slider and colour controls reuse the editor's existing
 * `data-p` / `data-c` / `data-color` contract, so the editor's own change/input/reset/wiggle/
 * rename handlers drive them; only the NEW widgets (macro, toggle, presets…) are handled here.
 *
 * @param {{
 *   getParams: () => Array<object>,
 *   getManifest: () => object|null,
 *   setManifest: (m: object) => void|Promise<void>,
 *   pristine: () => Map<string, number[]>,
 *   applyBatch: (items: Array<{p: object, next: number[]}>) => void,
 *   labelOf: (p: object) => string|undefined,
 *   rerender: () => void,
 * }} deps
 */

import { escapeHtml } from '../lib/dom-escape.js'
import { buildControls, macroFactor, SECTION_ORDER } from '../lib/shader-controls.js'
import { toHex } from './shader-live-rows.js'

const fmt = (v, step) => {
	const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step || 0.01)))
	return Number(v).toFixed(d)
}
const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9)

function hueShift([r, g, b], deg) {
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const d = max - min
	if (d < 1e-6) return [r, g, b]
	let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
	h = (h * 60 + deg + 360) % 360
	const s = d / max
	const f = (n) => {
		const k = (n + h / 60) % 6
		return max - max * s * Math.max(0, Math.min(k, 4 - k, 1))
	}
	return [f(5), f(3), f(1)].map((x) => Math.round(x * 10000) / 10000)
}

export function createShaderControlsPanel(deps) {
	let controls = []

	const manifest = () => ({ pinned: [], hidden: [], presets: [], ...(deps.getManifest() || {}) })
	const byKey = (k) => deps.getParams().find((p) => p.key === k)
	const idxOf = (k) => deps.getParams().findIndex((p) => p.key === k)

	function tools(c, idx) {
		if (c.widget === 'macro') {
			return `<span class="slc__tools"><button type="button" class="shader-live__reset" data-act="reset-macro" data-cid="${escapeHtml(c.id)}" title="Revert to the library values">↺</button></span>`
		}
		return `<span class="slc__tools"><button type="button" class="shader-live__reset" data-reset="${idx}" title="Revert to the library value">↺</button><button type="button" class="shader-live__wiggle" data-wiggle="${idx}" title="SHOW me: briefly wiggles this value on the preview output">≋</button><button type="button" class="shader-live__rename" data-rename="${idx}" title="Rename">✎</button><button type="button" class="slc__hide" data-hide="${escapeHtml(c.keys[0])}" title="Move to Advanced">✕</button></span>`
	}

	function controlHtml(c) {
		const params = deps.getParams()
		const hint = escapeHtml(c.hint || '')
		if (c.widget === 'macro') {
			const k = macroFactor(params, c, deps.pristine())
			return `<div class="slc slc--macro" title="${hint}"><div class="slc__head"><span class="slc__label">${escapeHtml(c.label)}</span><output class="slc__val">×${k.toFixed(2)}</output>${tools(c, -1)}</div>
				<input type="range" data-macro="${escapeHtml(c.id)}" min="0" max="3" step="0.05" value="${k.toFixed(2)}"></div>`
		}
		const idx = idxOf(c.keys[0])
		const p = params[idx]
		if (!p) return ''
		if (c.widget === 'color') {
			const alpha = p.vec === 4 ? `<input type="range" data-p="${idx}" data-c="3" min="0" max="1" step="0.01" value="${p.values[3]}" title="alpha">` : ''
			return `<div class="slc slc--swatch" title="${hint}"><input type="color" data-p="${idx}" data-color value="${toHex(p.values)}"><span class="slc__label">${escapeHtml(c.label)}</span>${alpha}${tools(c, idx)}</div>`
		}
		if (c.widget === 'toggle') {
			return `<div class="slc slc--toggle" title="${hint}"><label class="slc__switch"><input type="checkbox" data-toggle="${idx}"${p.values[0] ? ' checked' : ''}><span></span></label><span class="slc__label">${escapeHtml(c.label)}</span>${tools(c, idx)}</div>`
		}
		const sliders = p.values
			.map((v, ci) => `<div class="slc__row">${p.values.length > 1 ? `<span class="slc__axis">${'xyzw'[ci]}</span>` : ''}<input type="range" data-p="${idx}" data-c="${ci}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}"><output class="slc__val">${fmt(v, p.step)}</output></div>`)
			.join('')
		return `<div class="slc" title="${hint}"><div class="slc__head"><span class="slc__label">${escapeHtml(c.label)}</span>${tools(c, idx)}</div>${sliders}</div>`
	}

	function presetsHtml(m) {
		const chips = m.presets
			.map((pr, i) => `<span class="slp__chip"><button type="button" data-act="preset" data-i="${i}" title="Apply preset">${escapeHtml(pr.name)}</button><button type="button" data-act="preset-del" data-i="${i}" title="Delete preset">×</button></span>`)
			.join('')
		return `<div class="slp"><button type="button" class="slp__chip slp__btn" data-act="preset-original" title="Restore every value to the library shader">Original</button>${chips}<button type="button" class="slp__btn" data-act="preset-save" title="Save the current values as a preset">＋ Preset</button><button type="button" class="slp__btn" data-act="random" title="Randomize the controls below">🎲 Randomize</button></div>`
	}

	/** @returns {string} the panel's HTML (presets bar + sections + summary line) */
	function html() {
		const m = manifest()
		const built = buildControls(deps.getParams(), { manifest: m, labelOf: deps.labelOf })
		controls = built.controls
		const sections = SECTION_ORDER.map((title) => {
			const items = controls.filter((c) => c.section === title)
			if (!items.length) return ''
			const cls = title === 'Colour' ? 'slc-grid slc-grid--palette' : 'slc-grid'
			return `<div class="shader-live__group"><div class="shader-live__group-title">${escapeHtml(title)}</div><div class="${cls}">${items.map(controlHtml).join('')}</div></div>`
		}).join('')
		const summary = controls.length
			? `<div class="slc-summary">${controls.length} key controls${built.hiddenCount ? ` · ${built.hiddenCount} more in Advanced` : ''}${m.hidden.length ? ` · <button type="button" class="slp__link" data-act="unhide">restore ${m.hidden.length} hidden</button>` : ''}</div>`
			: '<p class="settings-note">No obvious controls detected in this shader — open Advanced to see every value, and ★ the ones you want here.</p>'
		return presetsHtml(m) + sections + summary
	}

	const save = (m) => void deps.setManifest(m)

	function applyValues(target) {
		const items = []
		for (const p of deps.getParams()) {
			const next = target(p)
			if (next && next.length === p.values.length && !same(next, p.values)) items.push({ p, next })
		}
		if (items.length) deps.applyBatch(items)
		deps.rerender()
	}

	function randomize() {
		const pristine = deps.pristine()
		const items = []
		for (const c of controls) {
			const rnd = (lo, hi) => lo + Math.random() * (hi - lo)
			if (c.widget === 'macro') {
				const k = rnd(0.6, 1.7)
				for (const key of c.keys) {
					const p = byKey(key)
					const base = pristine.get(key)?.[0]
					if (p && base) items.push({ p, next: [c.inverse?.includes(key) ? base / k : base * k] })
				}
			} else if (c.widget === 'color') {
				const p = byKey(c.keys[0])
				if (p) items.push({ p, next: [...hueShift(p.values.slice(0, 3), rnd(0, 360)), ...p.values.slice(3)] })
			} else if (c.widget === 'slider') {
				const p = byKey(c.keys[0])
				const base = pristine.get(c.keys[0]) || p?.values
				if (p) items.push({ p, next: p.values.map((_, i) => Math.min(p.max, Math.max(p.min, Math.round((base[i] * rnd(0.6, 1.6)) / p.step) * p.step))) })
			}
		}
		if (items.length) deps.applyBatch(items)
		deps.rerender()
	}

	function onClick(e) {
		const t = e.target instanceof Element ? e.target.closest('button') : null
		if (!t) return
		const m = manifest()
		if (t.dataset.hide) {
			m.hidden = [...new Set([...m.hidden, t.dataset.hide])]
			m.pinned = m.pinned.filter((x) => x.key !== t.dataset.hide)
			save(m)
			deps.rerender()
		} else if (t.dataset.pin != null) {
			const p = deps.getParams()[Number(t.dataset.pin)]
			if (!p) return
			m.hidden = m.hidden.filter((k) => k !== p.key)
			if (!m.pinned.some((x) => x.key === p.key)) m.pinned.push({ key: p.key })
			save(m)
			deps.rerender()
		} else if (t.dataset.act === 'unhide') {
			m.hidden = []
			save(m)
			deps.rerender()
		} else if (t.dataset.act === 'preset-original') {
			applyValues((p) => deps.pristine().get(p.key))
		} else if (t.dataset.act === 'preset') {
			const v = m.presets[Number(t.dataset.i)]?.v
			if (v) applyValues((p) => v[p.key] || deps.pristine().get(p.key))
		} else if (t.dataset.act === 'preset-del') {
			m.presets.splice(Number(t.dataset.i), 1)
			save(m)
			deps.rerender()
		} else if (t.dataset.act === 'preset-save') {
			const name = (window.prompt('Preset name') || '').trim()
			if (!name) return
			const v = {}
			for (const p of deps.getParams()) {
				const base = deps.pristine().get(p.key)
				if (base && !same(base, p.values)) v[p.key] = [...p.values]
			}
			m.presets = [...m.presets.filter((x) => x.name !== name), { name, v }].slice(-16)
			save(m)
			deps.rerender()
		} else if (t.dataset.act === 'random') {
			randomize()
		} else if (t.dataset.act === 'reset-macro') {
			const c = controls.find((x) => x.id === t.dataset.cid)
			if (c) applyValues((p) => (c.keys.includes(p.key) ? deps.pristine().get(p.key) : null))
		}
	}

	function onChange(e) {
		const t = e.target
		if (!(t instanceof HTMLInputElement)) return
		if (t.dataset.toggle != null) {
			const p = deps.getParams()[Number(t.dataset.toggle)]
			if (p) deps.applyBatch([{ p, next: [t.checked ? 1 : 0] }])
		} else if (t.dataset.macro != null) {
			const c = controls.find((x) => x.id === t.dataset.macro)
			const k = Math.max(0.05, Number(t.value) || 1) // a divisor macro must never hit 0
			if (!c) return
			const items = []
			for (const key of c.keys) {
				const p = byKey(key)
				const base = deps.pristine().get(key)?.[0]
				if (p && base) items.push({ p, next: [c.inverse?.includes(key) ? base / k : base * k] })
			}
			if (items.length) deps.applyBatch(items)
		}
	}

	/** Live readout while dragging (the apply itself waits for `change`, like every other control). */
	function onInput(e) {
		const t = e.target
		if (!(t instanceof HTMLInputElement) || t.type !== 'range') return
		const out = t.closest('.slc__row, .slc--macro')?.querySelector('.slc__val')
		if (!out) return
		out.textContent = t.dataset.macro != null ? `×${Number(t.value).toFixed(2)}` : fmt(t.value, parseFloat(t.step))
	}

	/** Delegated listeners live on the long-lived host; call once. */
	function attach(host) {
		host.addEventListener('click', onClick)
		host.addEventListener('change', onChange)
		host.addEventListener('input', onInput)
	}

	return { html, attach }
}
