/**
 * Front-end store for Companion-style variables.
 * Tracks real-time updates from WebSocket 'variable_update' messages.
 */

export class VariableStore {
	constructor(wsClient) {
		this.variables = {}
		this.listeners = new Set()
		this.ws = wsClient

		if (this.ws) {
			// Initial state normally contains 'variables'
			this.ws.on('state', (data) => {
				if (data && data.variables) {
					this.variables = { ...data.variables }
					this._notify()
				}
			})

			// Incremental updates
			this.ws.on('variable_update', (changed) => {
				Object.assign(this.variables, changed)
				this._notify()
			})
		}
	}

	/**
	 * @param {(vars: Record<string, string>) => void} fn
	 */
	subscribe(fn) {
		this.listeners.add(fn)
		fn(this.variables)
		return () => this.listeners.delete(fn)
	}

	_notify() {
		this.listeners.forEach((fn) => fn(this.variables))
	}

	get(key) {
		return this.variables[key] || ''
	}

	getAll() {
		return this.variables
	}

	/** Merge server snapshot (e.g. GET /api/state or missed WS state) without replacing unrelated keys. */
	mergeFromServer(vars) {
		if (!vars || typeof vars !== 'object') return
		Object.assign(this.variables, vars)
		this._notify()
	}
}

// Global instance for convenience
let instance = null
export function getVariableStore(ws) {
	if (!instance && ws) instance = new VariableStore(ws)
	return instance
}
