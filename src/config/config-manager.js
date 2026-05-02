'use strict'

const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')
const defaults = require('./defaults')

/**
 * Top-level keys that should be saved to separate files when in modular mode.
 */
const MODULAR_KEYS = [
	'caspar',
	'server',
	'osc',
	'ui',
	'audioRouting',
	'dmx',
	'rtmp',
	'usbIngest',
	'streamingChannel',
	'recordOutputs',
	'audioOutputs',
	'streamOutputs',
	'casparServer',
	'tandemTopology',
	'deviceGraph',
	'companion',
	'pixelhue',
]

class ConfigManager extends EventEmitter {
	/**
	 * @param {string} configPath - Path to a .json file or a directory for modular config.
	 * @param {object} [logger]
	 */
	constructor(configPath, logger) {
		super()
		this.configPath = configPath
		this.logger = logger || console
		this.config = { ...defaults }
		this.isLoaded = false
	}

	/**
	 * Load config from disk. If missing, use defaults and save them.
	 */
	load() {
		const num = (v, fallback) => {
			const n = parseInt(String(v ?? ''), 10)
			return Number.isFinite(n) ? n : fallback
		}

		try {
			if (fs.existsSync(this.configPath)) {
				const stats = fs.statSync(this.configPath)
				if (stats.isDirectory()) {
					this.config = this._loadModular(this.configPath)
					this.logger.info(`[Config] Loaded modular config from directory: ${this.configPath}`)
				} else {
					const raw = fs.readFileSync(this.configPath, 'utf8')
					const parsed = JSON.parse(raw)
					this.config = this._merge(defaults, parsed)
					this.logger.info(`[Config] Loaded monolithic config from ${this.configPath}`)
				}
			} else {
				this.logger.info(`[Config] No config found at ${this.configPath}. Creating from defaults + environment.`)
				const bootstrap = {
					caspar: {
						host: process.env.CASPAR_HOST || defaults.caspar.host,
						port: num(process.env.CASPAR_PORT, defaults.caspar.port),
					},
					server: {
						httpPort: num(process.env.HTTP_PORT ?? process.env.PORT, defaults.server.httpPort),
						wsPort: num(process.env.WS_PORT, defaults.server.wsPort),
						bindAddress: process.env.BIND_ADDRESS || defaults.server.bindAddress,
					},
					osc: {
						listenPort: num(process.env.OSC_LISTEN_PORT, defaults.osc.listenPort),
						listenAddress: process.env.OSC_BIND_ADDRESS || defaults.osc.listenAddress,
					},
				}
				this.config = this._merge(defaults, bootstrap)
				this.save(this.config)
			}
			this.isLoaded = true
			this.emit('load', this.config)
			return this.config
		} catch (e) {
			this.logger.error(`[Config] Failed to load ${this.configPath}: ${e.message}`)
			this.config = { ...defaults }
			return this.config
		}
	}

	/**
	 * Atomic save to disk. Supports both monolithic file and modular directory.
	 * @param {object} newConfig
	 */
	save(newConfig) {
		try {
			const isDir = fs.existsSync(this.configPath) && fs.statSync(this.configPath).isDirectory()

			if (isDir) {
				this._saveModular(this.configPath, newConfig)
				this.logger.info(`[Config] Saved modular config to ${this.configPath}`)
			} else {
				const data = JSON.stringify(newConfig, null, 2)
				const tmp = `${this.configPath}.tmp`
				fs.writeFileSync(tmp, data, 'utf8')
				fs.renameSync(tmp, this.configPath)
				this.logger.info(`[Config] Saved monolithic config to ${this.configPath}`)
			}

			this.config = { ...newConfig }
			this.emit('change', this.config)
			return true
		} catch (e) {
			const code = e && e.code
			let hint = ''
			if (code === 'EACCES' || code === 'EPERM') {
				const dir = isDir ? this.configPath : path.dirname(this.configPath)
				hint = ` (atomic write needs create+rename in that directory. Fix: sudo chown -R $USER:$USER ${dir})`
			}
			this.logger.error(`[Config] Failed to save ${this.configPath}: ${e.message}${hint}`)
			return false
		}
	}

	/**
	 * Load modular config from a directory.
	 * @param {string} dir
	 * @private
	 */
	_loadModular(dir) {
		const result = { ...defaults }
		const files = fs.readdirSync(dir)

		// 1. Load general.json first if it exists
		if (files.includes('general.json')) {
			try {
				const raw = fs.readFileSync(path.join(dir, 'general.json'), 'utf8')
				Object.assign(result, JSON.parse(raw))
			} catch (e) {
				this.logger.error(`[Config] Failed to load general.json: ${e.message}`)
			}
		}

		// 2. Load each modular key
		for (const key of MODULAR_KEYS) {
			const filename = `${this._camelToSnake(key)}.json`
			if (files.includes(filename)) {
				try {
					const raw = fs.readFileSync(path.join(dir, filename), 'utf8')
					const parsed = JSON.parse(raw)
					if (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
						result[key] = { ...result[key], ...parsed }
					} else {
						result[key] = parsed
					}
				} catch (e) {
					this.logger.error(`[Config] Failed to load ${filename}: ${e.message}`)
				}
			}
		}

		return result
	}

	/**
	 * Save modular config to a directory.
	 * @param {string} dir
	 * @param {object} config
	 * @private
	 */
	_saveModular(dir, config) {
		const general = { ...config }

		for (const key of MODULAR_KEYS) {
			if (config[key] !== undefined) {
				const filename = `${this._camelToSnake(key)}.json`
				const data = JSON.stringify(config[key], null, 2)
				this._atomicWrite(path.join(dir, filename), data)
				delete general[key]
			}
		}

		// Save remaining keys to general.json
		if (Object.keys(general).length > 0) {
			const data = JSON.stringify(general, null, 2)
			this._atomicWrite(path.join(dir, 'general.json'), data)
		}
	}

	/**
	 * Helper for atomic file write.
	 */
	_atomicWrite(filePath, data) {
		const tmp = `${filePath}.tmp`
		fs.writeFileSync(tmp, data, 'utf8')
		fs.renameSync(tmp, filePath)
	}

	_camelToSnake(str) {
		return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
	}

	/**
	 * Deep merge logic (simple level-1 for this app's config structure)
	 */
	_merge(base, override) {
		const out = { ...base }
		for (const k in override) {
			if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k]) && base[k]) {
				out[k] = { ...base[k], ...override[k] }
			} else {
				out[k] = override[k]
			}
		}
		return out
	}

	/**
	 * Purge current config from disk and reset to defaults.
	 */
	factoryReset() {
		try {
			if (fs.existsSync(this.configPath)) {
				const stats = fs.statSync(this.configPath)
				if (stats.isDirectory()) {
					const files = fs.readdirSync(this.configPath)
					for (const f of files) {
						if (f.endsWith('.json')) fs.unlinkSync(path.join(this.configPath, f))
					}
				} else {
					fs.unlinkSync(this.configPath)
				}
				this.logger.info(`[Config] Purged config at ${this.configPath}`)
			}
			this.config = { ...defaults }
			this.emit('change', this.config)
			return true
		} catch (e) {
			const code = e && e.code
			let hint = ''
			if (code === 'EACCES' || code === 'EPERM') {
				hint = ` (Fix: sudo chown -R $USER:$USER ${this.configPath})`
			}
			this.logger.error(`[Config] Factory reset failed: ${e.message}${hint}`)
			return false
		}
	}

	/**
	 * @returns {object}
	 */
	get() {
		return this.config
	}
}

module.exports = { ConfigManager }
