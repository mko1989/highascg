/**
 * Placeholder State — manage virtual media assets for simulation mode.
 */

export const PLACEHOLDER_TEMPLATES = [
	{ id: 'color_grid', label: 'Color Grid', description: 'Multi-color test grid with 10% steps' },
	{ id: 'smpte_bars', label: 'SMPTE Bars', description: 'Standard SMPTE color bars' },
	{ id: 'aspect_guide', label: 'Aspect Ratio Guide', description: '16:9, 4:3, and 2.35:1 framing guides' },
	{ id: 'countdown', label: 'Countdown', description: 'Circular 10s visual countdown' },
	{ id: 'white_noise', label: 'White Noise', description: 'Animated static' },
	{ id: 'solid', label: 'Solid Color', description: 'Constant color fill' },
]

export class PlaceholderState {
	constructor() {
		this.placeholders = []
		this._listeners = []
		this._load()
	}

	on(fn) {
		this._listeners.push(fn)
		return () => {
			const i = this._listeners.indexOf(fn)
			if (i >= 0) this._listeners.splice(i, 1)
		}
	}

	_emit() {
		this._listeners.forEach(fn => fn(this.placeholders))
	}

	getAll() {
		return this.placeholders
	}

	add(p) {
		const id = `PLC_${p.template.toUpperCase()}_${Date.now().toString(36).toUpperCase()}`
		const newItem = {
			id,
			label: p.label || id,
			template: p.template || 'color_grid',
			resolution: p.resolution || '1080p5000',
			durationMs: p.durationMs || 60000,
			isPlaceholder: true,
			isDir: false,
			value: p.value,
		}
		this.placeholders.push(newItem)
		this._save()
		this._emit()
		return newItem
	}

	remove(id) {
		const i = this.placeholders.findIndex(p => p.id === id)
		if (i >= 0) {
			this.placeholders.splice(i, 1)
			this._save()
			this._emit()
		}
	}

	update(id, patch) {
		const p = this.placeholders.find(x => x.id === id)
		if (p) {
			Object.assign(p, patch)
			this._save()
			this._emit()
		}
	}

	_save() {
		try {
			localStorage.setItem('casparcg_placeholders', JSON.stringify(this.placeholders))
		} catch {}
	}

	_load() {
		try {
			const raw = localStorage.getItem('casparcg_placeholders')
			if (raw) this.placeholders = JSON.parse(raw)
		} catch {}
	}

	getExportData() {
		return this.placeholders
	}

	loadFromData(data) {
		this.placeholders = Array.isArray(data) ? [...data] : []
		this._save()
		this._emit()
	}
}

export const placeholderState = new PlaceholderState()
export default PlaceholderState
