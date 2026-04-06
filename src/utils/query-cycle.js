/**
 * AMCP query chains after connect (CLS → CINF → TLS → VERSION/INFO…).
 * Decoupled from Companion — pass an **app context** `ctx` with socket, response_callback, state, etc.
 * @see companion-module-casparcg-server/src/instance.js
 */

'use strict'

const { parseString } = require('xml2js')
const handlers = require('./handlers')

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
			ctx.socket.send(fullCommand + '\r\n')
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
		self.state.updateFromCLS(data)
		const queryCinf = self.config && self.config.query_cinf !== false
		const maxCinf = Math.max(0, parseInt(String(self.config?.max_cinf ?? 100), 10))
		if (queryCinf && maxCinf > 0) {
			const files = self.CHOICES_MEDIAFILES.slice(0, maxCinf)
			files.forEach((choice) => {
				const filename = choice.id || choice.label
				if (!filename || String(filename).match(/^\d+-/)) return
				const cinfParam = filename.indexOf(' ') >= 0 ? '"' + String(filename).replace(/"/g, '\\"') + '"' : filename
				self.enqueue('CINF', cinfParam, 'CINF', (cinfData) => {
					self.mediaDetails[filename] = responseToStr(cinfData)
				})
			})
		}
		self.enqueue('TLS', null, 'TLS', (data) => {
			if (self.state && self.mediaDetails) self.state.updateMediaDetails(self.mediaDetails)
			handlers.handleTLS(self, data)
			self.state.updateFromTLS(data)
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
		self.state.updateFromCLS(data)
		const queryCinf = self.config && self.config.query_cinf !== false
		const maxCinf = Math.max(0, parseInt(String(self.config?.max_cinf ?? 100), 10))
		if (queryCinf && maxCinf > 0) {
			const files = self.CHOICES_MEDIAFILES.slice(0, maxCinf)
			files.forEach((choice) => {
				const filename = choice.id || choice.label
				if (!filename || String(filename).match(/^\d+-/)) return
				const cinfParam = filename.indexOf(' ') >= 0 ? '"' + String(filename).replace(/"/g, '\\"') + '"' : filename
				self.enqueue('CINF', cinfParam, 'CINF', (cinfData) => {
					self.mediaDetails[filename] = responseToStr(cinfData)
				})
			})
		}
		self.enqueue('TLS', null, 'TLS', (data) => {
			if (self.state && self.mediaDetails) self.state.updateMediaDetails(self.mediaDetails)
			handlers.handleTLS(self, data)
			self.state.updateFromTLS(data)
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
	if (typeof self.startPeriodicSync === 'function') self.startPeriodicSync(self)
}

/**
 * @param {object} ctx
 * @param {number|string} ch
 * @param {string} xmlStr
 */
function updateChannelVariablesFromXml(ctx, ch, xmlStr) {
	if (!xmlStr) return
	parseString(xmlStr, (err, result) => {
		if (err) return
		try {
			let framerate = ''
			const layerData = {}
			if (result.channel && result.channel.framerate && result.channel.framerate[0])
				framerate = result.channel.framerate[0]
			if (result.channel && result.channel.stage && result.channel.stage[0] && result.channel.stage[0].layer && result.channel.stage[0].layer[0]) {
				const layers = result.channel.stage[0].layer[0]
				Object.keys(layers).forEach((key) => {
					if (key.startsWith('layer_') && Array.isArray(layers[key]) && layers[key][0]) {
						const layerIdx = key.replace('layer_', '')
						const fg = layers[key][0].foreground && layers[key][0].foreground[0]
						const bg = layers[key][0].background && layers[key][0].background[0]
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
						if (bg && bg.producer && bg.producer[0])
							bgClip = bg.producer[0].$ && bg.producer[0].$.name ? bg.producer[0].$.name : ''
						const fpsNum = parseInt(framerate, 10) || 1
						const durationSec = nbFrames > 0 ? (nbFrames / fpsNum).toFixed(2) : ''
						const timeSec = nbFrames > 0 && currentFrame >= 0 ? (currentFrame / fpsNum).toFixed(2) : ''
						const remainingSec = nbFrames > 0 && currentFrame >= 0 ? ((nbFrames - currentFrame) / fpsNum).toFixed(2) : ''
						layerData[layerIdx] = { framerate, fgClip, fgState, bgClip, durationSec, timeSec, remainingSec }
					}
				})
			}
			if (result.layer && result.layer.foreground && result.layer.foreground[0]) {
				const p = result.layer.foreground[0].producer && result.layer.foreground[0].producer[0]
				if (p) {
					const fr = p.fps && p.fps[0] ? p.fps[0] : ''
					const nb = parseInt(p['nb-frames'] && p['nb-frames'][0], 10) || 0
					const cur = parseInt(p.frame && p.frame[0], 10) || 0
					const fpsNum = parseInt(fr, 10) || 1
					layerData['0'] = {
						framerate: fr,
						fgClip: p.$ && p.$.name ? p.$.name : p.name && p.name[0] ? p.name[0] : '',
						fgState: result.layer.foreground[0].paused && result.layer.foreground[0].paused[0] === 'true' ? 'paused' : 'playing',
						bgClip: '',
						durationSec: nb > 0 ? (nb / fpsNum).toFixed(2) : '',
						timeSec: nb > 0 && cur >= 0 ? (cur / fpsNum).toFixed(2) : '',
						remainingSec: nb > 0 && cur >= 0 ? ((nb - cur) / fpsNum).toFixed(2) : '',
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
	runMediaLibraryQueryCycle,
	runConnectionQueryCycle,
	updateChannelVariablesFromXml,
}
