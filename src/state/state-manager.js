/**
 * Centralized state manager for CasparCG. Tracks channels, media, templates, serverInfo.
 * Emits change events for WebSocket broadcast.
 */

const EventEmitter = require('events')
const { parseString } = require('xml2js')
const { parseCinfMedia } = require('../media/cinf-parse')
const { dedupeMediaList } = require('../utils/media-browser-dedupe')
const { getInfoXml2jsOptions, extractChannelInfoFromParsed } = require('./info-channel-parse')

const MAX_CHANGES = 500

/**
 * @typedef {object} StateManagerOptions
 * @property {ReturnType<import('../utils/logger').createLogger>} [logger]
 * @property {{ channelStatusLines?: Record<number|string, string> }} [gatheredInfo] - Parent may set channelStatusLines for INFO labels
 * @property {Record<string, string>} [variables] - Companion-style variables snapshot for getState()
 */

const CHANNEL_INFO_EMIT_MS = Math.max(
	0,
	Math.min(250, parseInt(process.env.HIGHASCG_WS_CHANNELS_INFO_DEBOUNCE_MS || '100', 10) || 100),
)

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
		/** INFO-driven channel rows pending WebSocket coalesce */
		this._pendingInfoChannelIds = new Set()
		/** @type {ReturnType<typeof setTimeout> | null} */
		this._infoChannelEmitTimer = null
		/** Skip xml2js when INFO body unchanged (PF-04). */
		this._lastInfoXmlByChannel = new Map()
		/** CINF text → parseCinfMedia result; pruned on CLS refresh. */
		this._cinfParseByMediaId = new Map()
	}

	_emit(path, value) {
		this.emit('change', path, value)
		const ts = Date.now()
		this._changes.push({ path, value, ts })
		if (this._changes.length > MAX_CHANGES) this._changes.shift()
	}

	_queueInfoChannelWsEmit(channelId) {
		if (CHANNEL_INFO_EMIT_MS <= 0) {
			const entry = this._state.channels.find((c) => c.id === channelId)
			if (entry) this._emit(`channels.${channelId}`, entry)
			return
		}
		this._pendingInfoChannelIds.add(channelId)
		if (this._infoChannelEmitTimer) clearTimeout(this._infoChannelEmitTimer)
		this._infoChannelEmitTimer = setTimeout(() => {
			this._infoChannelEmitTimer = null
			const ids = [...this._pendingInfoChannelIds]
			this._pendingInfoChannelIds.clear()
			for (const id of ids) {
				const entry = this._state.channels.find((c) => c.id === id)
				if (entry) this._emit(`channels.${id}`, entry)
			}
		}, CHANNEL_INFO_EMIT_MS)
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
		const prevXml = this._lastInfoXmlByChannel.get(channel)
		if (prevXml === xml) return
		this._lastInfoXmlByChannel.set(channel, xml)
		const manager = this
		const xmlOpts = getInfoXml2jsOptions()
		parseString(xml, xmlOpts, (err, result) => {
			if (err) return
			try {
				const { framerate, layers: parsedLayers } = extractChannelInfoFromParsed(result)
				const layers = []
				for (let i = 0; i < parsedLayers.length; i++) {
					const l = parsedLayers[i]
					if (!l) continue
					const { fgFps: _fp, ...rest } = l
					layers[i] = rest
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
				manager._queueInfoChannelWsEmit(channel)
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
		this._pruneCinfParseCache(media)
		this._state.media = media
		this._emit('media', media)
	}

	_pruneCinfParseCache(mediaList) {
		const ids = new Set((mediaList || []).map((m) => m && m.id).filter(Boolean))
		for (const k of this._cinfParseByMediaId.keys()) {
			if (!ids.has(k)) this._cinfParseByMediaId.delete(k)
		}
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
			if (!cinf) {
				return { ...m, cinf: '' }
			}
			const hit = this._cinfParseByMediaId.get(m.id)
			if (hit && hit.cinf === cinf) {
				return { ...m, cinf, ...hit.parsed }
			}
			const parsed = parseCinfMedia(cinf)
			this._cinfParseByMediaId.set(m.id, { cinf, parsed })
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
