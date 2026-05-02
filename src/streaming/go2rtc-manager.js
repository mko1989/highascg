/**
 * go2rtc process manager and bridge orchestrator.
 */
'use strict'

const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process')
const { validateFfmpegNdiInput } = require('./ndi-resolve')
const { resolveCaptureTier, appendGo2rtcLogYaml } = require('./go2rtc-config')
const Source = require('./go2rtc-source-logic'); const Status = require('./go2rtc-status-logic')

let _cachedGo2rtcPath
function resolveGo2rtcBinaryPath() {
	if (_cachedGo2rtcPath !== undefined) return _cachedGo2rtcPath
	const explicit = process.env.HIGHASCG_GO2RTC_BINARY || process.env.GO2RTC_BIN
	if (explicit) { const p = path.resolve(String(explicit).trim()); if (fs.existsSync(p)) return (_cachedGo2rtcPath = p) }
	try { const p = require('go2rtc-static'); if (p && fs.existsSync(p) && fs.statSync(p).size > 0) return (_cachedGo2rtcPath = p) } catch {}
	return (_cachedGo2rtcPath = null)
}

class Go2rtcManager {
	constructor() {
		this.process = null; this.isRestarting = false; this._startGeneration = 0
		this.yamlPath = path.join(process.cwd(), 'go2rtc.yaml'); this.streams = {}; this.config = null; this.activeTier = 'udp'; this._udpBridgeProcs = []
		this._onProcessExit = () => { try { if (this.process?.exitCode === null) this.process.kill('SIGKILL') } catch {} }
		process.once('exit', this._onProcessExit)
	}

	_stopUdpPushBridges() { for (const p of this._udpBridgeProcs) { try { if (p.exitCode === null) p.kill('SIGTERM') } catch {} } this._udpBridgeProcs = [] }

	_startUdpPushBridges(targets, config, casparHost, myGen) {
		if (this.activeTier !== 'udp') return; this._stopUdpPushBridges()
		const ffmpeg = config.ffmpeg_path || process.env.FFMPEG_PATH || 'ffmpeg'; const api = `http://127.0.0.1:${config.go2rtcPort}`
		for (const t of targets) {
			const bind = ['127.0.0.1', 'localhost', '0.0.0.0'].includes(casparHost) ? '127.0.0.1' : casparHost
			const input = `udp://${bind}:${t.port}?fifo_size=50000000&overrun_nonfatal=1`
			const pushUrl = `${api}/api/stream.ts?dst=${encodeURIComponent(t.name)}`
			const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-nostats', '-i', input, '-c', 'copy', '-f', mpegts, pushUrl], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
			this._udpBridgeProcs.push(child); child.stderr.on('data', d => process.stderr.write(`[udp-bridge ${t.name}] ${d}`))
		}
	}

	generateYaml(targets, config, casparHost = '127.0.0.1') {
		const tier = resolveCaptureTier(config.captureMode || 'udp', casparHost); this.activeTier = tier
		let lines = ['streams:']; this.streams = {}
		for (const t of targets) {
			this.streams[t.name] = t; if (tier === 'udp') { lines.push(`  ${t.name}: null`); continue }
			const src = tier === 'local' ? Source.buildLocalSource(config) : Source.buildNdiSource(config, t.channel)
			lines.push(`  ${t.name}:`, `    - "${src}"`)
		}
		lines.push('', 'api:', `  listen: ":${config.go2rtcPort}"`, '', 'webrtc:', `  listen: ":${config.webrtcPort}"`, '', 'rtsp:', '  listen: ":8554"')
		appendGo2rtcLogYaml(config, lines); return lines.join('\n')
	}

	async start(targets, config, casparHost = '127.0.0.1') {
		this._startGeneration++; const myGen = this._startGeneration; this._stopUdpPushBridges()
		if (this.process) await this.stop(); const bin = resolveGo2rtcBinaryPath()
		if (!bin) throw new Error('go2rtc binary not found.')
		if (this.activeTier === 'ndi' && !validateFfmpegNdiInput().ok) throw new Error('NDI: ffmpeg check failed')
		const yaml = this.generateYaml(targets, config, casparHost); fs.writeFileSync(this.yamlPath, yaml, 'utf8')
		return new Promise((resolve, reject) => {
			this.process = spawn(bin, ['-config', this.yamlPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
			let ready = false; const onReady = () => { if (myGen === this._startGeneration && !ready) { ready = true; this._startUdpPushBridges(targets, config, casparHost, myGen); resolve() } }
			this.process.stdout.on('data', d => { const s = d.toString(); if (!ready && s.includes('go2rtc version')) setTimeout(onReady, 500); if (s.trim()) process.stdout.write(`[go2rtc] ${s}`) })
			this.process.stderr.on('data', d => { const s = d.toString(); if (s.trim()) process.stderr.write(`[go2rtc] ${s}`); if (!ready && s.includes('api=')) onReady() })
			this.process.on('close', (code, sig) => { this.process = null; if (myGen !== this._startGeneration) return; if (!ready) reject(new Error(`Failed to start (code ${code})`)); else console.log(`[go2rtc] Stopped`) })
			setTimeout(() => { if (myGen === this._startGeneration && !ready && this.process?.exitCode === null) onReady() }, 2500)
		})
	}

	async stop() {
		this._stopUdpPushBridges(); if (!this.process) return
		return new Promise(resolve => {
			const p = this.process; let done = false; const finish = () => { if (!done) { done = true; this.process = null; resolve() } }
			p.once('close', finish); p.kill('SIGTERM')
			setTimeout(() => { if (this.process?.exitCode === null) try { this.process.kill('SIGKILL') } catch {} finish() }, Math.max(200, parseInt(process.env.HIGHASCG_GO2RTC_STOP_KILL_MS || '1000', 10) || 1000))
		})
	}

	waitForPushIngestReady(targets, config, ctx) { return Status.waitForPushIngestReady(targets, config, ctx) }
	get availableStreams() { return Object.keys(this.streams) }
}

const manager = new Go2rtcManager()
module.exports = { Go2rtcManager, go2rtcManager: manager, resolveCaptureTier, resolveGo2rtcBinaryPath }
