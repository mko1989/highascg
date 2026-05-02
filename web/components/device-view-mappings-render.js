/**
 * Mapping Nodes Rendering for Device View.
 */
import { stateClass, connectorById } from './device-view-helpers.js'
import * as Actions from './device-view-actions.js'

function addPortNodeDot(portEl, connectorId, onPortStartCable, key, data, dotSide = 'right') {
	if (!portEl || !connectorId) return
	const dot = document.createElement('span')
	dot.className = 'device-view__connector-dot' + (dotSide === 'left' ? ' device-view__connector-dot--left' : '')
	dot.title = 'Start or complete cable at this connector'
	dot.setAttribute('data-connector-id', connectorId)
	dot.addEventListener('click', (ev) => {
		ev.preventDefault()
		ev.stopPropagation()
		if (onPortStartCable) onPortStartCable(key, connectorId, data)
	})
	portEl.appendChild(dot)
}

export function renderMappingsBand(ctx) {
	const { lastPayload, isConnectorVisible, selectedKey, cableSourceId, onPortClick, onPortStartCable, onAddMappingNode } = ctx
	const band = document.createElement('div')
	band.className = 'device-view__band device-view__band--mappings'
	band.innerHTML = '<div class="device-view__destinations-head"><h3 style="margin:0">Pixel & Output Mappings</h3><button type="button" class="header-btn" data-add-mapping>+</button></div><div class="device-view__ports" data-mapping-nodes></div>'
	
	const ports = band.querySelector('[data-mapping-nodes]')
	const addBtn = band.querySelector('[data-add-mapping]')
	if (addBtn) addBtn.addEventListener('click', () => { if (typeof onAddMappingNode === 'function') onAddMappingNode() })

	const nodes = (lastPayload?.graph?.devices || []).filter((d) => d.role === 'pixel_mapping')
	if (!nodes.length) {
		ports.appendChild(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'No mapping nodes. Click + to add a pixel mapping processor.' }))
		return band
	}

	for (const node of nodes) {
		const nodeEl = document.createElement('div')
		nodeEl.className = 'device-view__mapping-node'
		nodeEl.dataset.deviceId = node.id
		
		const title = document.createElement('div')
		title.className = 'device-view__mapping-node-title'
		title.textContent = node.label || node.id
		nodeEl.appendChild(title)

		// Input port
		const inPort = document.createElement('div')
		inPort.className = 'device-view__port device-view__port--mapping-in'
		const inConn = (lastPayload?.graph?.connectors || []).find(c => c.deviceId === node.id && c.kind === 'pixel_map_in')
		if (inConn) {
			inPort.dataset.portKey = `mapping_in:${inConn.id}`
			inPort.setAttribute('data-connector-id', inConn.id)
			inPort.appendChild(Object.assign(document.createElement('span'), { textContent: 'Input Feed' }))
			addPortNodeDot(inPort, inConn.id, onPortStartCable, inPort.dataset.portKey, { type: 'pixel_map_in', connector: inConn }, 'left')
			inPort.addEventListener('click', () => onPortClick(inPort.dataset.portKey, inConn.id, { type: 'pixel_map_in', connector: inConn }))
			if (selectedKey === inPort.dataset.portKey) inPort.classList.add('device-view__port--selected')
			if (cableSourceId && inConn.id === cableSourceId) inPort.classList.add('device-view__port--cable-armed')
		}
		nodeEl.appendChild(inPort)

		// Output ports
		const outPorts = document.createElement('div')
		outPorts.className = 'device-view__mapping-node-outputs'
		const outConns = (lastPayload?.graph?.connectors || []).filter(c => c.deviceId === node.id && c.kind === 'pixel_map_out')
		for (const out of outConns) {
			const op = document.createElement('div')
			op.className = 'device-view__port device-view__port--mapping-out'
			const key = `mapping_out:${out.id}`
			op.dataset.portKey = key
			op.setAttribute('data-connector-id', out.id)
			op.appendChild(Object.assign(document.createElement('span'), { textContent: out.label || `Out ${out.index + 1}` }))
			addPortNodeDot(op, out.id, onPortStartCable, key, { type: 'pixel_map_out', connector: out }, 'right')
			op.addEventListener('click', () => onPortClick(key, out.id, { type: 'pixel_map_out', connector: out }))
			if (selectedKey === key) op.classList.add('device-view__port--selected')
			if (cableSourceId && out.id === cableSourceId) op.classList.add('device-view__port--cable-armed')
			outPorts.appendChild(op)
		}
		nodeEl.appendChild(outPorts)

		// Settings button / Enter Mapping button
		const enterBtn = document.createElement('button')
		enterBtn.className = 'header-btn device-view__mapping-enter'
		enterBtn.textContent = 'Open Pixel Mapping Editor'
		enterBtn.onclick = () => {
			// Trigger a custom event or call a global function to switch to Pixel Mapping tab
			window.dispatchEvent(new CustomEvent('highascg-open-pixel-mapping', { detail: { nodeId: node.id } }))
		}
		nodeEl.appendChild(enterBtn)

		ports.appendChild(nodeEl)
	}

	return band
}
