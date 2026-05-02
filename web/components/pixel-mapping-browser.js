/**
 * Mapping Sources Browser — Video Slices and DMX Fixture templates.
 */
import { api } from '../lib/api-client.js'

export function renderMappingBrowser(container, stateStore) {
	const s = stateStore.getState()
	const templates = Array.isArray(s.mappingTemplates) ? s.mappingTemplates : []
	
	container.innerHTML = ''
	const wrap = document.createElement('div')
	wrap.className = 'mapping-browser'
	wrap.style.padding = '12px'
	
	const h = document.createElement('h3')
	h.textContent = 'Mapping Sources'
	h.style.fontSize = '12px'
	h.style.margin = '0 0 12px 0'
	h.style.borderBottom = '1px solid rgba(255,255,255,0.1)'
	h.style.paddingBottom = '8px'
	wrap.appendChild(h)

	const sections = [
		{ id: 'video', label: 'Video Outputs', icon: '📺' },
		{ id: 'dmx', label: 'DMX Fixtures', icon: '💡' }
	]

	sections.forEach(sec => {
		const head = document.createElement('div')
		head.className = 'mapping-browser-head'
		head.style.display = 'flex'
		head.style.justifyContent = 'space-between'
		head.style.alignItems = 'center'
		head.style.marginTop = '16px'
		head.innerHTML = `<span style="font-size:11px; font-weight:bold; opacity:0.7">${sec.icon} ${sec.label}</span><button class="header-btn" data-add-template="${sec.id}" style="padding: 1px 6px;">+</button>`
		wrap.appendChild(head)

		const list = document.createElement('div')
		list.className = 'mapping-browser-list'
		list.style.display = 'flex'
		list.style.flexDirection = 'column'
		list.style.gap = '4px'
		list.style.marginTop = '8px'
		
		const filtered = templates.filter(t => t.type === sec.id)
		if (!filtered.length) {
			list.innerHTML = `<p style="font-size:10px; opacity:0.4; margin:4px 0">No ${sec.label.toLowerCase()} yet.</p>`
		}

		filtered.forEach(t => {
			const item = document.createElement('div')
			item.className = 'mapping-browser-item'
			item.draggable = true
			item.style.cssText = 'background: rgba(255,255,255,0.05); border-radius: 4px; padding: 8px; cursor: grab; border: 1px solid rgba(255,255,255,0.1); position: relative;'
			
			const title = document.createElement('div')
			title.style.fontSize = '11px'
			title.style.fontWeight = 'bold'
			title.textContent = t.label || 'Untitled'
			item.appendChild(title)

			const desc = document.createElement('div')
			desc.style.fontSize = '10px'
			desc.style.opacity = '0.6'
			if (t.type === 'video') {
				desc.textContent = `${t.width}×${t.height} @ ${t.fps}fps`
			} else {
				desc.textContent = `Univ ${t.universe} · ${t.fixtureType || 'RGB'}`
			}
			item.appendChild(desc)

			// Edit button
			const editBtn = document.createElement('button')
			editBtn.className = 'header-btn'
			editBtn.style.cssText = 'position:absolute; top:4px; right:28px; padding: 2px 4px; font-size: 10px;'
			editBtn.textContent = '✎'
			editBtn.onclick = (e) => { e.stopPropagation(); showEditTemplateModal(t, stateStore) }
			item.appendChild(editBtn)

			// Delete button
			const delBtn = document.createElement('button')
			delBtn.className = 'header-btn'
			delBtn.style.cssText = 'position:absolute; top:4px; right:4px; padding: 2px 4px; font-size: 10px;'
			delBtn.textContent = '×'
			delBtn.onclick = (e) => { e.stopPropagation(); if (confirm('Delete template?')) deleteTemplate(t.id, stateStore) }
			item.appendChild(delBtn)

			item.addEventListener('dragstart', (ev) => {
				ev.dataTransfer.setData('application/x-highascg-mapping-template', JSON.stringify(t))
				ev.dataTransfer.effectAllowed = 'copy'
			})

			list.appendChild(item)
		})

		wrap.appendChild(list)
		
		head.querySelector(`[data-add-template="${sec.id}"]`).onclick = () => addTemplate(sec.id, stateStore)
	})

	container.appendChild(wrap)
}

async function addTemplate(type, stateStore) {
	const templates = [...(stateStore.getState().mappingTemplates || [])]
	const id = 'tmp_' + Date.now().toString(36)
	const newItem = type === 'video' 
		? { id, type: 'video', label: 'New Output', width: 1920, height: 1080, fps: 50 }
		: { id, type: 'dmx', label: 'New Fixture', universe: 1, address: 1, fixtureType: 'RGB' }
	
	templates.push(newItem)
	await api.post('/api/device-view', { mappingTemplates: templates })
	stateStore.setState({ mappingTemplates: templates })
}

async function deleteTemplate(id, stateStore) {
	const templates = (stateStore.getState().mappingTemplates || []).filter(t => t.id !== id)
	await api.post('/api/device-view', { mappingTemplates: templates })
	stateStore.setState({ mappingTemplates: templates })
}

function showEditTemplateModal(template, stateStore) {
	const name = prompt('Template Name:', template.label)
	if (name === null) return
	
	const patch = { label: name }
	if (template.type === 'video') {
		const res = prompt('Resolution (WxH):', `${template.width}x${template.height}`)
		if (res) {
			const [w, h] = res.split('x').map(x => parseInt(x))
			if (w && h) { patch.width = w; patch.height = h }
		}
	} else {
		const univ = prompt('Universe:', template.universe)
		if (univ) patch.universe = parseInt(univ)
	}

	const templates = (stateStore.getState().mappingTemplates || []).map(t => t.id === template.id ? { ...t, ...patch } : t)
	api.post('/api/device-view', { mappingTemplates: templates }).then(() => {
		stateStore.setState({ mappingTemplates: templates })
	})
}
