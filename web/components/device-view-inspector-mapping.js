/**
 * Device View inspector for pixel mapping nodes (WO-41 overhaul).
 */
import * as MappingNode from '../lib/mapping-node-service.js'
import { STANDARD_VIDEO_MODES } from './device-view-destinations-inspector.js'

function findMappingNode(graph, deviceId) {
	return (graph?.devices || []).find((d) => d.id === deviceId && d.role === 'pixel_mapping') || null
}

export function renderMappingNodeInspector(host, deviceId, live, { lastPayload, statusEl, load, setCasparRestartDirty }) {
	const graph = lastPayload?.graph
	const node = findMappingNode(graph, deviceId)
	if (!node) {
		host.append(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'Mapping node not found.' }))
		return
	}

	const section = (title) => {
		const h = document.createElement('p')
		h.className = 'device-view__status'
		h.textContent = title
		host.appendChild(h)
	}

	section('Pixel Mapping Node')

	const row = (label, input) => {
		const wrap = document.createElement('div')
		wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:12px'
		const l = Object.assign(document.createElement('label'), { textContent: label, style: 'font-size:11px;opacity:.85' })
		wrap.append(l, input)
		host.appendChild(wrap)
	}

	// Name/Label
	const nameInp = document.createElement('input')
	nameInp.type = 'text'
	nameInp.value = node.label || node.id
	nameInp.className = 'device-view__inspector-input'
	nameInp.addEventListener('change', async () => {
		const r = await MappingNode.renameMappingNode(node.id, nameInp.value)
		if (r.ok) {
			if (r.graph && typeof load === 'function') {
				// Fast path: update local state directly
				window.dispatchEvent(new CustomEvent('highascg-device-view-update-payload', { detail: { graph: r.graph } }))
			}
			load() 
		}
		else if (statusEl) statusEl.textContent = r.error
	})
	row('Node Label', nameInp)

	// Input Resolution
	const inConn = (graph?.connectors || []).find(c => c.deviceId === node.id && c.kind === 'pixel_map_in')
	let resText = 'Unknown'
	if (inConn) {
		const edge = (graph?.edges || []).find(e => e.sinkId === inConn.id)
		if (edge) {
			const srcId = String(edge.sourceId)
			const source = (graph?.sources || []).find(s => s.id === srcId)
			if (source) {
				resText = `${source.width || 1920}×${source.height || 1080}`
			} else {
				const srcConn = (graph?.connectors || []).find(c => c.id === edge.sourceId)
				if (srcConn && srcConn.deviceId === 'caspar' && srcConn.kind === 'gpu_out') {
					const dests = Array.isArray(lastPayload?.tandemTopology?.destinations) ? lastPayload.tandemTopology.destinations : []
					const d = dests.find(x => String(x.id) === String(srcConn.externalRef))
					if (d) resText = `${d.width || 1920}×${d.height || 1080}`
				}
			}
		}
	}
	const resDisp = Object.assign(document.createElement('div'), { className: 'device-view__inspector-input', textContent: resText })
	resDisp.style.opacity = '0.7'
	resDisp.style.pointerEvents = 'none'
	row('Input Resolution', resDisp)

	// Outputs
	section('Outputs')
	const outputs = Array.isArray(node.settings?.outputs) ? node.settings.outputs : []
	const mappings = Array.isArray(node.settings?.mappings) ? node.settings.mappings : []
	const outList = document.createElement('div')
	outList.style.cssText = 'display:flex;flex-direction:column;gap:16px'

	outputs.forEach((out, idx) => {
		const outWrap = document.createElement('div')
		outWrap.style.cssText = 'padding:10px;border:1px solid #30363d;border-radius:8px;background:rgba(255,255,255,0.02)'
		
		const head = document.createElement('div')
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'
		head.appendChild(Object.assign(document.createElement('span'), { textContent: `Output ${idx + 1}`, style: 'font-weight:bold;font-size:12px;color:var(--accent-color,#58a6ff)' }))
		
		const delBtn = document.createElement('button')
		delBtn.className = 'header-btn'
		delBtn.textContent = 'Remove'
		delBtn.style.fontSize = '10px'
		delBtn.onclick = async () => {
			if (!confirm('Remove this output and its cables?')) return
			const r = await MappingNode.removeMappingOutput(node.id, out.id)
			if (r.ok) {
				setCasparRestartDirty(true)
				if (r.graph) window.dispatchEvent(new CustomEvent('highascg-device-view-update-payload', { detail: { graph: r.graph } }))
				load()
			} else {
				alert(`Failed to remove output: ${r.error || 'Unknown error'}`)
			}
		}
		if (outputs.length > 1) head.appendChild(delBtn)
		outWrap.appendChild(head)

		const inpRow = (lbl, el) => {
			const w = document.createElement('div')
			w.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px'
			w.appendChild(Object.assign(document.createElement('label'), { textContent: lbl, style: 'font-size:11px;width:70px;opacity:.7' }))
			el.style.flex = '1'
			w.appendChild(el)
			outWrap.appendChild(w)
		}

		// Label
		const oLabel = document.createElement('input')
		oLabel.type = 'text'; oLabel.value = out.label || `Output ${idx + 1}`; oLabel.className = 'device-view__inspector-input'
		oLabel.onchange = async () => {
			const r = await MappingNode.updateMappingOutputFields(node.id, out.id, { label: oLabel.value })
			if (r.ok) { setCasparRestartDirty(true); load() }
		}
		inpRow('Label', oLabel)

		// Video Mode
		const isCustomMode = !STANDARD_VIDEO_MODES.includes(out.mode)
		const vMode = document.createElement('select'); vMode.className = 'device-view__inspector-input'
		vMode.appendChild(Object.assign(document.createElement('option'), { value: 'custom', textContent: 'Custom', selected: isCustomMode }))
		for (const m of STANDARD_VIDEO_MODES) {
			vMode.appendChild(Object.assign(document.createElement('option'), { value: m, textContent: m, selected: out.mode === m }))
		}
		
		const customBox = document.createElement('div')
		customBox.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:8px'
		const cW = Object.assign(document.createElement('input'), { type: 'number', placeholder: 'W', className: 'device-view__inspector-input', value: out.width || 1920 })
		const cH = Object.assign(document.createElement('input'), { type: 'number', placeholder: 'H', className: 'device-view__inspector-input', value: out.height || 1080 })
		const cF = Object.assign(document.createElement('input'), { type: 'number', placeholder: 'FPS', className: 'device-view__inspector-input', value: out.fps || 50 })
		customBox.append(cW, cH, cF)
		customBox.style.display = isCustomMode ? 'grid' : 'none'

		const saveCustom = async () => {
			const r = await MappingNode.updateMappingOutputFields(node.id, out.id, { 
				mode: vMode.value === 'custom' ? `${cW.value}x${cH.value}p${cF.value}` : vMode.value,
				width: parseInt(cW.value, 10), height: parseInt(cH.value, 10), fps: parseFloat(cF.value)
			})
			if (r.ok) { setCasparRestartDirty(true); load() }
		}
		vMode.onchange = () => { customBox.style.display = vMode.value === 'custom' ? 'grid' : 'none'; saveCustom() }
		cW.onchange = cH.onchange = cF.onchange = saveCustom

		inpRow('Mode', vMode)
		outWrap.appendChild(customBox)

		// Position on canvas (Mapping) — full rect: x, y, w, h
		const slice = mappings.find(m => String(m.outputId) === String(out.id)) || null
		const outRes = MappingNode.videoModeToResolution(out.mode || '1080p5000')
		const posBox = document.createElement('div')
		posBox.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px'
		
		const createPosField = (label, value, onchange) => {
			const f = document.createElement('div')
			f.style.cssText = 'display:flex;flex-direction:column;gap:4px'
			f.appendChild(Object.assign(document.createElement('span'), { textContent: label, style: 'font-size:10px;opacity:0.6' }))
			const inp = document.createElement('input')
			inp.type = 'number'
			inp.className = 'device-view__inspector-input'
			inp.value = value
			inp.onchange = (e) => onchange(e.target.value)
			f.appendChild(inp)
			return { f, inp }
		}

		const { f: fX, inp: pX } = createPosField('Src X', slice?.rect?.x ?? 0, (v) => saveRect(v, pY.value, pW.value, pH.value))
		const { f: fY, inp: pY } = createPosField('Src Y', slice?.rect?.y ?? 0, (v) => saveRect(pX.value, v, pW.value, pH.value))
		const { f: fW, inp: pW } = createPosField('Width', slice?.rect?.w ?? outRes.w, (v) => saveRect(pX.value, pY.value, v, pH.value))
		const { f: fH, inp: pH } = createPosField('Height', slice?.rect?.h ?? outRes.h, (v) => saveRect(pX.value, pY.value, pW.value, v))

		async function saveRect(x, y, w, h) {
			const graph = (await MappingNode.fetchDeviceView()).graph
			const n = MappingNode.findMappingNode(graph, node.id)
			if (!n) return
			const ms = Array.isArray(n.settings?.mappings) ? n.settings.mappings : []
			let s = ms.find(m => String(m.outputId) === String(out.id))
			if (!s) {
				const res = MappingNode.videoModeToResolution(out.mode)
				s = { id: 'map_' + Date.now().toString(36), type: 'video_slice', label: out.label, rect: { x: 0, y: 0, w: res.w, h: res.h }, rotation: 0, outputId: out.id }
				ms.push(s)
			}
			s.rect.x = parseInt(x, 10) || 0
			s.rect.y = parseInt(y, 10) || 0
			s.rect.w = Math.max(1, parseInt(w, 10) || 1)
			s.rect.h = Math.max(1, parseInt(h, 10) || 1)
			n.settings.mappings = ms
			await MappingNode.saveDeviceGraph(graph)
			setCasparRestartDirty(true)
			// Notify mapping preview canvas if open
			window.dispatchEvent(new CustomEvent('highascg-mapping-inspector-updated', { detail: { nodeId: node.id } }))
			load()
		}

		posBox.append(fX, fY, fW, fH)
		outWrap.appendChild(posBox)

		outList.appendChild(outWrap)
	})
	host.appendChild(outList)

	const addBtn = document.createElement('button')
	addBtn.className = 'header-btn'
	addBtn.style.cssText = 'width:100%;margin-top:12px;padding:8px'
	addBtn.textContent = '+ Add Output'
	addBtn.onclick = async () => {
		const r = await MappingNode.addMappingOutput(node.id)
		if (r.ok) {
			setCasparRestartDirty(true)
			if (r.graph) window.dispatchEvent(new CustomEvent('highascg-device-view-update-payload', { detail: { graph: r.graph } }))
			load()
		}
	}
	host.appendChild(addBtn)

	// Actions
	section('Actions')
	const actions = document.createElement('div')
	actions.className = 'device-view__inspector-links'
	
	const editorBtn = document.createElement('button')
	editorBtn.className = 'mv-btn'
	editorBtn.style.cssText = 'width:100%;margin-bottom:8px;padding:8px;display:flex;align-items:center;justify-content:center;gap:6px'
	editorBtn.textContent = 'Show Mapping Preview'
	editorBtn.onclick = () => {
		window.dispatchEvent(new CustomEvent('highascg-open-pixel-mapping', { detail: { nodeId: node.id } }))
	}
	
	const dupeBtn = document.createElement('button')
	dupeBtn.className = 'header-btn'
	dupeBtn.textContent = 'Duplicate Node'
	dupeBtn.onclick = async () => {
		const r = await MappingNode.duplicateMappingNode(node.id)
		if (r.ok) load()
	}

	const delNodeBtn = document.createElement('button')
	delNodeBtn.className = 'header-btn'
	delNodeBtn.style.color = '#f85149'
	delNodeBtn.textContent = 'Delete Node'
	delNodeBtn.onclick = async () => {
		if (!confirm(`Delete mapping node "${node.label || node.id}" and all its cables?`)) return
		const r = await MappingNode.deleteMappingNode(node.id)
		if (r.ok) { setCasparRestartDirty(true); load() }
	}

	actions.append(editorBtn, dupeBtn, delNodeBtn)
	host.appendChild(actions)
}

export function renderMappingConnectorControls(host, conn, { lastPayload, statusEl, load, setCasparRestartDirty, nodeId }) {
	const graph = lastPayload?.graph
	const node = findMappingNode(graph, nodeId)
	if (!node) {
		host.append(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'Mapping node not found.' }))
		return
	}

	const hint = Object.assign(document.createElement('p'), {
		className: 'device-view__note',
		textContent: conn.kind === 'pixel_map_in'
			? 'Cable a destination output here to feed this mapping processor.'
			: 'Cable this output to GPU or DeckLink to attach the mapping channel consumer.',
	})
	host.appendChild(hint)

	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = 'header-btn'
	btn.style.width = '100%'
	btn.textContent = 'Select Mapping Node'
	btn.onclick = () => {
		window.dispatchEvent(new CustomEvent('highascg-device-view-select-device', { detail: { deviceId: node.id } }))
	}
	host.appendChild(btn)
}
