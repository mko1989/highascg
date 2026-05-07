/**
 * Mapping nodes — compact Device View card (WO-42).
 */
import * as MappingNode from '../lib/mapping-node-service.js'
import { appendCableAffordance } from './device-view-cable-affordance.js'

function addPortNodeDot(portEl, connectorId, onPortStartCable, key, data, dotSide = 'right') {
	if (!portEl || !connectorId) return
	appendCableAffordance(portEl, { connectorId, portKey: key, data, onPortStartCable })
	const dot = document.createElement('span')
	dot.className = 'device-view__connector-dot' + (dotSide === 'left' ? ' device-view__connector-dot--left' : '')
	dot.title = 'Cable anchor — arm or complete'
	dot.setAttribute('data-connector-id', connectorId)
	dot.addEventListener('click', (ev) => {
		ev.preventDefault()
		ev.stopPropagation()
		if (onPortStartCable) onPortStartCable(key, connectorId, data)
	})
	portEl.appendChild(dot)
}


export function renderMappingsBand(ctx) {
	const {
		lastPayload,
		selectedKey,
		cableSourceId,
		onPortClick,
		onPortStartCable,
		onAddMappingNode,
		mappingPersist,
	} = ctx
	const band = document.createElement('div')
	band.className = 'device-view__band device-view__band--mappings'
	band.innerHTML =
		'<div class="device-view__destinations-head"><h3 style="margin:0">Pixel Mappings</h3><button type="button" class="header-btn" data-add-mapping title="Add mapping node">+</button></div><div class="device-view__ports" data-mapping-nodes></div>'

	const ports = band.querySelector('[data-mapping-nodes]')
	const addBtn = band.querySelector('[data-add-mapping]')
	if (addBtn) addBtn.addEventListener('click', () => { if (typeof onAddMappingNode === 'function') onAddMappingNode() })

	const nodes = (lastPayload?.graph?.devices || []).filter((d) => d.role === 'pixel_mapping')
	if (!nodes.length) {
		ports.appendChild(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'No mapping nodes. Click + to add.' }))
		return band
	}

	for (const node of nodes) {
		const nodeEl = document.createElement('div')
		nodeEl.className = 'device-view__mapping-node'
		nodeEl.dataset.deviceId = node.id
		nodeEl.onclick = (e) => {
			e.stopPropagation()
			if (typeof ctx.selectDevice === 'function') ctx.selectDevice(node.id, lastPayload?.live)
		}

		const title = Object.assign(document.createElement('div'), { className: 'device-view__mapping-node-label', textContent: node.label || node.id })
		nodeEl.appendChild(title)

		const inConn = (lastPayload?.graph?.connectors || []).find((c) => c.deviceId === node.id && c.kind === 'pixel_map_in')
		if (inConn) {
			const port = document.createElement('div')
			port.className = 'device-view__mapping-node-port device-view__mapping-node-port--in'
			addPortNodeDot(port, inConn.id, onPortStartCable, `mapping_in:${inConn.id}`, { type: 'pixel_map_in', connector: inConn }, 'left')
			nodeEl.appendChild(port)
		}

		const outConns = (lastPayload?.graph?.connectors || [])
			.filter((c) => c.deviceId === node.id && c.kind === 'pixel_map_out')
			.sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0))

		const outStack = document.createElement('div')
		outStack.className = 'device-view__mapping-node-out-stack'
		for (const out of outConns) {
			const port = document.createElement('div')
			port.className = 'device-view__mapping-node-port device-view__mapping-node-port--out'
			const idx = (Number(out.index) || 0) + 1
			port.innerHTML = `<span class="device-view__mapping-node-idx">${idx}</span>`
			addPortNodeDot(port, out.id, onPortStartCable, `mapping_out:${out.id}`, { type: 'pixel_map_out', connector: out }, 'right')
			outStack.appendChild(port)
		}
		nodeEl.appendChild(outStack)

		const addOutBtn = document.createElement('button')
		addOutBtn.type = 'button'
		addOutBtn.className = 'device-view__mapping-node-plus-btn'
		addOutBtn.textContent = '+'
		addOutBtn.onclick = async (e) => {
			e.preventDefault(); e.stopPropagation()
			await mappingPersist?.(async () => MappingNode.addMappingOutput(node.id))
		}
		nodeEl.appendChild(addOutBtn)

		ports.appendChild(nodeEl)
	}

	return band
}
