'use strict'

const fs = require('fs')
const { execSync, spawn } = require('child_process')
const { param } = require('../caspar/amcp-utils')
const { resolveCaptureTier } = require('../streaming/go2rtc-manager')
const {
	buildFfmpegArgs,
	casparUdpStreamUri,
	casparUdpStreamUriVariantsForRemove,
	getActiveStreamUris,
	amcpInfoText,
	truncate,
} = require('../streaming/caspar-ffmpeg-setup')

/** Dedicated Caspar consumer slot — avoids clobbering `ADD 1 STREAM` (preview) on the same channel. */
const DMX_FILE_CONSUMER_INDEX = 97
/** Caspar MPEG-TS duplicate stream port offset (per channel: base + 50 + ch). Avoids go2rtc PGM/MV ports. */
const DMX_UDP_PORT_OFFSET = 50

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const ingressMethods = {
	_ingressModeKey() {
		return this._useUdpIngress() ? 'udp' : 'file'
	},

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
	},

	_dmxUdpPortForChannel(ch) {
		const base =
			this.appCtx.config?.streaming?._effectiveBasePort ??
			this.appCtx.config?.streaming?.basePort ??
			40000
		return base + DMX_UDP_PORT_OFFSET + Number(ch)
	},

	_ffmpegBinary() {
		return this.appCtx.config?.streaming?.ffmpeg_path || process.env.FFMPEG_PATH || 'ffmpeg'
	},

	_clearIngressWatchdog(ch) {
		const t = this._ingressWatchdogs.get(ch)
		if (t) clearTimeout(t)
		this._ingressWatchdogs.delete(ch)
	},

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
	},

	async _addDmxUdpStream(ch, port) {
		const amcp = this.appCtx.amcp
		if (!amcp?.isConnected) return
		const cfg = this.appCtx.configManager?.get?.() ?? this.appCtx.config
		const streamCfg = { ...(cfg.streaming || {}), fps: this.fps }
		const ffmpegArgs = buildFfmpegArgs(streamCfg)
		const uri = casparUdpStreamUri(port)
		const active = await getActiveStreamUris(amcp, ch)
		const variants = casparUdpStreamUriVariantsForRemove(port)
		for (const u of active) {
			if (variants.includes(u) || u.includes(`:${port}`)) {
				try {
					await amcp.raw(`REMOVE ${ch} STREAM ${u}`)
				} catch {
					/* ok */
				}
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
	},

	async _removeDmxUdpStream(ch, port) {
		const amcp = this.appCtx.amcp
		if (!amcp?.isConnected) return
		const active = await getActiveStreamUris(amcp, ch)
		const variants = casparUdpStreamUriVariantsForRemove(port)
		for (const u of active) {
			if (variants.includes(u) || u.includes(`:${port}`)) {
				try {
					await amcp.raw(`REMOVE ${ch} STREAM ${u}`)
				} catch (e) {
					this.log('debug', `[DMX] REMOVE STREAM ch${ch} (ok if none): ${e.message}`)
				}
			}
		}
	},

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
	},

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
	},

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
	},

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
	},
}

module.exports = { ingressMethods, DMX_FILE_CONSUMER_INDEX, DMX_UDP_PORT_OFFSET }
