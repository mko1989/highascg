'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const go2rtcBinary = require('go2rtc-static')
const { resolveNdiSourceName, validateFfmpegNdiInput } = require('./ndi-resolve')

/**
 * Detect the effective capture mode based on environment.
 * @param {string} requestedMode - 'auto' | 'local' | 'ndi' | 'srt'
 * @param {string} casparHost
 * @returns {'local' | 'ndi' | 'srt'}
 */
function resolveCaptureTier(requestedMode, casparHost) {
	if (requestedMode === 'local') return 'local'
	if (requestedMode === 'ndi') return 'ndi'
	if (requestedMode === 'srt') return 'srt'

	// Auto-detect
	const isLocal = casparHost === '127.0.0.1' || casparHost === 'localhost' || casparHost === '0.0.0.0'
	if (isLocal) {
		// Check if kmsgrab or x11grab is available
		try {
			const out = execSync('ffmpeg -devices 2>&1 || true', { encoding: 'utf8', timeout: 3000 })
			if (out.includes('kmsgrab') || out.includes('x11grab')) {
				return 'local'
			}
		} catch { /* fallthrough */ }
	}

	// Check if NDI is available
	try {
		const out = execSync('ffmpeg -formats 2>&1 || true', { encoding: 'utf8', timeout: 3000 })
		if (out.includes('libndi')) {
			return 'ndi'
		}
	} catch { /* fallthrough */ }

	return 'srt'
}

/**
 * Detect which local capture device to use (kmsgrab preferred when `auto`, unless forced).
 * @param {{ localCaptureDevice?: string }} [config]
 * @returns {'kmsgrab' | 'x11grab'}
 */
function detectLocalCaptureDevice(config = {}) {
	const forced = config.localCaptureDevice || process.env.HIGHASCG_LOCAL_CAPTURE_DEVICE
	if (forced === 'x11grab' || forced === 'kmsgrab') return forced
	try {
		const out = execSync('ffmpeg -devices 2>&1 || true', { encoding: 'utf8', timeout: 3000 })
		if (out.includes('kmsgrab')) return 'kmsgrab'
	} catch { /* ignore */ }
	return 'x11grab'
}

/**
 * Optional verbose go2rtc logging (WebRTC / ffmpeg). Set `streaming.go2rtcLogLevel` in config or
 * env **`HIGHASCG_GO2RTC_LOG_LEVEL`** to `trace` | `debug` | `info` | `warn` | `error`.
 * @param {{ go2rtcLogLevel?: string }} config
 * @param {string[]} yamlLines
 */
function appendGo2rtcLogYaml(config, yamlLines) {
	const level = String(config.go2rtcLogLevel || process.env.HIGHASCG_GO2RTC_LOG_LEVEL || '')
		.trim()
		.toLowerCase()
	if (!level) return

	const allowed = ['trace', 'debug', 'info', 'warn', 'error']
	if (!allowed.includes(level)) {
		console.warn(`[go2rtc] Ignoring invalid go2rtcLogLevel "${level}" (use trace|debug|info|warn|error)`)
		return
	}

	yamlLines.push('')
	yamlLines.push('log:')
	yamlLines.push(`  level: ${level}`)
	if (level === 'trace' || level === 'debug') {
		yamlLines.push('  webrtc: trace')
		yamlLines.push('  exec: debug')
	}
	console.log(`[go2rtc] Verbose logging enabled (level=${level}) — from config or HIGHASCG_GO2RTC_LOG_LEVEL`)
}

class Go2rtcManager {
	constructor() {
		this.process = null
		this.isRestarting = false
		/** Bumped at the beginning of each start(); stale closes from a replaced run must not reject. */
		this._startGeneration = 0
		this.yamlPath = path.join(process.cwd(), 'go2rtc.yaml')
		this.streams = {} // map of name -> target
		this.config = null
		this.activeTier = 'srt'

		this.bindLifecycle()
	}

	bindLifecycle() {
		// Do not register SIGTERM/SIGINT here — index.js coordinates shutdown (streaming → ws → AMCP → HTTP).
		// Duplicate handlers caused go2rtc.stop() to race with AMCP REMOVE and delayed process exit.
		this._onProcessExit = () => {
			try {
				if (this.process && this.process.exitCode === null) {
					this.process.kill('SIGKILL')
				}
			} catch {
				/* ignore */
			}
		}
		process.once('exit', this._onProcessExit)
	}

	unbindLifecycle() {
		if (this._onProcessExit) {
			process.removeListener('exit', this._onProcessExit)
		}
	}

	/**
	 * Build the exec: source line for local capture (kmsgrab or x11grab).
	 */
	buildLocalSource(config) {
		const device = detectLocalCaptureDevice(config)
		const br = config.maxBitrate || 2000
		const fps = config.fps || 25
		const hw = config.hardwareAccel !== false

		const resMap = { '720p': '1280:720', '540p': '960:540', '360p': '640:360' }
		const scale = resMap[config.resolution] || ''
		const scaleFilter = scale ? `-vf scale=${scale}` : ''

		if (device === 'kmsgrab') {
			// kmsgrab: needs -device before -f kmsgrab (see ffmpeg-devices). `-i -` uses that device.
			const drm = config.drmDevice || process.env.HIGHASCG_DRM_DEVICE || '/dev/dri/card0'
			const encoder = hw ? 'h264_nvenc -preset p1 -tune ll' : 'libx264 -preset ultrafast -tune zerolatency'
			return `exec:ffmpeg -device ${drm} -framerate ${fps} -f kmsgrab -i - ${scaleFilter} -c:v ${encoder} -b:v ${br}k -g ${fps * 2} -f rtsp {output}`
		}

		// x11grab: needs DISPLAY (unset under systemd). HIGHASCG_X11_DISPLAY or config.x11Display.
		const display = config.x11Display || process.env.HIGHASCG_X11_DISPLAY || ':0'
		const encoder = hw ? 'h264_nvenc -preset p1 -tune ll' : 'libx264 -preset ultrafast -tune zerolatency'
		return `exec:env DISPLAY=${display} ffmpeg -f x11grab -framerate ${fps} -video_size 1920x1080 -i :0.0 ${scaleFilter} -c:v ${encoder} -b:v ${br}k -g ${fps * 2} -f rtsp {output}`
	}

	/**
	 * Build go2rtc's ffmpeg line to **receive** NDI from the network (Caspar already **sends** NDI natively).
	 */
	buildNdiSource(config, channelNum) {
		const ndiName = resolveNdiSourceName(config, channelNum)
		const br = config.maxBitrate || 2000
		const fps = config.fps || 25
		const hw = config.hardwareAccel !== false
		const encoder = hw ? 'h264_nvenc -preset p1 -tune ll' : 'libx264 -preset ultrafast -tune zerolatency'

		const resMap = { '720p': '1280:720', '540p': '960:540', '360p': '640:360' }
		const scale = resMap[config.resolution] || ''
		const scaleFilter = scale ? `-vf scale=${scale}` : ''

		return `exec:ffmpeg -f libndi_newtek_input -i "${ndiName}" ${scaleFilter} -c:v ${encoder} -b:v ${br}k -g ${fps * 2} -c:a aac -b:a 64k -f rtsp {output}`
	}

	/**
	 * Build MPEG-TS bridge from Caspar STREAM consumer (UDP to localhost:port).
	 * Settings UI may still say "SRT"; Caspar→go2rtc uses UDP MPEG-TS because many Caspar builds lack working srt:// output.
	 *
	 * Do **not** append go2rtc's `#hardware` here: that requests HW **decode**, which often hangs on headless Linux
	 * (no VAAPI/NVDEC). SW decode is cheap for preview; `hardware_accel` still applies to NDI/local **encode** paths.
	 */
	buildSrtSource(_config, port, casparHost) {
		const bind = casparHost === '127.0.0.1' || casparHost === 'localhost' ? '127.0.0.1' : casparHost
		const q = 'fifo_size=50000000&overrun_nonfatal=1'
		return `ffmpeg:udp://${bind}:${port}?${q}#video=h264#audio=opus`
	}

	/**
	 * @param {Array<{name: string, channel: number, port: number}>} targets
	 * @param {Object} config
	 * @param {string} casparHost
	 */
	generateYaml(targets, config, casparHost = '127.0.0.1') {
		const tier = resolveCaptureTier(config.captureMode || 'auto', casparHost)
		this.activeTier = tier
		console.log(`[go2rtc] Capture tier resolved: ${tier} (requested: ${config.captureMode || 'auto'})`)

		let yamlLines = ['streams:']
		this.streams = {}

		for (const t of targets) {
			this.streams[t.name] = t
			let source

			switch (tier) {
				case 'local':
					source = this.buildLocalSource(config)
					break
				case 'ndi':
					source = this.buildNdiSource(config, t.channel)
					break
				case 'srt':
				default:
					source = this.buildSrtSource(config, t.port, casparHost)
					break
			}

			yamlLines.push(`  ${t.name}:`)
			yamlLines.push(`    - "${source}"`)
		}

		yamlLines.push('')
		yamlLines.push('api:')
		yamlLines.push(`  listen: ":${config.go2rtcPort}"`)
		yamlLines.push('')
		yamlLines.push('webrtc:')
		yamlLines.push(`  listen: ":${config.webrtcPort}"`)
		yamlLines.push('')
		yamlLines.push('rtsp:')
		yamlLines.push('  listen: ":8554"')

		appendGo2rtcLogYaml(config, yamlLines)

		return yamlLines.join('\n')
	}

	async start(targets, config, casparHost = '127.0.0.1') {
		this._startGeneration += 1
		const myGeneration = this._startGeneration

		if (this.process) {
			await this.stop()
		}

		if (!go2rtcBinary || !fs.existsSync(go2rtcBinary)) {
			const msg = `go2rtc binary not found at "${go2rtcBinary}". Live preview will be disabled.`
			console.error(`[go2rtc] ${msg}`)
			throw new Error(msg)
		}

		this.config = config
		const yaml = this.generateYaml(targets, config, casparHost)

		if (this.activeTier === 'ndi') {
			const ndi = validateFfmpegNdiInput()
			if (!ndi.ok) {
				throw new Error(ndi.error || 'NDI: ffmpeg libndi check failed')
			}
		}

		fs.writeFileSync(this.yamlPath, yaml, 'utf8')
		console.log(
			`[go2rtc] Wrote ${this.yamlPath} (${yaml.length} bytes) streams=${targets.map((t) => t.name).join(', ')}`
		)
		for (const t of targets) {
			console.log(`[go2rtc]   ${t.name}: Caspar channel ${t.channel} → UDP ${t.port} (go2rtc ingest)`)
		}

		return new Promise((resolve, reject) => {
			console.log(`[go2rtc] Starting binary (tier: ${this.activeTier}) with API on :${config.go2rtcPort} and WebRTC on :${config.webrtcPort}...`)
			this.process = spawn(go2rtcBinary, ['-config', this.yamlPath], {
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true,
			})

			let isStarted = false
			const onReady = () => {
				if (myGeneration !== this._startGeneration) return
				if (!isStarted) {
					isStarted = true
					resolve()
				}
			}

			this.process.stdout.on('data', (d) => {
				const s = d.toString()
				if (!isStarted && s.includes('go2rtc version')) {
					setTimeout(onReady, 500)
				}
			})

			this.process.stderr.on('data', (d) => {
				const s = d.toString()
				if (s.trim()) {
					process.stderr.write(`[go2rtc] ${s}`)
				}
				if (!isStarted && s.includes('api=')) {
					onReady()
				}
			})

			this.process.on('close', (code, signal) => {
				this.process = null
				if (myGeneration !== this._startGeneration) {
					// Replaced by a newer start(); do not reject (avoids false "SIGTERM" when config + Caspar race).
					if (!isStarted) resolve()
					return
				}
				if (!isStarted) {
					const why =
						code === null || code === undefined
							? `signal ${signal || 'unknown'}`
							: `exit code ${code}`
					const ndiHint =
						this.activeTier === 'ndi'
							? ' For NDI capture, ffmpeg must include libndi_newtek_input.'
							: ''
					reject(new Error(`go2rtc failed to start (${why}). See [go2rtc] lines above.${ndiHint}`))
				} else {
					const why =
						code === null || code === undefined
							? `signal ${signal || 'unknown'}`
							: `exit code ${code}`
					console.log(`[go2rtc] Stopped (${why})`)
				}
			})

			this.process.on('error', (err) => {
				this.process = null
				if (myGeneration !== this._startGeneration) {
					if (!isStarted) resolve()
					return
				}
				if (!isStarted) reject(err)
				console.error(`[go2rtc] Error:`, err.message)
			})

			// Fallback only if process still running (avoids resolving after a dead child).
			setTimeout(() => {
				if (myGeneration !== this._startGeneration) return
				if (!isStarted && this.process && this.process.exitCode === null) {
					onReady()
				}
			}, 2500)
		})
	}

	async stop() {
		if (!this.process) return

		return new Promise((resolve) => {
			this.process.on('close', resolve)
			this.process.kill('SIGTERM')

			setTimeout(() => {
				if (this.process) {
					this.process.kill('SIGKILL')
					this.process = null
				}
				resolve()
			}, 5000)
		}).then(() => {
			this.process = null
		})
	}

	get availableStreams() {
		return Object.keys(this.streams)
	}
}

// Global singleton
const manager = new Go2rtcManager()

module.exports = {
	Go2rtcManager,
	go2rtcManager: manager,
	resolveCaptureTier,
}
