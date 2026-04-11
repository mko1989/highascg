'use strict'

const fs = require('fs')
const path = require('path')
const { Worker } = require('worker_threads')
const { execSync, spawn } = require('child_process')
const { DmxOutput } = require('./dmx-output')
const { buildChannelMap } = require('../config/channel-map-from-ctx')
const { param } = require('../caspar/amcp-utils')
const { resolveCaptureTier } = require('../streaming/go2rtc-manager')
const {
	buildFfmpegArgs,
	casparUdpStreamUri,
	casparUdpStreamUriVariantsForRemove,
	amcpInfoText,
	truncate,
} = require('../streaming/caspar-ffmpeg-setup')

/** Dedicated Caspar consumer slot — avoids clobbering `ADD 1 STREAM` (preview) on the same channel. */
const DMX_FILE_CONSUMER_INDEX = 97
/** Caspar MPEG-TS duplicate stream port offset (per channel: base + 50 + ch). Avoids go2rtc PGM/MV ports. */
const DMX_UDP_PORT_OFFSET = 50

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

class SamplingManager {
	constructor(appCtx) {
		this.appCtx = appCtx
		this.log = appCtx.log
		this.worker = null
		this.dmxOutput = new DmxOutput(appCtx.log)
		
		this.channels = new Map() // Key: channelNumber, Value: { readStream, fifoPath, buffer, scaledW, scaledH, frameSize, workerScale }
		/** @type {Map<number, { fullW: number, fullH: number, scale: number }>} */
		this._channelPlan = new Map()
		
		this.enabled = false
		this.config = null
		
		this.currentScale = 0.1
		this.width = 1920
		this.height = 1080
		this.fps = 25

		/** Log outgoing DMX payloads to app log (throttled in _handleResults). */
		this.debugLogDmx = false
		this._lastDmxDebugLogAt = 0

		/** Serialize concurrent `updateConfig` (INFO CONFIG + settings save) so stop/start never interleave. */
		this._configQueue = Promise.resolve()
		/** @type {Map<number, ReturnType<typeof setTimeout>>} */
		this._ingressWatchdogs = new Map()
		/** @type {'udp' | 'file' | undefined} */
		this._lastIngressMode = undefined
	}

	_resolutionForProgramChannel(cm, channelNum) {
		const def = { w: 1920, h: 1080 }
		if (!cm) return def
		const pcs = cm.programChannels || []
		const chNum = Number(channelNum)
		const idx = pcs.findIndex((c) => Number(c) === chNum)
		if (idx >= 0) {
			const pr = cm.programResolutions?.[idx]
			if (pr?.w > 0 && pr?.h > 0) return { w: pr.w, h: pr.h }
		}
		const byCh =
			cm.channelResolutionsByChannel?.[String(chNum)] ??
			cm.channelResolutionsByChannel?.[chNum]
		if (byCh?.w > 0 && byCh?.h > 0) return { w: byCh.w, h: byCh.h }
		return def
	}

	_planChannels(cm, fixtures) {
		const channelsSet = new Set()
		for (const f of fixtures) {
			channelsSet.add(Number(f.sourceChannel) || 1)
		}
		const plan = new Map()
		for (const ch of channelsSet) {
			const { w: fullW, h: fullH } = this._resolutionForProgramChannel(cm, ch)
			let maxRows = 1
			let maxCols = 1
			for (const f of fixtures) {
				if ((Number(f.sourceChannel) || 1) !== ch) continue
				if (f.grid) {
					maxRows = Math.max(maxRows, f.grid.rows || 1)
					maxCols = Math.max(maxCols, f.grid.cols || 1)
				}
			}
			const minScaleH = maxRows / fullH
			const minScaleW = maxCols / fullW
			const safetyMargin = 2.0
			let targetScale = Math.max(minScaleH, minScaleW) * safetyMargin
			targetScale = Math.max(targetScale, 0.1)
			targetScale = Math.min(targetScale, 0.5)
			plan.set(ch, { fullW, fullH, scale: targetScale })
		}
		return plan
	}

	_serializePlan(plan) {
		return JSON.stringify(
			[...plan.entries()]
				.sort((a, b) => a[0] - b[0])
				.map(([ch, p]) => [ch, p.fullW, p.fullH, p.scale])
		)
	}

	updateConfig(dmxConfig) {
		const next = this._configQueue.then(() => this._updateConfigImpl(dmxConfig))
		// Keep the chain alive even if this step fails (caller may still await `next`).
		this._configQueue = next.catch(() => {})
		return next
	}

	async _updateConfigImpl(dmxConfig) {
		const wasEnabled = this.enabled
		this.config = dmxConfig
		this.enabled = !!(dmxConfig && dmxConfig.enabled)
		this.debugLogDmx = !!(dmxConfig && dmxConfig.debugLogDmx)

		if (this.enabled) {
			const { needsRestart, channelsToSample } = this._analyzeConfig()
			if (needsRestart || !wasEnabled) {
				await this.stop()
				await this.start(channelsToSample)
			}
		} else if (wasEnabled) {
			await this.stop()
		}
	}

	_analyzeConfig() {
		if (!this.config || !this.config.fixtures || this.config.fixtures.length === 0) {
			this._channelPlan = new Map()
			return { needsRestart: false, channelsToSample: [] }
		}

		let cm = null
		try {
			cm = buildChannelMap(this.appCtx)
		} catch (e) {
			this.log('warn', '[DMX] buildChannelMap failed: ' + (e?.message || e))
		}

		const newPlan = this._planChannels(cm, this.config.fixtures)
		const planChanged = this._serializePlan(newPlan) !== this._serializePlan(this._channelPlan)
		this._channelPlan = newPlan

		const firstCh = [...newPlan.keys()][0]
		if (firstCh != null) {
			const p = newPlan.get(firstCh)
			this.width = p.fullW
			this.height = p.fullH
			this.currentScale = p.scale
		}

		this.fps = this.config.fps || 25

		const channelsToSample = Array.from(newPlan.keys())
		const channelsChanged =
			channelsToSample.length !== this.channels.size ||
			channelsToSample.some((ch) => !this.channels.has(ch))

		const ingressNow = this._ingressModeKey()
		const ingressChanged =
			this._lastIngressMode != null && ingressNow !== this._lastIngressMode
		this._lastIngressMode = ingressNow

		return {
			needsRestart: planChanged || channelsChanged || ingressChanged,
			channelsToSample,
		}
	}

	_ingressModeKey() {
		return this._useUdpIngress() ? 'udp' : 'file'
	}

	/**
	 * UDP: Caspar `ADD … STREAM` MPEG-TS to a dedicated port + Node ffmpeg decodes to raw RGB (reliable on builds where FILE→FIFO never writes).
	 * FILE: Caspar FILE consumer → FIFO (set HIGHASCG_DMX_INPUT=file or dmx.inputMode=file).
	 */
	_useUdpIngress() {
		const cfg = this.appCtx.config || {}
		const dm = this.config || {}
		const st = cfg.streaming || {}
		const tier = resolveCaptureTier(st.captureMode || 'udp', cfg.caspar?.host || '127.0.0.1')
		const env = String(process.env.HIGHASCG_DMX_INPUT || '').trim().toLowerCase()
		if (env === 'file') return false
		if (env === 'udp') {
			if (tier !== 'udp') {
				this.log('warn', `[DMX] HIGHASCG_DMX_INPUT=udp but capture tier is ${tier} — using FILE`)
				return false
			}
			return true
		}
		const mode = String(dm.inputMode || '').trim().toLowerCase()
		if (mode === 'file') return false
		if (mode === 'udp') {
			if (tier !== 'udp') {
				this.log('warn', `[DMX] dmx.inputMode=udp but capture tier is ${tier} — using FILE`)
				return false
			}
			return true
		}
		return tier === 'udp'
	}

	_dmxUdpPortForChannel(ch) {
		const base =
			this.appCtx.config?.streaming?._effectiveBasePort ??
			this.appCtx.config?.streaming?.basePort ??
			40000
		return base + DMX_UDP_PORT_OFFSET + Number(ch)
	}

	_ffmpegBinary() {
		return this.appCtx.config?.streaming?.ffmpeg_path || process.env.FFMPEG_PATH || 'ffmpeg'
	}

	_clearIngressWatchdog(ch) {
		const t = this._ingressWatchdogs.get(ch)
		if (t) clearTimeout(t)
		this._ingressWatchdogs.delete(ch)
	}

	_armIngressWatchdog(ch, channelData) {
		this._clearIngressWatchdog(ch)
		const t = setTimeout(() => {
			if (!channelData._loggedFirstFifoByte) {
				const hint =
					channelData._inputMode === 'udp'
						? `udp port ${channelData.udpPort}, Caspar STREAM, local ffmpeg`
						: 'FILE consumer, FIFO'
				this.log('warn', `[DMX] Channel ${ch}: no pixel data after 5s (${hint})`)
			}
		}, 5000)
		this._ingressWatchdogs.set(ch, t)
	}

	async _addDmxUdpStream(ch, port) {
		const amcp = this.appCtx.amcp
		if (!amcp?.isConnected) return
		const cfg = this.appCtx.configManager?.get?.() ?? this.appCtx.config
		const streamCfg = { ...(cfg.streaming || {}), fps: this.fps }
		const ffmpegArgs = buildFfmpegArgs(streamCfg)
		const uri = casparUdpStreamUri(port)
		for (const u of casparUdpStreamUriVariantsForRemove(port)) {
			try {
				await amcp.raw(`REMOVE ${ch} STREAM ${u}`)
			} catch {
				/* ok */
			}
		}
		await delay(150)
		const cmd = `ADD ${ch} STREAM ${uri} ${ffmpegArgs}`
		try {
			const res = await amcp.raw(cmd)
			this.log(
				'info',
				`[DMX] CasparCG ch${ch} STREAM ${uri} (DMX) AMCP: ${truncate(amcpInfoText(res), 120)}`
			)
		} catch (e) {
			this.log('error', `[DMX] ADD STREAM ch${ch} failed: ${e.message}`)
		}
	}

	async _removeDmxUdpStream(ch, port) {
		const amcp = this.appCtx.amcp
		if (!amcp?.isConnected) return
		for (const u of casparUdpStreamUriVariantsForRemove(port)) {
			try {
				await amcp.raw(`REMOVE ${ch} STREAM ${u}`)
			} catch (e) {
				this.log('debug', `[DMX] REMOVE STREAM ch${ch} (ok if none): ${e.message}`)
			}
		}
	}

	_spawnFfmpegUdpReader(ch, port, scaledW, scaledH, channelData) {
		const bin = this._ffmpegBinary()
		const input = `udp://0.0.0.0:${port}?overrun_nonfatal=1`
		const args = [
			'-hide_banner',
			'-loglevel',
			'warning',
			'-fflags',
			'nobuffer',
			'-flags',
			'low_delay',
			'-i',
			input,
			'-an',
			'-vf',
			`scale=${scaledW}:${scaledH}:flags=area,format=rgb24`,
			'-f',
			'rawvideo',
			'-pix_fmt',
			'rgb24',
			'-r',
			String(this.fps),
			'-',
		]
		const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
		channelData.udpFfmpegProc = proc
		proc.stderr?.on('data', (buf) => {
			const s = buf.toString().trim()
			if (s) this.log('warn', `[DMX] ffmpeg ch${ch}: ${truncate(s, 220)}`)
		})
		proc.on('error', (err) => {
			this.log('error', `[DMX] ffmpeg ch${ch} spawn failed: ${err.message}`)
		})
		proc.on('exit', (code, sig) => {
			if (code !== 0 && code != null) {
				this.log('warn', `[DMX] ffmpeg ch${ch} exited code=${code} sig=${sig || ''}`)
			}
		})

		proc.stdout.on('data', (chunk) => {
			if (!channelData._loggedFirstFifoByte && chunk && chunk.length > 0) {
				channelData._loggedFirstFifoByte = true
				this.log(
					'info',
					`[DMX] Channel ${ch}: receiving pixel data (${chunk.length} bytes first chunk)`
				)
			}
			channelData.buffer = Buffer.concat([channelData.buffer, chunk])
			while (channelData.buffer.length >= channelData.frameSize) {
				const frame = channelData.buffer.subarray(0, channelData.frameSize)
				channelData.buffer = channelData.buffer.subarray(channelData.frameSize)
				this._processFrame(frame, ch, scaledW, scaledH, channelData.workerScale)
			}
		})
	}

	async start(channelsToSample) {
		if (!this.enabled) return

		const useUdp = this._useUdpIngress()
		this.log(
			'info',
			useUdp
				? `[DMX] Ingress MPEG-TS UDP (Caspar STREAM + local ffmpeg) @ ${this.fps} fps — channels: ${channelsToSample.join(', ')}`
				: `[DMX] Ingress FILE→FIFO (raw RGB) @ ${this.fps} fps — channels: ${channelsToSample.join(', ')}`
		)

		this._startWorker()

		const appRoot = path.join(__dirname, '..', '..')
		for (const ch of channelsToSample) {
			const plan = this._channelPlan.get(ch)
			if (!plan) continue

			const scaledW = Math.round(plan.fullW * plan.scale)
			const scaledH = Math.round(plan.fullH * plan.scale)
			this.log(
				'info',
				`[DMX] Channel ${ch}: ${plan.fullW}x${plan.fullH} PGM @ ${Math.round(plan.scale * 100)}% → ${scaledW}x${scaledH} buffer`
			)

			const frameSize = scaledW * scaledH * 3

			if (useUdp) {
				const udpPort = this._dmxUdpPortForChannel(ch)
				const channelData = {
					ch,
					_inputMode: 'udp',
					udpPort,
					fifoPath: null,
					readStream: null,
					buffer: Buffer.alloc(0),
					scaledW,
					scaledH,
					frameSize,
					workerScale: plan.scale,
					_loggedFirstFifoByte: false,
					consumerIndex: DMX_FILE_CONSUMER_INDEX,
				}
				this.channels.set(ch, channelData)
				this._spawnFfmpegUdpReader(ch, udpPort, scaledW, scaledH, channelData)
				this._armIngressWatchdog(ch, channelData)
				await delay(250)
				await this._addDmxUdpStream(ch, udpPort)
				continue
			}

			const fifoPath = path.join(appRoot, `.sampling.${ch}.pipe`)
			this._ensureFifo(fifoPath)

			const readStream = fs.createReadStream(fifoPath)
			const channelData = {
				ch,
				_inputMode: 'file',
				fifoPath,
				readStream,
				buffer: Buffer.alloc(0),
				scaledW,
				scaledH,
				frameSize,
				workerScale: plan.scale,
				_loggedFirstFifoByte: false,
			}

			readStream.on('data', (chunk) => {
				if (!channelData._loggedFirstFifoByte && chunk && chunk.length > 0) {
					channelData._loggedFirstFifoByte = true
					this.log(
						'info',
						`[DMX] Channel ${ch}: receiving pixel data (${chunk.length} bytes first chunk)`
					)
				}
				channelData.buffer = Buffer.concat([channelData.buffer, chunk])
				while (channelData.buffer.length >= channelData.frameSize) {
					const frame = channelData.buffer.subarray(0, channelData.frameSize)
					channelData.buffer = channelData.buffer.subarray(channelData.frameSize)
					this._processFrame(frame, ch, scaledW, scaledH, channelData.workerScale)
				}
			})

			readStream.on('error', (err) => {
				this.log('error', `[DMX] Channel ${ch} FIFO read error: ${err.message}`)
			})

			channelData.consumerIndex = DMX_FILE_CONSUMER_INDEX
			this.channels.set(ch, channelData)
			this._armIngressWatchdog(ch, channelData)
			await this._addCasparConsumer(ch, fifoPath, scaledW, scaledH)
		}
	}

	async stop() {
		this.log('info', '[DMX] Stopping sampling...')

		for (const [ch, data] of this.channels) {
			this._clearIngressWatchdog(ch)
			if (data._inputMode === 'udp') {
				if (data.udpFfmpegProc) {
					try {
						data.udpFfmpegProc.kill('SIGKILL')
					} catch {
						/* ignore */
					}
				}
				await this._removeDmxUdpStream(ch, data.udpPort)
			} else {
				await this._removeCasparConsumer(ch, data.consumerIndex)
			}
			if (data.readStream) data.readStream.destroy()
		}
		this.channels.clear()
		
		if (this.worker) {
			this.worker.terminate()
			this.worker = null
		}
		
		this.dmxOutput.stop()
	}

	_ensureFifo(fifoPath) {
		if (fs.existsSync(fifoPath)) {
			// Check if it's actually a FIFO
			try {
				const stats = fs.statSync(fifoPath)
				if (stats.isFIFO()) return
				// If it's a regular file or dir, remove it so we can create a FIFO
				fs.rmSync(fifoPath, { recursive: true, force: true })
			} catch (e) {
				this.log('error', `[DMX] Stat failed for ${fifoPath}: ${e.message}`)
			}
		}

		try {
			execSync(`mkfifo "${fifoPath}"`)
		} catch (e) {
			this.log('error', `[DMX] mkfifo failed for ${fifoPath}: ${e.message}`)
			// If mkfifo fails (e.g. on Windows or permission issue), we might still try to use it if it exists
			if (!fs.existsSync(fifoPath)) {
				throw new Error(`Critical: Could not create FIFO pipe at ${fifoPath}`)
			}
		}
	}

	_startWorker() {
		const workerPath = path.join(__dirname, 'sampling-worker.js')
		this.worker = new Worker(workerPath)
		
		this.worker.on('message', (msg) => {
			if (msg.type === 'results') {
				this._handleResults(msg.payload)
			}
		})
		
		this.worker.on('error', (err) => {
			this.log('error', `[DMX] Worker error: ${err.message}`)
		})
	}

	_processFrame(frame, channel, width, height, workerScale) {
		if (!this.worker) return

		// Filter fixtures for this channel
		const fixturesForChannel = this.config.fixtures.filter(
			(f) => (Number(f.sourceChannel) || 1) === channel
		)
		if (fixturesForChannel.length === 0) return

		// Worker processes messages serially; do not gate with a global flag — that dropped almost
		// every frame when the next FIFO chunk arrived before the previous worker reply.

		this.worker.postMessage({
			type: 'process',
			payload: {
				frame,
				fixtures: fixturesForChannel,
				width,
				height,
				scale: workerScale
			}
		})
	}

	_handleResults(results) {
		// Send DMX
		for (const res of results) {
			const fixture = this.config.fixtures.find(f => f.id === res.id)
			if (fixture) {
				try {
					this.dmxOutput.send(fixture, res.data)
				} catch (e) {
					this.log('error', `[DMX] Output send failed (${fixture?.id}): ${e?.message || e}`)
				}
			}
		}

		if (this.debugLogDmx && results.length > 0) {
			const now = Date.now()
			if (!this._lastDmxDebugLogAt || now - this._lastDmxDebugLogAt >= 1000) {
				this._lastDmxDebugLogAt = now
				const parts = []
				for (const res of results) {
					const fixture = this.config.fixtures.find((f) => f.id === res.id)
					const d = res.data || []
					const preview =
						d.length <= 48 ? d.join(',') : `${d.slice(0, 48).join(',')}… (${d.length} values)`
					const proto = fixture?.protocol || 'artnet'
					const dest = fixture?.destination ?? ''
					const uni = fixture?.universe ?? '?'
					const start = fixture?.startChannel ?? '?'
					parts.push(
						`${res.id} ${proto}→${dest} u${uni}@${start}: [${preview}]`
					)
				}
				this.log('info', `[DMX] debug: ${parts.join(' | ')}`)
			}
		}

		// Broadcast for UI Live Preview
		if (typeof this.appCtx._wsBroadcast === 'function') {
			this.appCtx._wsBroadcast('dmx:colors', results.map(r => ({
				id: r.id,
				data: r.data
			})))
		}
	}

	async _addCasparConsumer(ch, fifoPath, sw, sh) {
		if (!this.appCtx.amcp || !this.appCtx.amcp.isConnected) return
		/**
		 * Caspar’s ffmpeg consumer maps `-f` to the wrong key — output format is never set and FFmpeg
		 * errors on pipe paths (“Unable to choose an output format”). Use `-format rawvideo` like
		 * `caspar-ffmpeg-setup.js` does for STREAM. Use `-filter:v` (not `-vf`) so the scale chain is applied.
		 * @see caspar-ffmpeg-setup.js
		 */
		const paramsAfterPath = [
			param(fifoPath),
			'-filter:v',
			param(`scale=${sw}:${sh}:flags=area,format=rgb24`),
			'-pix_fmt:v',
			'rgb24',
			'-format',
			'rawvideo',
			'-r:v',
			String(this.fps),
		].join(' ')
		try {
			if (this.appCtx.amcp.basic && typeof this.appCtx.amcp.basic.add === 'function') {
				await this.appCtx.amcp.basic.add(ch, 'FILE', paramsAfterPath, DMX_FILE_CONSUMER_INDEX)
			} else {
				const cmd = `ADD ${ch}-${DMX_FILE_CONSUMER_INDEX} FILE ${paramsAfterPath}`
				await this.appCtx.amcp.raw(cmd)
			}
			this.log(
				'info',
				`[DMX] CasparCG ch${ch}-${DMX_FILE_CONSUMER_INDEX} FILE consumer (raw RGB → FIFO)`
			)
		} catch (e) {
			this.log('error', `[DMX] Failed to add CasparCG ch${ch} FILE consumer: ${e.message}`)
		}
	}

	async _removeCasparConsumer(ch, consumerIndex) {
		if (!this.appCtx.amcp || !this.appCtx.amcp.isConnected) return
		try {
			if (this.appCtx.amcp.basic && typeof this.appCtx.amcp.basic.remove === 'function') {
				await this.appCtx.amcp.basic.remove(ch, null, consumerIndex)
			} else {
				await this.appCtx.amcp.raw(`REMOVE ${ch}-${consumerIndex}`)
			}
		} catch (e) {
			this.log('debug', `[DMX] REMOVE ch${ch}-${consumerIndex} (ok if none): ${e.message}`)
		}
	}
}

module.exports = { SamplingManager }
