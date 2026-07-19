'use strict'

// WO-265: same UI runs standalone on :4300 (API at /api) and mounted on the playout
// server under /cg-studio/ (API namespaced at /api/cg-studio).
const API_BASE = location.pathname.startsWith('/cg-studio/') ? '/api/cg-studio' : '/api'

let templates = []
let current = null
let payload = { data: {}, style: {} }

const preview = document.getElementById('preview')
const templateList = document.getElementById('template-list')
const inspectorForm = document.getElementById('inspector-form')
const templateLabel = document.getElementById('template-label')
const exportDialog = document.getElementById('export-dialog')

const FIELD_GROUPS = [
	{ key: 'data', legend: 'Content' },
	{ key: 'colors', legend: 'Colors' },
	{ key: 'typography', legend: 'Typography' },
	{ key: 'layout', legend: 'Layout' },
	{ key: 'template', legend: 'Template options' },
	{ key: 'animation', legend: 'Animation & timing' },
]

/** Current stage fit ({scale, ox, oy}) — shared with the drag overlay (WO-267). */
let previewView = { scale: 1, ox: 0, oy: 0 }

function scalePreview() {
	const wrap = preview.parentElement
	if (!wrap) return
	// WO-267: fit AND center — top-left-anchored scaling misplaces the stage whenever the wrap
	// isn't exactly 16:9 (workspace-tab panes, collapsed side panels).
	previewView = StudioPlacement.fitStage({ width: wrap.clientWidth, height: wrap.clientHeight })
	preview.style.transform = `translate(${previewView.ox}px, ${previewView.oy}px) scale(${previewView.scale})`
	invalidatePlacementCache()
}

function buildUpdateJson() {
	const data = { ...payload.data }
	if (data.f0) data.title = data.f0
	if (data.f1) data.subtitle = data.f1
	if (data.name && !data.title) data.title = data.name
	if (data.role && !data.subtitle) data.subtitle = data.role
	const style = { ...payload.style }
	for (const k of Object.keys(style)) {
		if (style[k] === '' || style[k] == null) delete style[k]
	}
	return JSON.stringify({ data, style })
}

function applyToPreview() {
	const win = preview.contentWindow
	if (!win || typeof win.update !== 'function') return
	try {
		win.update(buildUpdateJson())
	} catch (e) {
		console.warn('preview update failed', e)
	}
	invalidatePlacementCache()
}

function showPreviewInState() {
	const win = preview.contentWindow
	if (!win) return
	applyToPreview()
	if (typeof win.studioHoldIn === 'function') {
		win.studioHoldIn().catch((e) => console.warn('studioHoldIn failed', e))
		return
	}
	if (typeof win.play === 'function') win.play()
}

function invokePreview(fn) {
	const win = preview.contentWindow
	if (!win || typeof win[fn] !== 'function') return
	try {
		win[fn]()
	} catch (e) {
		console.warn('preview ' + fn + ' failed', e)
	}
	invalidatePlacementCache()
}

function setPayloadValue(section, key, value) {
	if (section === 'data') payload.data[key] = value
	else payload.style[key] = value
}

function createFieldControl(field, section) {
	const wrap = document.createElement('div')
	wrap.className = 'inspector-field'

	const label = document.createElement('label')
	label.textContent = field.label

	let input
	const currentVal = section === 'data' ? payload.data[field.key] : payload.style[field.key]

	if (field.type === 'select') {
		input = document.createElement('select')
		for (const opt of field.options || []) {
			const o = document.createElement('option')
			o.value = opt
			o.textContent = opt
			input.appendChild(o)
		}
		input.value = currentVal ?? field.options?.[0] ?? ''
	} else if (field.type === 'color') {
		input = document.createElement('input')
		input.type = 'color'
		const hex = String(currentVal || '#ffffff')
		input.value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ffffff'
	} else if (field.type === 'range') {
		input = document.createElement('input')
		input.type = 'range'
		input.min = String(field.min ?? 0)
		input.max = String(field.max ?? 1)
		input.step = String(field.step ?? 0.05)
		input.value = String(currentVal ?? field.max ?? 1)
		const valSpan = document.createElement('span')
		valSpan.className = 'range-value'
		valSpan.textContent = input.value
		input.dataset.fieldSection = section
		input.dataset.fieldKey = field.key
		input.addEventListener('input', () => {
			valSpan.textContent = input.value
			setPayloadValue(section, field.key, parseFloat(input.value))
			applyToPreview()
		})
		label.appendChild(input)
		label.appendChild(valSpan)
		wrap.appendChild(label)
		if (field.hint) {
			const hint = document.createElement('span')
			hint.className = 'field-hint'
			hint.textContent = field.hint
			wrap.appendChild(hint)
		}
		return wrap
	} else {
		input = document.createElement('input')
		input.type = field.type === 'number' ? 'number' : 'text'
		if (field.type === 'number') {
			if (field.min != null) input.min = String(field.min)
			if (field.max != null) input.max = String(field.max)
			if (field.step != null) input.step = String(field.step)
		}
		if (field.placeholder) input.placeholder = field.placeholder
		input.value = currentVal ?? ''
	}

	input.dataset.fieldSection = section
	input.dataset.fieldKey = field.key
	input.addEventListener('input', () => {
		let val = input.value
		if (field.type === 'number') val = val === '' ? '' : parseFloat(val)
		setPayloadValue(section, field.key, val)
		applyToPreview()
	})

	label.appendChild(input)
	wrap.appendChild(label)
	if (field.hint) {
		const hint = document.createElement('span')
		hint.className = 'field-hint'
		hint.textContent = field.hint
		wrap.appendChild(hint)
	}
	return wrap
}

function renderInspector(detail) {
	inspectorForm.innerHTML = ''
	const fields = detail.fields || {}

	for (const group of FIELD_GROUPS) {
		const list = fields[group.key]
		if (!Array.isArray(list) || list.length === 0) continue
		const fs = document.createElement('fieldset')
		fs.innerHTML = '<legend>' + group.legend + '</legend>'
		for (const field of list) {
			fs.appendChild(createFieldControl(field, group.key === 'data' ? 'data' : 'style'))
		}
		inspectorForm.appendChild(fs)
	}
}

async function selectTemplate(tpl) {
	current = tpl
	templateLabel.textContent = tpl.name + ' (' + tpl.category + ')'
	document.querySelectorAll('#template-list button').forEach((b) => {
		b.classList.toggle('active', b.dataset.id === tpl.id && b.dataset.category === tpl.category)
	})

	const res = await fetch(API_BASE + '/templates/' + encodeURIComponent(tpl.id) + '?category=' + encodeURIComponent(tpl.category))
	const detail = await res.json()
	payload = {
		data: { ...detail.defaults.data },
		style: { ...detail.defaults.style },
	}
	renderInspector(detail)

	preview.onload = () => {
		invalidatePlacementCache()
		setTimeout(showPreviewInState, 50)
	}
	preview.src = tpl.previewUrl
}

function renderGallery() {
	templateList.innerHTML = ''
	for (const tpl of templates) {
		const li = document.createElement('li')
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.dataset.id = tpl.id
		btn.dataset.category = tpl.category
		if (tpl.thumbnail) {
			const img = document.createElement('img')
			img.src = tpl.thumbnail
			img.alt = ''
			btn.appendChild(img)
		}
		const meta = document.createElement('span')
		meta.className = 'meta'
		meta.innerHTML = '<span class="name">' + escapeHtml(tpl.name) + '</span><span class="cat">' + escapeHtml(tpl.category) + '</span>'
		btn.appendChild(meta)
		btn.addEventListener('click', () => selectTemplate(tpl))
		li.appendChild(btn)
		templateList.appendChild(li)
	}
}

function escapeHtml(s) {
	const d = document.createElement('div')
	d.textContent = s
	return d.innerHTML
}

async function loadTemplates() {
	const res = await fetch(API_BASE + '/templates')
	const data = await res.json()
	templates = data.templates || []
	renderGallery()
	if (templates.length) await selectTemplate(templates[0])
}

// WO-267: after the on-load "Preview hold" the engine sits at state 2 where play() no-ops by
// design (CG semantics) — studioReplay re-runs the intro; plain play stays the fallback.
document.getElementById('btn-play').addEventListener('click', () => {
	const win = preview.contentWindow
	if (win && typeof win.studioReplay === 'function') win.studioReplay()
	else invokePreview('play')
	invalidatePlacementCache()
})
document.getElementById('btn-stop').addEventListener('click', () => invokePreview('stop'))
document.getElementById('btn-reset').addEventListener('click', () => showPreviewInState())

document.getElementById('btn-export').addEventListener('click', () => {
	if (!current) return
	document.getElementById('export-id').value = current.id + '-custom'
	document.getElementById('export-name').value = current.name + ' (custom)'
	document.getElementById('export-status').textContent = ''
	document.getElementById('export-status').className = 'status'
	exportDialog.showModal()
})

document.getElementById('export-cancel').addEventListener('click', () => exportDialog.close())

document.getElementById('export-form').addEventListener('submit', async (e) => {
	e.preventDefault()
	const statusEl = document.getElementById('export-status')
	statusEl.textContent = 'Exporting…'
	statusEl.className = 'status'
	try {
		const res = await fetch(API_BASE + '/export', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				baseTemplateId: current.id,
				baseCategory: current.category,
				exportId: document.getElementById('export-id').value.trim(),
				exportName: document.getElementById('export-name').value.trim(),
				data: payload.data,
				style: payload.style,
			}),
		})
		const body = await res.json()
		if (!res.ok) throw new Error(body.error || 'Export failed')
		statusEl.textContent = 'Saved: ' + body.casparPath + ' (Caspar TLS refresh may be required)'
		statusEl.className = 'status ok'
		await loadTemplates()
	} catch (err) {
		statusEl.textContent = String(err.message || err)
		statusEl.className = 'status err'
	}
})

/* ── WO-267: canvas drag-to-position + wheel-to-resize ─────────────────────── */

/** Write a value into the matching inspector input (tagged data-field-*) without re-rendering. */
function setInspectorValue(section, key, value) {
	const input = inspectorForm.querySelector(`[data-field-section="${section}"][data-field-key="${key}"]`)
	if (input) input.value = String(value)
}

/**
 * Placement cache: studioGetPlacement is a cross-frame querySelector + getBoundingClientRect
 * (forced layout inside the template iframe), far too heavy to run on every pointermove.
 * Every mutation path in this file invalidates the cache; the short TTL covers async moves
 * we can't observe (GSAP play/stop/replay animations finishing inside the template).
 */
const PLACEMENT_CACHE_TTL_MS = 200
let placementCache = null // { win, at, placement }

function invalidatePlacementCache() {
	placementCache = null
}

function getPlacementCached() {
	const w = preview.contentWindow
	if (!w || typeof w.studioGetPlacement !== 'function') return null
	if (!placementCache || placementCache.win !== w || Date.now() - placementCache.at > PLACEMENT_CACHE_TTL_MS) {
		placementCache = { win: w, at: Date.now(), placement: w.studioGetPlacement() }
	}
	return placementCache.placement
}

function initCanvasOverlay() {
	const wrap = preview.parentElement
	if (!wrap) return
	const overlay = document.createElement('div')
	overlay.id = 'canvas-overlay'
	wrap.appendChild(overlay)

	const hint = document.createElement('p')
	hint.className = 'hint canvas-hint'
	hint.textContent = 'Drag the graphic to reposition · scroll over it to resize text'
	wrap.parentElement.appendChild(hint)

	let drag = null // { grabX, grabY, width, height }
	let rafPending = false

	const win = () => preview.contentWindow
	const stagePoint = (e) => {
		const r = overlay.getBoundingClientRect()
		return StudioPlacement.stageFromOverlay({ x: e.clientX - r.left, y: e.clientY - r.top }, previewView)
	}
	const insideRect = (pt, rect) =>
		pt.x >= rect.left && pt.x <= rect.left + rect.width && pt.y >= rect.top && pt.y <= rect.top + rect.height

	function commitPlacement(p) {
		payload.style.position = p.position
		payload.style.marginX = p.marginX
		payload.style.marginY = p.marginY
		setInspectorValue('style', 'position', p.position)
		setInspectorValue('style', 'marginX', p.marginX)
		setInspectorValue('style', 'marginY', p.marginY)
	}

	overlay.addEventListener('pointerdown', (e) => {
		const w = win()
		if (!w || typeof w.studioGetPlacement !== 'function') return
		const placement = w.studioGetPlacement()
		if (!placement || !placement.rect || !(placement.rect.width > 0)) return
		const pt = stagePoint(e)
		if (!insideRect(pt, placement.rect)) return
		drag = {
			grabX: pt.x - placement.rect.left,
			grabY: pt.y - placement.rect.top,
			width: placement.rect.width,
			height: placement.rect.height,
		}
		overlay.setPointerCapture(e.pointerId)
		e.preventDefault()
	})

	overlay.addEventListener('pointermove', (e) => {
		const w = win()
		if (!w) return
		if (rafPending) return
		rafPending = true
		requestAnimationFrame(() => {
			rafPending = false
			if (!drag) {
				// hover affordance only — cached placement, no cross-frame layout read per move
				const placement = getPlacementCached()
				overlay.style.cursor = placement && placement.rect && insideRect(stagePoint(e), placement.rect) ? 'move' : 'default'
				return
			}
			const pt = stagePoint(e)
			const p = StudioPlacement.placementFromDrag({
				left: pt.x - drag.grabX,
				top: pt.y - drag.grabY,
				width: drag.width,
				height: drag.height,
			})
			if (typeof w.studioSetPlacement === 'function') {
				w.studioSetPlacement(p)
				invalidatePlacementCache()
			}
		})
	})

	const endDrag = (e) => {
		if (!drag) return
		drag = null
		const w = win()
		if (w && typeof w.studioGetPlacement === 'function') {
			const placement = w.studioGetPlacement()
			if (placement) commitPlacement({ position: placement.position, marginX: placement.marginX, marginY: placement.marginY })
		}
		try { overlay.releasePointerCapture(e.pointerId) } catch { /* already released */ }
	}
	overlay.addEventListener('pointerup', endDrag)
	overlay.addEventListener('pointercancel', endDrag)

	overlay.addEventListener(
		'wheel',
		(e) => {
			const w = win()
			if (!w || typeof w.studioGetFontSizes !== 'function' || typeof w.studioGetPlacement !== 'function') return
			const placement = w.studioGetPlacement()
			if (!placement || !placement.rect || !insideRect(stagePoint(e), placement.rect)) return
			e.preventDefault()
			const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05
			const sizes = w.studioGetFontSizes()
			if (sizes.titleFontSize) {
				const v = Math.round(Math.min(120, Math.max(12, sizes.titleFontSize * factor)))
				payload.style.titleFontSize = v
				setInspectorValue('style', 'titleFontSize', v)
			}
			if (sizes.subtitleFontSize) {
				const v = Math.round(Math.min(80, Math.max(10, sizes.subtitleFontSize * factor)))
				payload.style.subtitleFontSize = v
				setInspectorValue('style', 'subtitleFontSize', v)
			}
			applyToPreview()
		},
		{ passive: false },
	)

	// Workspace-pane resizes don't always fire this iframe's window resize — observe the wrap.
	if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scalePreview).observe(wrap)
}

window.addEventListener('resize', scalePreview)
initCanvasOverlay()
loadTemplates().then(scalePreview)
