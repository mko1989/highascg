'use strict'

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

function scalePreview() {
	const wrap = preview.parentElement
	if (!wrap) return
	const scale = Math.min(wrap.clientWidth / 1920, wrap.clientHeight / 1080)
	preview.style.transform = `scale(${scale})`
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

	const res = await fetch('/api/templates/' + encodeURIComponent(tpl.id) + '?category=' + encodeURIComponent(tpl.category))
	const detail = await res.json()
	payload = {
		data: { ...detail.defaults.data },
		style: { ...detail.defaults.style },
	}
	renderInspector(detail)

	preview.onload = () => {
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
	const res = await fetch('/api/templates')
	const data = await res.json()
	templates = data.templates || []
	renderGallery()
	if (templates.length) await selectTemplate(templates[0])
}

document.getElementById('btn-play').addEventListener('click', () => invokePreview('play'))
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
		const res = await fetch('/api/export', {
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

window.addEventListener('resize', scalePreview)
loadTemplates().then(scalePreview)
