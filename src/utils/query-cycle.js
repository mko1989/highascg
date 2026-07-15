/**
 * AMCP query chains after connect (CLS → CINF → TLS → VERSION/INFO…).
 * Decoupled from Companion — pass an **app context** `ctx` with socket, response_callback, state, etc.
 * @see companion-module-casparcg-server/src/instance.js
 */

'use strict'

const { parseString } = require('xml2js')
const { getInfoXml2jsOptions, extractChannelInfoFromParsed } = require('../state/info-channel-parse')
const handlers = require('./handlers')
const { broadcastTemplateCatalog } = require('./media-catalog-broadcast')
const { ensureLocalThumbnailCacheForMediaIds } = require('../media/local-media-ffmpeg')
const { broadcastWsStateSnapshot } = require('../api/get-state')

/** Skip redundant INFO XML parse for Companion variables when body unchanged (PF-04). */
const _channelXmlForVariables = new Map()

/**
 * Share Caspar AMCP socket + response routing with `appCtx` so {@link attachEnqueueQueue}
 * callbacks receive the same lines as {@link AmcpClient} (`/api/raw`, `amcp.query.*`).
 * Without this, CLS/TLS query cycles register on a separate `response_callback` and never populate catalogs.
 * @param {object} appCtx
 * @param {{ context?: object }} connectionManager
 */
function bindAppCtxAmcpTransport(appCtx, connectionManager) {
	const connCtx = connectionManager?.context
	if (!appCtx || !connCtx) return
	appCtx.socket = connCtx.socket
	appCtx.response_callback = connCtx.response_callback
	appCtx._resetAmcpProtocol = connCtx._resetAmcpProtocol
	Object.defineProperty(appCtx, '_pendingResponseKey', {
		enumerable: true,
		configurable: true,
		get() {
			return connCtx._pendingResponseKey
		},
		set(v) {
			connCtx._pendingResponseKey = v
		},
	})
	Object.defineProperty(appCtx, '_amcpBatchDrain', {
		enumerable: true,
		configurable: true,
		get() {
			return connCtx._amcpBatchDrain
		},
		set(v) {
			connCtx._amcpBatchDrain = v
		},
	})
}

function scheduleStartupHqThumbnailPrewarm(self) {
	if (self?._hqThumbStartupPrewarmDone) return
	if (self?._hqThumbPrewarmInFlight) return
	if (self?.config?.hq_thumbnail_prewarm_on_start === false) return
	const ids = (self?.state?.getState?.()?.media || []).map((m) => String(m?.id || '').trim()).filter(Boolean)
	if (ids.length === 0) return
	const maxStartupThumb = Math.min(ids.length, 80)
	self._hqThumbPrewarmInFlight = ensureLocalThumbnailCacheForMediaIds(self.config || {}, ids, { maxItems: maxStartupThumb, maxW: 960, seekSec: 2 })
		.then((stats) => {
			self._hqThumbStartupPrewarmDone = true
			if (typeof self.log === 'function' && stats?.generated > 0) {
				self.log('info', `HQ thumbnail startup prewarm: generated ${stats.generated} (cached ${stats.cached}, attempted ${stats.attempted})`)
			}
		})
		.catch((e) => {
			if (typeof self.log === 'function') self.log('debug', 'HQ thumbnail startup prewarm failed: ' + (e?.message || e))
		})
		.finally(() => {
			self._hqThumbPrewarmInFlight = null
		})
}

/**
 * @param {*} data
 */
function responseToStr(data) {
	if (data == null) return ''
	if (Array.isArray(data)) return data.join('\n')
	return String(data)
}

/**
 * Attach `enqueue` / `runCommandQueue` / `requestData` (same semantics as legacy module instance).
 * @param {{
 *   socket?: import('../caspar/tcp-client').TcpClient,
 *   response_callback?: Record<string, Function[]>,
 *   _pendingResponseKey?: string,
 *   commandQueue?: Array<object>,
 * }} ctx
 */
function attachEnqueueQueue(ctx) {
	if (typeof ctx.requestData === 'function') return
	ctx.commandQueue = ctx.commandQueue || []
	ctx.response_callback = ctx.response_callback || {}

	ctx.enqueue = function enqueue(command, params, responseKey, callback) {
		ctx.commandQueue.push({
			command,
			params: params != null && params !== '' ? String(params) : null,
			responseKey:
				responseKey !== undefined
					? String(responseKey).toUpperCase()
					: String(command).split(/\s+/)[0].toUpperCase(),
			callback: typeof callback === 'function' ? callback : undefined,
		})
	}

	ctx.runCommandQueue = function runCommandQueue() {
		if (!ctx.socket || !ctx.socket.isConnected || ctx.commandQueue.length === 0) return
		const item = ctx.commandQueue.shift()
		ctx.requestData(
			item.command,
			item.params,
			(...args) => {
				if (item.callback) item.callback(...args)
				ctx.runCommandQueue()
			},
			item.responseKey,
		)
	}

	ctx.requestData = function requestData(command, params, callback, responseKey) {
		if (ctx.socket && ctx.socket.isConnected) {
			const fullCommand = (command + (params != null && params !== '' ? ' ' + params : '')).trim().toUpperCase()
			const key =
				responseKey !== undefined ? String(responseKey).toUpperCase() : fullCommand.split(/\s+/)[0]
			if (ctx.response_callback[key] === undefined) ctx.response_callback[key] = []
			ctx.response_callback[key].push(callback)
			ctx._pendingResponseKey = key
			ctx.socket.send(fullCommand)
		}
	}
}

/**
 * Media library only: CLS + CINF + TLS.
 * @param {object} ctx
 */
function runMediaLibraryQueryCycle(ctx) {
	attachEnqueueQueue(ctx)
	const self = ctx
	self.commandQueue = []
	self.mediaDetails = {}

	self.enqueue('CLS', null, 'CLS', (data) => {
		handlers.handleCLS(self, data)
		scheduleStartupHqThumbnailPrewarm(self)
		const queryCinf = self.config && self.config.query_cinf !== false
		const maxCinf = Math.max(0, parseInt(String(self.config?.max_cinf ?? 100), 10))
		if (queryCinf && maxCinf > 0) {
			const files = self.CHOICES_MEDIAFILES.slice(0, maxCinf)
			files.forEach((choice) => {
				const filename = choice.id || choice.label
				if (!filename || String(filename).match(/^\d+-/)) return
				if (/^CASPARCG-/i.test(String(filename))) return
				const cinfParam = filename.indexOf(' ') >= 0 ? '"' + String(filename).replace(/"/g, '\\"') + '"' : filename
				self.enqueue('CINF', cinfParam, 'CINF', (cinfData) => {
					self.mediaDetails[filename] = responseToStr(cinfData)
				})
			})
		}
		self.enqueue('TLS', null, 'TLS', (data) => {
			if (self.state && self.mediaDetails) self.state.updateMediaDetails(self.mediaDetails)
			handlers.handleTLS(self, data)
			broadcastTemplateCatalog(self)
		})
		self.runCommandQueue()
	})
	self.runCommandQueue()
}

/**
 * Full post-connect query: CLS → CINF → TLS → VERSION×3 → INFO tree → per-channel INFO.
 * Optional hooks on `ctx` (no-op if missing): `updateChannelVariablesFromXml`, `summarizeConsumersFromConfig`,
 * `parseInfoConfigForDecklinks`, `refreshConfigComparison`, `updateDynamicVariables`, `updateDynamicPresets`,
 * `clearVariablePollTimers`, `checkFeedbacks`, `setupAllRouting`, `reconcileAfterInfoGather`, `startPeriodicSync`, `log`.
 *
 * @param {object} ctx
 */
function runConnectionQueryCycle(ctx) {
	attachEnqueueQueue(ctx)
	const self = ctx
	self.commandQueue = []
	self.mediaDetails = {}
	self.gatheredInfo = {
		channelIds: [],
		channelStatusLines: {},
		infoPaths: '',
		infoSystem: '',
		infoConfig: '',
		channelXml: {},
		decklinkFromConfig: {},
	}

	self.enqueue('CLS', null, 'CLS', (data) => {
		handlers.handleCLS(self, data)
		scheduleStartupHqThumbnailPrewarm(self)
		const queryCinf = self.config && self.config.query_cinf !== false
		const maxCinf = Math.max(0, parseInt(String(self.config?.max_cinf ?? 100), 10))
		if (queryCinf && maxCinf > 0) {
			const files = self.CHOICES_MEDIAFILES.slice(0, maxCinf)
			files.forEach((choice) => {
				const filename = choice.id || choice.label
				if (!filename || String(filename).match(/^\d+-/)) return
				if (/^CASPARCG-/i.test(String(filename))) return
				const cinfParam = filename.indexOf(' ') >= 0 ? '"' + String(filename).replace(/"/g, '\\"') + '"' : filename
				self.enqueue('CINF', cinfParam, 'CINF', (cinfData) => {
					self.mediaDetails[filename] = responseToStr(cinfData)
				})
			})
		}
		self.enqueue('TLS', null, 'TLS', (data) => {
			if (self.state && self.mediaDetails) self.state.updateMediaDetails(self.mediaDetails)
			handlers.handleTLS(self, data)
			broadcastTemplateCatalog(self)
			self.enqueue('VERSION', null, 'VERSION', (line) => {
				const v = responseToStr(line)
				if (self.variables) self.variables.server_version = v
				self.state.updateServerInfo({ version: v })
				if (typeof self.setVariableValues === 'function') self.setVariableValues({ server_version: self.variables.server_version })
			})
			self.enqueue('VERSION FLASH', null, 'VERSION', (line) => {
				const v = responseToStr(line)
				if (self.variables) self.variables.flash_version = v
				self.state.updateServerInfo({ flashVersion: v })
				if (typeof self.setVariableValues === 'function') self.setVariableValues({ flash_version: self.variables.flash_version })
			})
			self.enqueue('VERSION TEMPLATEHOST', null, 'VERSION', (line) => {
				const v = responseToStr(line)
				if (self.variables) self.variables.templatehost_version = v
				self.state.updateServerInfo({ templateHostVersion: v })
				if (typeof self.setVariableValues === 'function')
					self.setVariableValues({ templatehost_version: self.variables.templatehost_version })
			})
			self.enqueue('INFO', null, 'INFO', (lines) => {
				const arr = Array.isArray(lines) ? lines : lines ? [String(lines)] : []
				if (self.variables) self.variables.channel_list = arr.join(' | ')
				self.gatheredInfo.channelIds = []
				arr.forEach((line) => {
					const m = String(line).trim().match(/^(\d+)\s+/)
					if (m) {
						const ch = parseInt(m[1], 10)
						if (!self.gatheredInfo.channelIds.includes(ch)) self.gatheredInfo.channelIds.push(ch)
						self.gatheredInfo.channelStatusLines[ch] = String(line).trim()
					}
				})
				if (typeof self.setVariableValues === 'function') self.setVariableValues({ channel_list: self.variables.channel_list })
				self.enqueue('INFO PATHS', null, 'INFO', (d) => {
					self.gatheredInfo.infoPaths = responseToStr(d)
					self.state.updateServerInfo({ paths: responseToStr(d) })
					if (self.variables) self.variables.info_paths = self.gatheredInfo.infoPaths
					if (typeof self.setVariableValues === 'function') self.setVariableValues({ info_paths: self.variables.info_paths })
				})
				self.enqueue('INFO SYSTEM', null, 'INFO', (d) => {
					self.gatheredInfo.infoSystem = responseToStr(d)
					self.state.updateServerInfo({ system: responseToStr(d) })
					if (self.variables) self.variables.info_system = self.gatheredInfo.infoSystem
					if (typeof self.setVariableValues === 'function') self.setVariableValues({ info_system: self.variables.info_system })
				})
				self.enqueue('INFO CONFIG', null, 'INFO', (d) => {
					self.gatheredInfo.infoConfig = responseToStr(d)
					self.state.updateServerInfo({ config: responseToStr(d) })
					if (self.variables) self.variables.info_config = self.gatheredInfo.infoConfig
					if (typeof self.setVariableValues === 'function') self.setVariableValues({ info_config: self.variables.info_config })
					if (typeof self.summarizeConsumersFromConfig === 'function' && self.gatheredInfo.infoConfig) {
						self.summarizeConsumersFromConfig(self.gatheredInfo.infoConfig, (summary) => {
							if (self.variables) self.variables.server_consumers_summary = summary
							if (typeof self.setVariableValues === 'function')
								self.setVariableValues({ server_consumers_summary: summary })
						})
					}
					if (typeof self.parseInfoConfigForDecklinks === 'function') {
						self.parseInfoConfigForDecklinks(self.gatheredInfo.infoConfig, (dl) => {
							self.gatheredInfo.decklinkFromConfig = dl || {}
						})
					}
					const tpMatch = self.gatheredInfo.infoConfig.match(/<template-path>\s*(.*?)\s*<\/template-path>/i)
					if (tpMatch?.[1]) self._resolvedTemplatePath = tpMatch[1].replace(/[\\/]+$/, '')
					try {
						if (typeof self.refreshConfigComparison === 'function') self.refreshConfigComparison(self)
					} catch (e) {
						if (typeof self.log === 'function') self.log('debug', 'configComparison: ' + (e?.message || e))
					}
					if (self.gatheredInfo.channelIds.length === 0) {
						finishConnectionGather(self)
					}
				})
				const ids = self.gatheredInfo.channelIds
				ids.forEach((ch, idx) => {
					const isLast = idx === ids.length - 1
					self.enqueue('INFO', String(ch), 'INFO', (xmlLine) => {
						const xmlStr = typeof xmlLine === 'string' ? xmlLine : responseToStr(xmlLine)
						self.gatheredInfo.channelXml[String(ch)] = xmlStr
						self.state.updateFromInfo(ch, xmlStr)
						if (typeof self.updateChannelVariablesFromXml === 'function') self.updateChannelVariablesFromXml(ch, xmlStr)
						else updateChannelVariablesFromXml(self, ch, xmlStr)
						if (isLast) finishConnectionGather(self)
					})
				})
			})
			self.runCommandQueue()
		})
		self.runCommandQueue()
	})
	self.runCommandQueue()
}

/**
 * @param {object} self
 */
function finishConnectionGather(self) {
	if (typeof self.updateDynamicVariables === 'function') self.updateDynamicVariables(self)
	if (typeof self.updateDynamicPresets === 'function') self.updateDynamicPresets(self)
	if (typeof self.clearVariablePollTimers === 'function') self.clearVariablePollTimers(self)
	if (typeof self.checkFeedbacks === 'function') self.checkFeedbacks('program_tally', 'preview_tally')
	const p = typeof self.setupAllRouting === 'function' ? self.setupAllRouting(self) : Promise.resolve()
	p.catch((e) => {
		if (typeof self.log === 'function') self.log('warn', 'Routing setup: ' + (e?.message || e))
	})
	const r =
		typeof self.reconcileAfterInfoGather === 'function' ? self.reconcileAfterInfoGather(self) : Promise.resolve()
	r.catch((e) => {
		if (typeof self.log === 'function') self.log('debug', 'Live scene reconcile: ' + (e?.message || e))
	})
	// Seed the channel×layer playback matrix from the INFO XML gathered on connect, so
	// teardown targeting knows what actually plays even across service restarts.
	require('../state/playback-tracker')
		.reconcilePlaybackMatrixFromGatheredXml(self)
		.catch((e) => {
			if (typeof self.log === 'function') self.log('debug', 'Playback matrix seed: ' + (e?.message || e))
		})
	if (typeof self.startPeriodicSync === 'function') self.startPeriodicSync(self)
	broadcastWsStateSnapshot(self)
}

/**
 * @param {object} ctx
 * @param {number|string} ch
 * @param {string} xmlStr
 */
function updateChannelVariablesFromXml(ctx, ch, xmlStr) {
	if (!xmlStr) return
	const key = String(ch)
	if (_channelXmlForVariables.get(key) === xmlStr) return
	_channelXmlForVariables.set(key, xmlStr)
	const xmlOpts = getInfoXml2jsOptions()
	parseString(xmlStr, xmlOpts, (err, result) => {
		if (err) return
		try {
			const { framerate: chFr, layers: parsedLayers } = extractChannelInfoFromParsed(result)
			const layerData = {}
			for (let layerIdx = 0; layerIdx < parsedLayers.length; layerIdx++) {
				const entry = parsedLayers[layerIdx]
				if (!entry) continue
				const frForVars = chFr || entry.fgFps || ''
				const { fgFps: _f, ...layer } = entry
				layerData[String(layerIdx)] = {
					framerate: frForVars,
					fgClip: layer.fgClip || '',
					fgState: layer.fgState || 'empty',
					bgClip: layer.bgClip || '',
					durationSec: layer.durationSec,
					timeSec: layer.timeSec,
					remainingSec: layer.remainingSec,
				}
				// WO-252: Inject INFO timing supplement into oscState for layers missing OSC duration.
				// The real layer number comes from the parsedLayers array index (layerIdx).
				if (ctx.oscState?.applyInfoTimingSupplement && Number.isFinite(layerIdx)) {
					const durationSec = layer.durationSec ? parseFloat(layer.durationSec) : undefined
					const timeSec = layer.timeSec ? parseFloat(layer.timeSec) : undefined
					if (Number.isFinite(durationSec) || Number.isFinite(timeSec)) {
						ctx.oscState.applyInfoTimingSupplement(parseInt(ch, 10), layerIdx, {
							durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
							timeSec: Number.isFinite(timeSec) ? timeSec : undefined,
						})
					}
				}
			}
			if (!ctx.variables) ctx.variables = {}
			Object.keys(layerData).forEach((layerIdx) => {
				const d = layerData[layerIdx]
				ctx.variables[`channel_${ch}_layer_${layerIdx}_fg_clip`] = d.fgClip || ''
				ctx.variables[`channel_${ch}_layer_${layerIdx}_state`] = d.fgState || 'empty'
				ctx.variables[`channel_${ch}_layer_${layerIdx}_bg_clip`] = d.bgClip || ''
				ctx.variables[`channel_${ch}_framerate`] = d.framerate || ctx.variables[`channel_${ch}_framerate`] || ''
				ctx.variables[`channel_${ch}_layer_${layerIdx}_duration_sec`] =
					d.durationSec !== undefined && d.durationSec !== null ? String(d.durationSec) : ''
				ctx.variables[`channel_${ch}_layer_${layerIdx}_time_sec`] =
					d.timeSec !== undefined && d.timeSec !== null ? String(d.timeSec) : ''
				ctx.variables[`channel_${ch}_layer_${layerIdx}_remaining_sec`] =
					d.remainingSec !== undefined && d.remainingSec !== null ? String(d.remainingSec) : ''
			})
			if (typeof ctx.setVariableValues === 'function') ctx.setVariableValues(ctx.variables)
			if (typeof ctx.checkFeedbacks === 'function') ctx.checkFeedbacks('program_tally', 'preview_tally')
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			if (typeof ctx.log === 'function') ctx.log('debug', 'Parse INFO XML: ' + msg)
		}
	})
}

module.exports = {
	responseToStr,
	attachEnqueueQueue,
	bindAppCtxAmcpTransport,
	runMediaLibraryQueryCycle,
	runConnectionQueryCycle,
	updateChannelVariablesFromXml,
}
