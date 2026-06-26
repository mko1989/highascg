/**
 * Mapping State — manage mapping data (slices and fixtures) for a specific node.
 */
import { api } from './api-client.js'
import * as MappingNodeService from './mapping-node-service.js'

export class MappingState {
	constructor() {
		this.activeNodeId = null
		this.activeNode = null
		this.mappings = [] // { id, type: 'video_slice'|'dmx_fixture', ... }
		this.canvasWidth = 1920
		this.canvasHeight = 1080
		this._listeners = new Map()
		this._saveDebounceMs = 450
		this._saveTimer = null
	}

	on(key, fn) {
		if (!this._listeners.has(key)) this._listeners.set(key, [])
		this._listeners.get(key).push(fn)
		return () => {
			const fns = this._listeners.get(key)
			if (fns) {
				const i = fns.indexOf(fn)
				if (i >= 0) fns.splice(i, 1)
			}
		}
	}

	_emit(key) {
		const fns = this._listeners.get(key)
		if (fns) fns.forEach((fn) => fn())
	}

	async setActiveNode(nodeId, payload) {
		const { graph, screenDestinations } = payload
		this.activeNodeId = nodeId
		this.activeNode = (graph?.devices || []).find(d => d.id === nodeId) || null
		
		if (this.activeNode) {
			const outputs = Array.isArray(this.activeNode.settings?.outputs) ? this.activeNode.settings.outputs : []
			const firstOutputId = outputs[0]?.id || 'out_1'
			const existingMappings = (Array.isArray(this.activeNode.settings?.mappings) ? this.activeNode.settings.mappings : []).map((m) => {
				const mid = String(m?.outputId || firstOutputId)
				const out = outputs.find(o => String(o.id) === mid)
				const res = MappingNodeService.videoModeToResolution(out?.mode || '1080p5000')
				return {
					...m,
					outputId: mid,
					rect: {
						x: 0, y: 0, w: res.w, h: res.h,
						...(m.rect || {})
					}
				}
			})
			// Ensure every configured output is visible on canvas (one slice minimum per output).
			const byOutput = new Map(existingMappings.map((m) => [String(m?.outputId || ''), true]))
			let autoX = 0
			this.mappings = [...existingMappings]
			for (const out of outputs) {
				const oid = String(out?.id || '').trim()
				if (!oid || byOutput.has(oid)) continue
				const res = MappingNodeService.videoModeToResolution(out?.mode || '1080p5000')
				this.mappings.push({
					id: 'auto_' + oid,
					type: 'video_slice',
					label: out?.label || oid,
					outputId: oid,
					rotation: 0,
					rect: { x: autoX, y: 0, w: res.w, h: res.h },
				})
				autoX += res.w
			}
			
			// Discover input resolution
			const inConn = (graph?.connectors || []).find(c => c.deviceId === nodeId && c.kind === 'pixel_map_in')
			if (inConn) {
				const edge = (graph?.edges || []).find(e => e.sinkId === inConn.id)
				if (edge) {
					const srcId = String(edge.sourceId)
					const source = (graph?.sources || []).find(s => s.id === srcId)
					if (source) {
						this.canvasWidth = Math.max(64, parseInt(source.width, 10) || 1920)
						this.canvasHeight = Math.max(64, parseInt(source.height, 10) || 1080)
					} else {
						const srcConn = (graph?.connectors || []).find(c => c.id === srcId)
						if (srcConn && srcConn.deviceId === 'caspar' && srcConn.kind === 'gpu_out') {
							const dests = Array.isArray(screenDestinations?.destinations) ? screenDestinations.destinations : []
							const d = dests.find(x => String(x.id) === String(srcConn.externalRef))
							if (d) {
								this.canvasWidth = Math.max(64, parseInt(d.width, 10) || 1920)
								this.canvasHeight = Math.max(64, parseInt(d.height, 10) || 1080)
							}
						}
					}
				}
			}
		} else {
			this.mappings = []
		}
		this._emit('change')
	}

	_getNodeOutputCount() {
		const outputs = Array.isArray(this.activeNode?.settings?.outputs) ? this.activeNode.settings.outputs : []
		return outputs.length
	}

	addMappingFromTemplate(template, pos = { x: 100, y: 100 }) {
		if (!this.activeNode) return
		const outputs = Array.isArray(this.activeNode.settings?.outputs) ? this.activeNode.settings.outputs : []
		const firstOutputId = outputs[0]?.id || 'out_1'
		const id = 'map_' + Date.now().toString(36)
		const mapping = {
			id,
			type: template.type === 'video' ? 'video_slice' : 'dmx_fixture',
			label: template.label,
			rect: {
				x: pos.x,
				y: pos.y,
				w: template.width || 200,
				h: template.height || 200
			},
			rotation: 0,
			templateId: template.id,
			outputId: firstOutputId,
			// Additional fields from template
			...(template.type === 'dmx' ? { universe: template.universe, fixtureType: template.fixtureType } : {})
		}
		this.mappings.push(mapping)
		this._save()
		return mapping
	}

	updateMapping(id, updates) {
		const m = this.mappings.find(x => x.id === id)
		if (!m) return
		if (updates.rect) Object.assign(m.rect, updates.rect)
		if (updates.rotation !== undefined) m.rotation = updates.rotation
		if (updates.label !== undefined) m.label = updates.label
		if (updates.outputId !== undefined) m.outputId = String(updates.outputId || '')
		if (updates.templateId !== undefined) m.templateId = String(updates.templateId || '')
		this._save()
	}

	removeMapping(id) {
		const idx = this.mappings.findIndex(x => x.id === id)
		if (idx >= 0) {
			this.mappings.splice(idx, 1)
			this._save()
		}
	}

	async renameNode(nextLabel) {
		if (!this.activeNodeId) return { ok: false }
		const r = await MappingNodeService.renameMappingNode(this.activeNodeId, nextLabel)
		if (r.ok && r.graph) {
			const node = MappingNodeService.findMappingNode(r.graph, this.activeNodeId)
			if (node) this.activeNode = node
			this._emit('change')
		}
		return r
	}

	async duplicateNode() {
		if (!this.activeNodeId) return null
		const r = await MappingNodeService.duplicateMappingNode(this.activeNodeId)
		if (!r.ok || !r.newId) return null
		this.activeNodeId = r.newId
		this.activeNode = MappingNodeService.findMappingNode(r.graph, r.newId)
		this.mappings = Array.isArray(this.activeNode?.settings?.mappings) ? this.activeNode.settings.mappings : []
		this._emit('change')
		return r.newId
	}

	async deleteNode() {
		if (!this.activeNodeId) return false
		const r = await MappingNodeService.deleteMappingNode(this.activeNodeId)
		if (!r.ok) return false
		this.activeNodeId = null
		this.activeNode = null
		this.mappings = []
		this._emit('change')
		return true
	}

	async addOutput() {
		if (!this.activeNodeId) return false
		const r = await MappingNodeService.addMappingOutput(this.activeNodeId)
		if (r.ok && r.graph) {
			const node = MappingNodeService.findMappingNode(r.graph, this.activeNodeId)
			if (node) this.activeNode = node
			this._emit('change')
		}
		return !!r.ok
	}

	async removeOutput(outputId) {
		if (!this.activeNodeId || !outputId) return false
		const r = await MappingNodeService.removeMappingOutput(this.activeNodeId, outputId)
		if (r.ok && r.graph) {
			const node = MappingNodeService.findMappingNode(r.graph, this.activeNodeId)
			if (node) {
				this.activeNode = node
				this.mappings = Array.isArray(node.settings?.mappings) ? node.settings.mappings : []
			}
			this._emit('change')
		}
		return !!r.ok
	}

	async updateOutput(outputId, patch) {
		if (!this.activeNodeId) return false
		const r = await MappingNodeService.updateMappingOutputFields(this.activeNodeId, outputId, patch)
		if (r.ok && r.graph) {
			const node = MappingNodeService.findMappingNode(r.graph, this.activeNodeId)
			if (node) this.activeNode = node
			this._emit('change')
		}
		return !!r.ok
	}

	_save() {
		if (!this.activeNodeId) return
		if (this._saveTimer) clearTimeout(this._saveTimer)
		this._saveTimer = setTimeout(async () => {
			this._saveTimer = null
			try {
				const payload = await api.get('/api/device-view')
				const graph = payload.graph
				const node = (graph.devices || []).find(d => d.id === this.activeNodeId)
				if (node) {
					node.settings = node.settings || {}
					node.settings.mappings = this.mappings
					await api.post('/api/device-view', { deviceGraph: graph })
					this._emit('change')
					window.dispatchEvent(new CustomEvent('highascg-device-view-reload'))
				}
			} catch (e) {
				console.error('[MappingState] Save failed:', e)
			}
		}, this._saveDebounceMs)
	}
}

export const mappingState = new MappingState()
