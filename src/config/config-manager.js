'use strict'

const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')
const defaults = require('./defaults')
const { finalizeScreenDestinationsConfig } = require('./screen-destinations')
const { applyStreamRecordMappingsFromGraph } = require('./device-graph-output-mapping')

/**
 * Top-level keys that should be saved to separate files when in modular mode.
 */
/** @param {unknown} configPath */
function assertConfigPathString(configPath) {
	if (typeof configPath !== 'string' || !configPath.trim()) {
		throw new TypeError(
			`ConfigManager configPath must be a non-empty string, got ${typeof configPath}`,
		)
	}
}

/** @param {unknown} filePath @param {string} [label] */
function assertFilePathString(filePath, label = 'filePath') {
	if (typeof filePath !== 'string' || !filePath.trim()) {
		throw new TypeError(
			`ConfigManager ${label} must be a non-empty string, got ${typeof filePath}`,
		)
	}
}

/**
 * WO-161 T161.6 — config schema version stamped into the modular config
 * (top-level scalar → persisted in general.json). Absent = 0 (pre-versioning).
 * Loads with version < CONFIG_VERSION run the legacy one-shot migrations
 * (ui nuclear password hash, mediaMount strip, WO-88 host live sources) once,
 * then stamp CONFIG_VERSION in memory so the next successful save persists it
 * and later loads skip them. Bump this when adding a new one-shot migration.
 */
const CONFIG_VERSION = 1

/** @param {unknown} v @returns {number} */
function normalizeConfigVersion(v) {
	const n = parseInt(String(v ?? ''), 10)
	return Number.isFinite(n) && n > 0 ? n : 0
}

const MODULAR_KEYS = [
	'caspar',
	'server',
	'osc',
	'ui',
	'editorDefaults',
	'audioRouting',
	'dmx',
	'rtmp',
	'usbIngest',
	'projectScopedMedia',
	'streamingChannel',
	'recordOutputs',
	'audioOutputs',
	'streamOutputs',
	'casparServer',
	'screenDestinations',
	'deviceGraph',
	'companion',
	'plugins',
	'replication',
	'security',
]

class ConfigManager extends EventEmitter {
	/**
	 * @param {string} configPath - Path to a .json file or a directory for modular config.
	 * @param {object} [logger]
	 */
	constructor(configPath, logger) {
		super()
		assertConfigPathString(configPath)
		this.configPath = configPath
		this.logger = logger || console
		this.config = { ...defaults }
		this.isLoaded = false
		/** Dedupe rapid `emit('change')` for identical JSON (PF-05 Phase D). */
		this._lastConfigChangeJson = null
		this._lastConfigChangeAt = 0
	}

	/**
	 * Load config from disk. If missing, use defaults and save them.
	 */
	load() {
		const num = (v, fallback) => {
			const n = parseInt(String(v ?? ''), 10)
			return Number.isFinite(n) ? n : fallback
		}

		/** T161.6: version of the config as found on disk (0 = pre-versioning). */
		let loadedVersion = 0
		try {
			if (fs.existsSync(this.configPath)) {
				const stats = fs.statSync(this.configPath)
				if (stats.isDirectory()) {
					let loaded = this._loadModular(this.configPath)
					loadedVersion = normalizeConfigVersion(loaded.configVersion)
					if (loadedVersion < CONFIG_VERSION) loaded = this._stripLegacyMediaMount(loaded)
					this.config = finalizeScreenDestinationsConfig(loaded)
					applyStreamRecordMappingsFromGraph(this.config)
					this.logger.info(`[Config] Loaded modular config from directory: ${this.configPath}`)
				} else {
					const raw = fs.readFileSync(this.configPath, 'utf8')
					const parsed = JSON.parse(raw)
					let loaded = this._merge(defaults, parsed)
					loadedVersion = normalizeConfigVersion(loaded.configVersion)
					if (loadedVersion < CONFIG_VERSION) loaded = this._stripLegacyMediaMount(loaded)
					this.config = finalizeScreenDestinationsConfig(loaded)
					applyStreamRecordMappingsFromGraph(this.config)
					this.logger.info(`[Config] Loaded monolithic config from ${this.configPath}`)
				}
				if (loadedVersion > CONFIG_VERSION) {
					this.logger.warn(
						`[Config] *** CONFIG IS NEWER THAN THIS BUILD *** configVersion=${loadedVersion} on disk, this code supports ${CONFIG_VERSION}. ` +
							'Loading anyway — settings written by a newer HighAsCG may be misread or dropped on save. Update the software or restore a matching config.',
					)
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
				this.config = finalizeScreenDestinationsConfig(this._merge(defaults, bootstrap))
				// Fresh config: born at the current schema version, nothing to migrate.
				loadedVersion = CONFIG_VERSION
				this.config.configVersion = CONFIG_VERSION
				this.save(this.config)
			}
			// T161.6: one-shot migrations only for pre-versioning (v0) configs; they
			// still self-detect, this gate just lets them be retired. Load succeeded
			// by this point, so stamp the current version in memory first — any
			// migration save below (or the next regular save) persists it, and
			// subsequent loads skip this block.
			if (loadedVersion < CONFIG_VERSION) {
				this.config.configVersion = CONFIG_VERSION
				const { migrateUiNuclearPassword } = require('../utils/nuclear-password')
				if (this.config.ui && typeof this.config.ui === 'object') {
					const mig = migrateUiNuclearPassword(this.config.ui)
					if (mig.changed) {
						this.config.ui = mig.ui
						this.save(this.config, { emitChange: false })
						this.logger.info('[Config] Migrated ui.nuclearPassword to scrypt hash')
					}
				}
				this._migrateHostLiveSourcesOnce()
			}
			this.isLoaded = true
			this.emit('load', this.config)
			return this.config
		} catch (e) {
			this.logger.error(`[Config] Failed to load ${this.configPath}: ${e.message}`)
			this.config = finalizeScreenDestinationsConfig({ ...defaults })
			return this.config
		}
	}

	/**
	 * Atomic save to disk. Supports both monolithic file and modular directory.
	 *
	 * WO-161 T161.5 — write serialization: the disk work runs synchronously
	 * (writeFileSync + renameSync) before save() returns, so two save() calls
	 * can never interleave their writes; `_saveChain` additionally records
	 * strict FIFO completion order so async flows can chain behind in-flight
	 * saves. (The async caspar XML writer keeps its own mutex in
	 * routes-caspar-config.js.) Return value/semantics unchanged.
	 *
	 * @param {object} newConfig
	 * @param {{ emitChange?: boolean }} [opts] — `emitChange: false` skips subsystem recycle (e.g. during full apply).
	 * @returns {boolean}
	 */
	save(newConfig, opts = {}) {
		const result = this._saveNow(newConfig, opts)
		ConfigManager._saveChain = ConfigManager._saveChain.then(() => result)
		return result
	}

	/**
	 * @param {object} newConfig
	 * @param {{ emitChange?: boolean }} [opts]
	 * @private
	 */
	_saveNow(newConfig, opts = {}) {
		let isDir = false
		try {
			isDir = fs.existsSync(this.configPath) && fs.statSync(this.configPath).isDirectory()

			if (isDir) {
				this._saveModular(this.configPath, newConfig)
				this.logger.info(`[Config] Saved modular config to ${this.configPath}`)
			} else {
				assertConfigPathString(this.configPath)
				const data = JSON.stringify(newConfig, null, 2)
				const tmp = `${this.configPath}.tmp`
				fs.writeFileSync(tmp, data, 'utf8')
				fs.renameSync(tmp, this.configPath)
				this.logger.info(`[Config] Saved monolithic config to ${this.configPath}`)
			}

			this.config = { ...newConfig }
			const dedupeMs = Math.max(0, parseInt(process.env.HIGHASCG_CONFIG_CHANGE_DEDUPE_MS || '300', 10) || 300)
			const payloadJson = JSON.stringify(newConfig)
			const now = Date.now()
			if (
				dedupeMs > 0 &&
				payloadJson === this._lastConfigChangeJson &&
				now - this._lastConfigChangeAt < dedupeMs
			) {
				return true
			}
			this._lastConfigChangeJson = payloadJson
			this._lastConfigChangeAt = now
			if (opts.emitChange !== false) {
				this.emit('change', this.config)
				try {
					const { scheduleExfatSyncAfterConfigSave } = require('../system/exfat-sync-on-save')
					scheduleExfatSyncAfterConfigSave(this.logger)
				} catch {
					/* optional on non-Linux / minimal trees */
				}
			}
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

		if (files.includes('tandem_topology.json')) {
			try {
				const raw = fs.readFileSync(path.join(dir, 'tandem_topology.json'), 'utf8')
				result.tandemTopology = JSON.parse(raw)
			} catch (e) {
				this.logger.error(`[Config] Failed to load tandem_topology.json: ${e.message}`)
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
		assertFilePathString(filePath, 'atomic write path')
		const tmp = `${filePath}.tmp`
		fs.writeFileSync(tmp, data, 'utf8')
		fs.renameSync(tmp, filePath)
	}

	_camelToSnake(str) {
		return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
	}

	/**
	 * WO-88 host live sources migration, run once at load for v0 configs
	 * (T161.6). Previously only ran lazily on settings save / host-live routes;
	 * running it here guarantees it executed before the configVersion stamp
	 * retires the automatic call sites.
	 * @private
	 */
	_migrateHostLiveSourcesOnce() {
		try {
			const { migrateHostLiveSourcesConfig } = require('./host-live-sources-migrate')
			const mig = migrateHostLiveSourcesConfig(this.config, { config: this.config })
			if (!mig.changed) return
			this.config.extraLiveSources = mig.extraLiveSources
			if (mig.casparServerPatch && Object.keys(mig.casparServerPatch).length) {
				this.config.casparServer = { ...(this.config.casparServer || {}), ...mig.casparServerPatch }
			}
			this.save(this.config, { emitChange: false })
			this.logger.info('[Config] Migrated host live sources (WO-88) during load')
			for (const w of mig.warnings || []) this.logger.warn(`[Config] Host live migration: ${w}`)
		} catch (e) {
			this.logger.warn(`[Config] Host live sources migration skipped: ${e?.message || e}`)
		}
	}

	/** WO-38 mediaMount removed — warn once and drop legacy keys from effective config. */
	_stripLegacyMediaMount(cfg) {
		const legacy = cfg && cfg.mediaMount
		const uuid = String(legacy?.uuid || '').trim()
		if (uuid) {
			this.logger.warn(
				`[Config] Ignoring deprecated mediaMount.uuid (${uuid}). Use exFAT (HIGHASCGEXF) for durable config/state/media.`,
			)
		}
		if (legacy) delete cfg.mediaMount
		if (this.configPath && fs.existsSync(this.configPath)) {
			try {
				const stats = fs.statSync(this.configPath)
				if (stats.isDirectory()) {
					const legacyFile = path.join(this.configPath, 'media_mount.json')
					if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile)
				}
			} catch (e) {
				this.logger.warn(`[Config] Could not remove legacy media_mount.json: ${e.message}`)
			}
		}
		return cfg
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
			this.config = finalizeScreenDestinationsConfig({
				...defaults,
				extraLiveSources: [],
				deviceGraph: defaults.deviceGraph,
				gpuPhysicalTopologyOperatorSaved: false,
			})
			this.save(this.config, { emitChange: false })
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

/**
 * T161.5 — module-level promise chain advanced by every save(); strict FIFO.
 * @type {Promise<unknown>}
 */
ConfigManager._saveChain = Promise.resolve()

module.exports = { ConfigManager, CONFIG_VERSION }
