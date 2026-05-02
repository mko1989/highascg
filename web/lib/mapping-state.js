/**
 * Mapping State — manage mapping data (slices and fixtures) for a specific node.
 */
import { api } from './api-client.js'

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
		const { graph, tandemTopology } = payload
		if (this.activeNodeId === nodeId) return
		this.activeNodeId = nodeId
		this.activeNode = (graph?.devices || []).find(d => d.id === nodeId) || null
		
		if (this.activeNode) {
			this.mappings = Array.isArray(this.activeNode.settings?.mappings) ? this.activeNode.settings.mappings : []
			
			// Discover input resolution
			const inConn = (graph?.connectors || []).find(c => c.deviceId === nodeId && c.kind === 'pixel_map_in')
			if (inConn) {
				const edge = (graph?.edges || []).find(e => e.sinkId === inConn.id)
				if (edge) {
					const srcId = String(edge.sourceId)
					if (srcId.startsWith('dst_in_')) {
						const dstId = srcId.slice('dst_in_'.length)
						const dst = (tandemTopology?.destinations || []).find(d => String(d.id) === dstId)
						if (dst) {
							this.canvasWidth = Math.max(64, parseInt(dst.width, 10) || 1920)
							this.canvasHeight = Math.max(64, parseInt(dst.height, 10) || 1080)
						}
					}
				}
			}
		} else {
			this.mappings = []
		}
		this._emit('change')
	}

	addMappingFromTemplate(template, pos = { x: 100, y: 100 }) {
		if (!this.activeNode) return
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
		this._save()
	}

	removeMapping(id) {
		const idx = this.mappings.findIndex(x => x.id === id)
		if (idx >= 0) {
			this.mappings.splice(idx, 1)
			this._save()
		}
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
				}
			} catch (e) {
				console.error('[MappingState] Save failed:', e)
			}
		}, this._saveDebounceMs)
	}
}

export const mappingState = new MappingState()
