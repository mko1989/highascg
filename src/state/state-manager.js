/**
 * Centralized state manager for CasparCG. Tracks channels, media, templates, serverInfo.
 * Emits change events for WebSocket broadcast.
 */

const EventEmitter = require('events')
const { parseString } = require('xml2js')
const { parseCinfMedia } = require('../media/cinf-parse')
const { dedupeMediaList } = require('../utils/media-browser-dedupe')

const MAX_CHANGES = 500

/**
 * @typedef {object} StateManagerOptions
 * @property {ReturnType<import('../utils/logger').createLogger>} [logger]
 * @property {{ channelStatusLines?: Record<number|string, string> }} [gatheredInfo] - Parent may set channelStatusLines for INFO labels
 * @property {Record<string, string>} [variables] - Companion-style variables snapshot for getState()
 */

class StateManager extends EventEmitter {
	/**
	 * @param {StateManagerOptions} [options]
	 */
	constructor(options = {}) {
		super()
		this._logger = options.logger || require('../utils/logger').defaultLogger
		/** @type {{ channelStatusLines?: Record<number|string, string> }} */
		this.gatheredInfo = options.gatheredInfo || { channelStatusLines: {} }
		/** Live reference — parent mutates for getState().variables */
		this.variables = options.variables || {}
		this._state = {
			channels: [],
			media: [],
			templates: [],
			serverInfo: {
				version: '',
				flashVersion: '',
				templateHostVersion: '',
				paths: '',
				system: '',
				config: '',
			},
			decklinkInputs: [],
			routes: {},
			/** @type {object | null} — mirror of {@link OscState#getSnapshot} when OSC is enabled */
			osc: null,
			/** @type {Record<string, { nbChannels: number, levels: unknown[] }>} — mixer levels by channel id string */
			audio: {},
		}
		this._changes = []
		this._pendingVarChanges = new Set()
		this._varThrottleTimer = null
	}

	_emit(path, value) {
		this.emit('change', path, value)
		const ts = Date.now()
		this._changes.push({ path, value, ts })
		if (this._changes.length > MAX_CHANGES) this._changes.shift()
	}

	/**
	 * Set a Companion-style variable.
	 * @param {string} key
	 * @param {any} value
	 */
	setVariable(key, value) {
		const strVal = value == null ? '' : String(value)
		if (this.variables[key] === strVal) return

		this.variables[key] = strVal
		this._pendingVarChanges.add(key)

		if (!this._varThrottleTimer) {
			this._varThrottleTimer = setTimeout(() => {
				const changed = {}
				for (const k of this._pendingVarChanges) {
					changed[k] = this.variables[k]
					// Also emit as a specific change path for delta tracking
					this._emit(`variables.${k}`, this.variables[k])
				}
				this.emit('variables', changed)
				this._pendingVarChanges.clear()
				this._varThrottleTimer = null
			}, 100) // 10Hz throttle
		}
	}

	/**
	 * Parse INFO channel XML and update channels state.
	 * @param {number} channel - Channel number
	 * @param {string} xml - Raw INFO response XML
	 */
	updateFromInfo(channel, xml) {
		if (!xml || typeof xml !== 'string') return
		const manager = this
		parseString(xml, (err, result) => {
			if (err) return
			try {
				let framerate = ''
				const layers = []
				if (result.channel && result.channel.framerate && result.channel.framerate[0]) {
					framerate = result.channel.framerate[0]
				}
				if (result.channel && result.channel.stage && result.channel.stage[0] && result.channel.stage[0].layer && result.channel.stage[0].layer[0]) {
					const layerObj = result.channel.stage[0].layer[0]
					Object.keys(layerObj).forEach((key) => {
						if (!key.startsWith('layer_') || !Array.isArray(layerObj[key]) || !layerObj[key][0]) return
						const layerIdx = parseInt(key.replace('layer_', ''), 10)
						const lr = layerObj[key][0]
						const fg = lr.foreground && lr.foreground[0]
						const bg = lr.background && lr.background[0]
						let fgClip = ''
						let fgState = 'empty'
						let bgClip = ''
						let nbFrames = 0
						let currentFrame = 0
						if (fg && fg.producer && fg.producer[0]) {
							const p = fg.producer[0]
							fgClip = p.$ && p.$.name ? p.$.name : p.name && p.name[0] ? p.name[0] : ''
							fgState = fg.paused && fg.paused[0] === 'true' ? 'paused' : 'playing'
							nbFrames = parseInt(p['nb-frames'] && p['nb-frames'][0], 10) || 0
							currentFrame = parseInt(p.frame && p.frame[0], 10) || parseInt(p['frame-time'] && p['frame-time'][0], 10) || 0
						}
						if (fg && fg.file && fg.file[0]) {
							const f = fg.file[0]
							fgClip = f.$ && f.$.name ? f.$.name : f.clip && f.clip[1] ? String(f.clip[1]) : fgClip
							if (f.clip && f.clip[1]) nbFrames = Math.floor(parseFloat(f.clip[1]) * (parseInt(framerate, 10) || 1))
						}
						if (bg && bg.producer && bg.producer[0]) {
							bgClip = bg.producer[0].$ && bg.producer[0].$.name ? bg.producer[0].$.name : ''
						}
						const fpsNum = parseInt(framerate, 10) || 1
						const durationSec = nbFrames > 0 ? (nbFrames / fpsNum).toFixed(2) : ''
						const timeSec = nbFrames > 0 && currentFrame >= 0 ? (currentFrame / fpsNum).toFixed(2) : ''
						const remainingSec = nbFrames > 0 && currentFrame >= 0 ? ((nbFrames - currentFrame) / fpsNum).toFixed(2) : ''
						layers[layerIdx] = { fgClip, fgState, bgClip, durationSec, timeSec, remainingSec }
					})
				}
				if (result.layer && result.layer.foreground && result.layer.foreground[0]) {
					const p = result.layer.foreground[0].producer && result.layer.foreground[0].producer[0]
					if (p) {
						const fr = p.fps && p.fps[0] ? p.fps[0] : ''
						const nb = parseInt(p['nb-frames'] && p['nb-frames'][0], 10) || 0
						const cur = parseInt(p.frame && p.frame[0], 10) || 0
						const fpsNum = parseInt(fr, 10) || 1
						layers[0] = {
							fgClip: p.$ && p.$.name ? p.$.name : p.name && p.name[0] ? p.name[0] : '',
							fgState: result.layer.foreground[0].paused && result.layer.foreground[0].paused[0] === 'true' ? 'paused' : 'playing',
							bgClip: '',
							durationSec: nb > 0 ? (nb / fpsNum).toFixed(2) : '',
							timeSec: nb > 0 && cur >= 0 ? (cur / fpsNum).toFixed(2) : '',
							remainingSec: nb > 0 && cur >= 0 ? ((nb - cur) / fpsNum).toFixed(2) : '',
						}
					}
				}
				let chIdx = this._state.channels.findIndex((c) => c.id === channel)
				if (chIdx < 0) {
					chIdx = this._state.channels.length
					this._state.channels.push({
						id: channel,
						videoMode: '',
						status: '',
						layers: [],
					})
				}
				const ch = this._state.channels[chIdx]
				ch.framerate = framerate
				ch.layers = layers
				const lines = manager.gatheredInfo && manager.gatheredInfo.channelStatusLines
				if (lines) ch.status = lines[channel] || ''
				manager._emit(`channels.${channel}`, ch)
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e)
				manager._logger.debug('StateManager parse INFO: ' + msg)
			}
		})
	}

	/**
	 * Update media list from CLS response.
	 */
	updateFromCLS(data) {
		let media = []
		this._logger.debug(`CLS: parsing ${(data || []).length} lines`)
		for (let i = 0; i < (data || []).length; ++i) {
			const line = String(data[i] || '')
			const match = line.match(/^"([^"]+)"/)
			if (!match || !match[1]) continue
			const file = match[1].replace(/\\/g, '\\\\')
			const item = { id: file, label: file }
			const rest = line.slice(match[0].length).trim()
			const parts = rest.split(/\s+/)
			if (parts[0]) item.type = parts[0]
			if (parts[1]) {
				const sz = parseInt(parts[1], 10)
				if (!isNaN(sz) && sz > 0) item.fileSize = sz
			}
			const framesIdx = parts.findIndex((p) => /^\d+\/\d+$/.test(p))
			if (framesIdx > 0) {
				const frames = parseInt(parts[framesIdx - 1], 10) || 0
				const frac = parts[framesIdx].split('/')
				const num = parseInt(frac[0], 10) || 1
				const den = parseInt(frac[1], 10) || 1
				const fps = den / num
				if (fps > 0) item.fps = Math.round(fps * 100) / 100
				if (frames > 0 && fps > 0) item.durationMs = Math.round((frames / fps) * 1000)
			}
			if (framesIdx >= 0 && framesIdx + 2 < parts.length) {
				const w = parseInt(parts[framesIdx + 1], 10)
				const h = parseInt(parts[framesIdx + 2], 10)
				if (w > 0 && h > 0 && w < 99999 && h < 99999) item.resolution = `${w}×${h}`
			}
			if (i < 3) {
				this._logger.debug(
					`CLS[${i}]: "${file}" type=${item.type} res=${item.resolution || '?'} dur=${item.durationMs || '?'}ms fps=${item.fps || '?'} size=${item.fileSize || '?'}`
				)
			}
			media.push(item)
		}
		media = dedupeMediaList(media)
		this._logger.debug(`CLS: parsed ${media.length} media items, ${media.filter((m) => m.resolution).length} with resolution`)
		this._state.media = media
		this._emit('media', media)
	}

	/**
	 * Update template list from TLS response.
	 * @param {Array<string>} data - TLS response lines
	 */
	updateFromTLS(data) {
		const templates = []
		for (let i = 0; i < (data || []).length; ++i) {
			const match = data[i].match(/\"(.*?)\" +(.*)/)
			let file = null
			if (match === null) file = data[i]
			else file = match[1]
			if (file !== null) {
				file = file.replace(/\\/g, '\\\\')
				templates.push({ id: file, label: file })
			}
		}
		this._state.templates = templates
		this._emit('templates', templates)
	}

	/**
	 * Update server info (version, paths, system, config).
	 */
	updateServerInfo(updates) {
		if (updates.version !== undefined) {
			this._state.serverInfo.version = String(updates.version)
			this._emit('serverInfo.version', this._state.serverInfo.version)
		}
		if (updates.flashVersion !== undefined) {
			this._state.serverInfo.flashVersion = String(updates.flashVersion)
			this._emit('serverInfo.flashVersion', this._state.serverInfo.flashVersion)
		}
		if (updates.templateHostVersion !== undefined) {
			this._state.serverInfo.templateHostVersion = String(updates.templateHostVersion)
			this._emit('serverInfo.templateHostVersion', this._state.serverInfo.templateHostVersion)
		}
		if (updates.paths !== undefined) {
			this._state.serverInfo.paths = String(updates.paths)
			this._emit('serverInfo.paths', this._state.serverInfo.paths)
		}
		if (updates.system !== undefined) {
			this._state.serverInfo.system = String(updates.system)
			this._emit('serverInfo.system', this._state.serverInfo.system)
		}
		if (updates.config !== undefined) {
			this._state.serverInfo.config = String(updates.config)
			this._emit('serverInfo.config', this._state.serverInfo.config)
		}
	}

	/**
	 * Merge CINF strings into media list and attach parsed fields (durationMs, resolution, fps, type).
	 * @param {Record<string, string>} mediaDetails - filename -> raw CINF response text
	 */
	updateMediaDetails(mediaDetails) {
		const md = mediaDetails || {}
		this._state.media = (this._state.media || []).map((m) => {
			const cinf = md[m.id] || ''
			const parsed = cinf ? parseCinfMedia(cinf) : {}
			return { ...m, cinf, ...parsed }
		})
		this._emit('media', this._state.media)
	}

	/**
	 * Merge CasparCG OSC aggregate into state (from {@link OscState#getSnapshot}).
	 * @param {{ channels?: Record<string, unknown>, updatedAt?: number } | null} snapshot
	 */
	updateFromOscSnapshot(snapshot) {
		if (!snapshot || typeof snapshot !== 'object') {
			this._state.osc = null
			this._state.audio = {}
			this._stripOscFieldsFromChannels()
			this._emit('osc', null)
			return
		}
		this._state.osc = JSON.parse(JSON.stringify(snapshot))
		const chans = snapshot.channels || {}
		const audio = {}
		const seenIds = new Set()
		for (const k of Object.keys(chans)) {
			const ch = chans[k]
			if (!ch || typeof ch !== 'object') continue
			if (ch.audio) {
				audio[k] = {
					nbChannels: ch.audio.nbChannels,
					levels: JSON.parse(JSON.stringify(ch.audio.levels || [])),
				}
			}
			const id = parseInt(k, 10)
			if (!Number.isFinite(id)) continue
			seenIds.add(id)
			let entry = this._state.channels.find((c) => c.id === id)
			if (!entry) {
				entry = { id, layers: [], videoMode: '', status: '' }
				this._state.channels.push(entry)
			}
			entry.oscFormat = ch.format != null ? String(ch.format) : null
			entry.oscLayers = ch.layers ? JSON.parse(JSON.stringify(ch.layers)) : {}
			entry.oscProfiler = ch.profiler ? { ...ch.profiler } : undefined
			entry.oscOutputs = ch.outputs ? JSON.parse(JSON.stringify(ch.outputs)) : {}
			this._emit(`channels.${id}`, entry)
		}
		for (const entry of this._state.channels) {
			if (!seenIds.has(entry.id)) {
				delete entry.oscFormat
				delete entry.oscLayers
				delete entry.oscProfiler
				delete entry.oscOutputs
			}
		}
		this._state.audio = audio
		this._emit('osc', this._state.osc)
		this._emit('audio', this._state.audio)
	}

	_stripOscFieldsFromChannels() {
		for (const ch of this._state.channels) {
			delete ch.oscFormat
			delete ch.oscLayers
			delete ch.oscProfiler
			delete ch.oscOutputs
		}
	}

	/** Clear OSC mirror (e.g. when OSC listener stops). */
	clearOscMirror() {
		this.updateFromOscSnapshot(null)
	}

	/**
	 * Full state snapshot.
	 * @returns {object}
	 */
	getState() {
		return {
			channels: JSON.parse(JSON.stringify(this._state.channels)),
			media: JSON.parse(JSON.stringify(this._state.media)),
			templates: JSON.parse(JSON.stringify(this._state.templates)),
			serverInfo: { ...this._state.serverInfo },
			decklinkInputs: [...this._state.decklinkInputs],
			routes: { ...this._state.routes },
			variables: { ...this.variables },
			osc: this._state.osc ? JSON.parse(JSON.stringify(this._state.osc)) : null,
			audio: JSON.parse(JSON.stringify(this._state.audio)),
		}
	}

	/**
	 * Changes since timestamp. Returns { changedPaths, updates }.
	 * @param {number} since - Timestamp (ms)
	 * @returns {object}
	 */
	getDelta(since) {
		const entries = this._changes.filter((e) => e.ts > since)
		const changedPaths = [...new Set(entries.map((e) => e.path))]
		const updates = {}
		for (const e of entries) {
			updates[e.path] = e.value
		}
		return { changedPaths, updates, lastTs: entries.length ? Math.max(...entries.map((e) => e.ts)) : since }
	}
}

module.exports = { StateManager }
