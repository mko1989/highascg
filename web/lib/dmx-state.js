/**
 * DMX state — manage fixtures for pixel mapping.
 */
import { settingsState } from './settings-state.js'

export class DmxState {
	constructor() {
		this.fixtures = []
		this.enabled = false
		this.debugLogDmx = false
		this.fps = 25
		this.canvasWidth = 1920
		this.canvasHeight = 1080
		this._listeners = new Map()
		
		// Map of fixtureId -> data (Array of 0-255 values)
		this.liveColors = new Map()
		/** Debounce writes to disk/API — dragging fixtures must not save on every mousemove. */
		this._saveDebounceMs = 450
		this._saveTimer = null

		settingsState.subscribe((s) => {
			const d = s.dmx && typeof s.dmx === 'object' ? s.dmx : {}
			this.fixtures = Array.isArray(d.fixtures) ? d.fixtures : []
			this.enabled = !!d.enabled
			this.debugLogDmx = !!d.debugLogDmx
			this.fps = typeof d.fps === 'number' && d.fps > 0 ? d.fps : 25
			this._emit('change')
		})
	}

	_emit(key) {
		const fns = this._listeners.get(key)
		if (fns) fns.forEach((fn) => fn())
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

	getFixtures() {
		return this.fixtures
	}

	getFixture(id) {
		return this.fixtures.find(f => f.id === id) || null
	}

	addFixture(opts = {}) {
		const id = opts.id || 'fixture_' + Date.now().toString(36)
		const fixture = {
			id,
			sample: {
				x: Math.round(opts.x || 0),
				y: Math.round(opts.y || 0),
				w: Math.round(opts.w || 200),
				h: Math.round(opts.h || 200)
			},
			rotation: opts.rotation || 0,
			sourceChannel: opts.sourceChannel || 1,
			grid: {
				cols: opts.cols || 1,
				rows: opts.rows || 1
			},
			colorOrder: opts.colorOrder || 'rgb',
			universe: opts.universe || 1,
			startChannel: opts.startChannel || 1,
			protocol: opts.protocol || 'artnet',
			destination: opts.destination || '127.0.0.1',
			gamma: opts.gamma || 2.2,
			brightness: opts.brightness || 1.0
		}
		this.fixtures.push(fixture)
		this._save()
		return fixture
	}

	removeFixture(id) {
		const idx = this.fixtures.findIndex(f => f.id === id)
		if (idx >= 0) {
			this.fixtures.splice(idx, 1)
			this._save()
		}
	}

	updateFixture(id, updates) {
		const fixture = this.getFixture(id)
		if (!fixture) return
		
		if (updates.sample) Object.assign(fixture.sample, updates.sample)
		if (updates.grid) Object.assign(fixture.grid, updates.grid)
		if (updates.rotation !== undefined) fixture.rotation = updates.rotation
		if (updates.sourceChannel !== undefined) fixture.sourceChannel = updates.sourceChannel
		if (updates.colorOrder !== undefined) fixture.colorOrder = updates.colorOrder
		if (updates.universe !== undefined) fixture.universe = updates.universe
		if (updates.startChannel !== undefined) fixture.startChannel = updates.startChannel
		if (updates.protocol !== undefined) fixture.protocol = updates.protocol
		if (updates.destination !== undefined) fixture.destination = updates.destination
		if (updates.gamma !== undefined) fixture.gamma = updates.gamma
		if (updates.brightness !== undefined) fixture.brightness = updates.brightness
		
		this._save()
	}

	setLiveColors(results) {
		for (const res of results) {
			this.liveColors.set(res.id, res.data)
		}
		this._emit('live-colors')
	}

	/**
	 * Align pixel-map canvas with live program output (GET /state channelMap).
	 * @param {object} [channelMap] - From stateStore
	 * @param {number} [screenIndex] - Which screen's PGM resolution (default 0)
	 */
	syncCanvasFromProgramResolution(channelMap, screenIndex = 0) {
		const pr = channelMap?.programResolutions?.[screenIndex]
		const w = pr?.w > 0 ? pr.w : 1920
		const h = pr?.h > 0 ? pr.h : 1080
		if (this.canvasWidth === w && this.canvasHeight === h) return
		this.canvasWidth = w
		this.canvasHeight = h
		this._emit('change')
	}

	_save() {
		if (this._saveTimer) clearTimeout(this._saveTimer)
		this._saveTimer = setTimeout(() => {
			this._saveTimer = null
			const settings = settingsState.getSettings()
			settings.dmx = {
				enabled: this.enabled,
				debugLogDmx: this.debugLogDmx,
				fps: this.fps,
				fixtures: this.fixtures
			}
			void settingsState.save(settings).catch((e) => {
				console.error('[DmxState] Persist failed:', e)
			})
			this._emit('change')
		}, this._saveDebounceMs)
	}

	/** Flush pending debounced save (e.g. before page unload). */
	flushSave() {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer)
			this._saveTimer = null
			const settings = settingsState.getSettings()
			settings.dmx = {
				enabled: this.enabled,
				debugLogDmx: this.debugLogDmx,
				fps: this.fps,
				fixtures: this.fixtures
			}
			return settingsState.save(settings)
		}
		return Promise.resolve()
	}

	setEnabled(v) {
		this.enabled = !!v
		this._save()
	}

	setDebugLogDmx(v) {
		this.debugLogDmx = !!v
		this._save()
	}
}

export const dmxState = new DmxState()
export default dmxState
