'use strict'

const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')
const defaults = require('../../config/default')

class ConfigManager extends EventEmitter {
	/**
	 * @param {string} configPath
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
				const raw = fs.readFileSync(this.configPath, 'utf8')
				const parsed = JSON.parse(raw)
				this.config = this._merge(defaults, parsed)
				this.logger.info(`[Config] Loaded from ${this.configPath}`)
			} else {
				// Seed first-run file from static defaults + optional env (Docker/install scripts). After this
				// file exists, UI-saved values win — env must not override on every boot (see default.js).
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
	 * Atomic save to disk.
	 * @param {object} newConfig
	 */
	save(newConfig) {
		try {
			const data = JSON.stringify(newConfig, null, 2)
			const tmp = `${this.configPath}.tmp`
			fs.writeFileSync(tmp, data, 'utf8')
			fs.renameSync(tmp, this.configPath)
			this.config = { ...newConfig }
			this.emit('change', this.config)
			this.logger.info(`[Config] Saved to ${this.configPath}`)
			return true
		} catch (e) {
			this.logger.error(`[Config] Failed to save ${this.configPath}: ${e.message}`)
			return false
		}
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
	 * @returns {object}
	 */
	get() {
		return this.config
	}
}

module.exports = { ConfigManager }
