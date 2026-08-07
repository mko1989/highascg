'use strict'

const { EventEmitter } = require('events')
const fs = require('fs')
const path = require('path')
const { SimPlaybackState } = require('./amcp-simulated-state')

/**
 * WO-453 rewrite: simulated AMCP for `offline_mode` / `--no-caspar`.
 *
 * The 33-line stub this replaces answered five command shapes with empty data, so
 * the sim booted into a server with zero channels, an empty media library and
 * silent no-op takes. This version answers with the same SHAPES the real
 * transport produces (`{ ok, data }`, arrays for line responses, XML strings for
 * INFO), sourced from the same places the real server would be configured from:
 *
 * - INFO CONFIG  → the generated casparcg.config XML for the CURRENT app config
 *                  (config-generator — identical channel plan to a real Apply)
 * - CLS/CINF     → recursive scan of the real media ingest dir
 * - TLS          → scan of the repo template/ tree
 * - INFO / INFO N → channel list + per-channel stage XML from live sim playback
 *                  state (SimPlaybackState), same schema as the 2.6-dev binary
 *
 * Playout commands (PLAY/LOADBG/…) mutate {@link SimPlaybackState}; the OSC side
 * of the parity story lives in sim-osc-feeder.js which reports that state through
 * the real OscState pipeline.
 */

/** 16x9 dark-gray PNG for THUMBNAIL RETRIEVE (base64, what routes-media expects). */
const PLACEHOLDER_PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAACRvIhWAAAAHUlEQVR4nGNgYmJiYGBgYGBg' +
	'+P//PwMDAwMDAwMDAB0mA/1D5H1FAAAAAElFTkSuQmCC'

const MOVIE_EXT = new Set(['.mp4', '.mov', '.mxf', '.mkv', '.avi', '.webm', '.m4v', '.mpg', '.mpeg', '.ts'])
const STILL_EXT = new Set(['.png', '.jpg', '.jpeg', '.tga', '.tif', '.tiff', '.bmp', '.gif'])
const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.aac', '.ogg'])
const SCAN_CACHE_MS = 10_000

function fpsFromMode(mode) {
	const m = String(mode || '').match(/[pi](\d{4})$/)
	if (!m) return 50
	const code = parseInt(m[1], 10)
	return code >= 1000 ? code / 100 : 50
}

function xmlEscape(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function clsTimestamp(mtimeMs) {
	const d = new Date(mtimeMs || Date.now())
	const p = (n, w = 2) => String(n).padStart(w, '0')
	return (
		`${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
		`${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
	)
}

class AmcpSimulated extends EventEmitter {
	constructor(client) {
		super()
		this.client = client
		this.state = new SimPlaybackState()
		this._mediaCache = { at: 0, lines: [], byId: new Map() }
		this._templateCache = { at: 0, lines: [] }
	}

	get isConnected() {
		return true // Always "connected" in simulation
	}

	get _config() {
		return this.client?._context?.config || {}
	}

	_repoRoot() {
		return path.resolve(__dirname, '..', '..')
	}

	/** Channel plan straight from the config generator — same XML a real Apply writes. */
	_configXml() {
		try {
			const { buildConfigXml } = require('../config/config-generator')
			const { buildCasparGeneratorFlatConfig } = require('../config/build-caspar-generator-config')
			return buildConfigXml(buildCasparGeneratorFlatConfig(this._config))
		} catch (e) {
			return '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <channels>\n    <channel>\n      <video-mode>1080p5000</video-mode>\n    </channel>\n  </channels>\n</configuration>'
		}
	}

	/** Ordered channel video-modes parsed back out of the generated config. */
	channelModes() {
		const xml = this._configXml()
		const modes = []
		const re = /<video-mode>\s*([^<\s]+)\s*<\/video-mode>/g
		let m
		while ((m = re.exec(xml))) modes.push(m[1])
		return modes.length ? modes : ['1080p5000']
	}

	_mediaEntries() {
		const now = Date.now()
		if (now - this._mediaCache.at < SCAN_CACHE_MS) return this._mediaCache
		const lines = []
		const byId = new Map()
		try {
			const { getMediaIngestBasePath, scanMediaRecursiveForBrowser } = require('../media/local-media-paths')
			const base = getMediaIngestBasePath(this._config)
			for (const ent of scanMediaRecursiveForBrowser(base)) {
				if (ent.isDir) continue
				const ext = path.extname(ent.id).toLowerCase()
				const type = MOVIE_EXT.has(ext) ? 'MOVIE' : STILL_EXT.has(ext) ? 'STILL' : AUDIO_EXT.has(ext) ? 'AUDIO' : null
				if (!type) continue
				let size = 0
				let mtime = 0
				try {
					const st = fs.statSync(path.join(base, ent.id))
					size = st.size
					mtime = st.mtimeMs
				} catch { /* unreadable file still listed */ }
				const id = ent.id.replace(/\.[^./]+$/, '').toUpperCase()
				const line = `"${id}" ${type} ${size} ${clsTimestamp(mtime)} 0 1/25`
				lines.push(line)
				byId.set(id, line)
			}
		} catch { /* media dir absent → empty catalog, same as a bare Caspar */ }
		this._mediaCache = { at: now, lines, byId }
		return this._mediaCache
	}

	_templateLines() {
		const now = Date.now()
		if (now - this._templateCache.at < SCAN_CACHE_MS) return this._templateCache.lines
		const lines = []
		const base = path.join(this._repoRoot(), 'template')
		const walk = (rel) => {
			let entries
			try {
				entries = fs.readdirSync(path.join(base, rel), { withFileTypes: true })
			} catch {
				return
			}
			for (const ent of entries) {
				if (ent.name.startsWith('.')) continue
				const r = rel ? `${rel}/${ent.name}` : ent.name
				if (ent.isDirectory()) walk(r)
				else if (/\.html?$/i.test(ent.name)) {
					let size = 0
					let mtime = 0
					try {
						const st = fs.statSync(path.join(base, r))
						size = st.size
						mtime = st.mtimeMs
					} catch { /* listed anyway */ }
					lines.push(`"${r.replace(/\.html?$/i, '').toUpperCase()}" ${size} ${clsTimestamp(mtime)}`)
				}
			}
		}
		walk('')
		this._templateCache = { at: now, lines }
		return lines
	}

	/** `INFO` — one status line per configured channel. */
	_infoChannelLines() {
		return this.channelModes().map((mode, i) => `${i + 1} ${mode} PLAYING`)
	}

	/** `INFO <ch>` — stage XML in the 2.6-dev schema (see smoke-wo235-osc-compat). */
	_channelXml(ch) {
		const modes = this.channelModes()
		const mode = modes[ch - 1] || modes[0]
		const fps = fpsFromMode(mode)
		const layers = this.state.channels.get(ch)
		let stage = ''
		if (layers) {
			for (const [num, cell] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
				if (!cell.fg && !cell.bg && !cell.cg) continue
				const fg = cell.fg
				const elapsed = this.state.elapsedOf(cell)
				const fgXml = fg
					? `<foreground><file><name>${xmlEscape(fg.clip)}</name><path>${xmlEscape(fg.clip)}</path>` +
						`<time>${(elapsed ?? 0).toFixed(2)}</time><time>${fg.duration.toFixed(2)}</time></file>` +
						`<loop>${fg.loop}</loop><paused>${fg.paused}</paused><producer>ffmpeg</producer></foreground>`
					: cell.cg
						? `<foreground><producer>html</producer></foreground>`
						: `<foreground><producer>empty</producer></foreground>`
				const bgXml = cell.bg
					? `<background><file><name>${xmlEscape(cell.bg.clip)}</name></file><producer>ffmpeg</producer></background>`
					: `<background><producer>empty</producer></background>`
				stage += `<layer_${num}>${bgXml}${fgXml}</layer_${num}>`
			}
		}
		return (
			`<?xml version="1.0" encoding="utf-8"?>\n<channel><format>${xmlEscape(mode)}</format>` +
			`<framerate>${fps}</framerate><stage><layer>${stage}</layer></stage></channel>`
		)
	}

	_pathsXml() {
		const root = this._repoRoot()
		try {
			const { getMediaIngestBasePath } = require('../media/local-media-paths')
			const media = getMediaIngestBasePath(this._config)
			return (
				`<?xml version="1.0" encoding="utf-8"?>\n<paths><media-path>${xmlEscape(media)}/</media-path>` +
				`<template-path>${xmlEscape(path.join(root, 'template'))}/</template-path>` +
				`<log-path>${xmlEscape(path.join(root, 'log'))}/</log-path></paths>`
			)
		} catch {
			return '<?xml version="1.0" encoding="utf-8"?>\n<paths></paths>'
		}
	}

	/**
	 * Simulated send. Same result envelope as the real transport: `{ ok, data }`
	 * with line-array data for list commands and XML strings for INFO forms.
	 */
	send(cmd) {
		const trimmed = String(cmd == null ? '' : cmd).trim()
		if (!trimmed) return Promise.resolve({ ok: true, data: '202 OK' })
		const first = (trimmed.match(/^(\S+)/) || [])[1].toUpperCase()
		const rest = trimmed.slice(first.length).trim()
		if (!AmcpSimulated.QUIET.has(first)) console.log(`[AMCP SIM] Executing: ${trimmed}`)

		if (first === 'VERSION') return Promise.resolve({ ok: true, data: '2.4.0 (Simulated)' })
		if (first === 'PING') return Promise.resolve({ ok: true, data: 'PONG' })
		if (first === 'CLS') return Promise.resolve({ ok: true, data: [...this._mediaEntries().lines] })
		if (first === 'TLS') return Promise.resolve({ ok: true, data: [...this._templateLines()] })
		if (first === 'FLS') return Promise.resolve({ ok: true, data: [] })
		if (first === 'CINF') {
			const name = rest.replace(/^"|"$/g, '').toUpperCase()
			const line = this._mediaEntries().byId.get(name)
			return Promise.resolve({ ok: !!line, data: line || '404 CINF ERROR' })
		}
		if (first === 'INFO') {
			const sub = (rest.match(/^(\S+)/) || [])[1] || ''
			const subU = sub.toUpperCase()
			if (!sub) return Promise.resolve({ ok: true, data: this._infoChannelLines() })
			if (/^\d+(-\d+)?$/.test(sub)) {
				const ch = parseInt(sub, 10)
				return Promise.resolve({ ok: true, data: this._channelXml(ch) })
			}
			if (subU === 'CONFIG') return Promise.resolve({ ok: true, data: this._configXml() })
			if (subU === 'PATHS') return Promise.resolve({ ok: true, data: this._pathsXml() })
			if (subU === 'SYSTEM')
				return Promise.resolve({
					ok: true,
					data: '<?xml version="1.0" encoding="utf-8"?>\n<system><name>HighAsCG Simulator</name></system>',
				})
			return Promise.resolve({ ok: true, data: '' })
		}
		if (first === 'DATA') {
			const m = rest.match(/^(\S+)\s*(.*)$/)
			const verb = m ? m[1].toUpperCase() : ''
			const args = m ? m[2] : ''
			if (verb === 'LIST') return Promise.resolve({ ok: true, data: [...this.state.dataStore.keys()] })
			if (verb === 'STORE') {
				const s = args.match(/^"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"/) || args.match(/^(\S+)\s+(.*)$/)
				if (s) this.state.dataStore.set(s[1], s[2])
				return Promise.resolve({ ok: true, data: '202 DATA STORE OK' })
			}
			if (verb === 'RETRIEVE') {
				const key = args.replace(/^"|"$/g, '')
				const v = this.state.dataStore.get(key)
				return Promise.resolve({ ok: v !== undefined, data: v !== undefined ? v : '404 DATA RETRIEVE ERROR' })
			}
			if (verb === 'REMOVE') {
				this.state.dataStore.delete(args.replace(/^"|"$/g, ''))
				return Promise.resolve({ ok: true, data: '202 DATA REMOVE OK' })
			}
			return Promise.resolve({ ok: true, data: '202 OK' })
		}
		if (first === 'THUMBNAIL') {
			const verb = (rest.match(/^(\S+)/) || [])[1]?.toUpperCase() || ''
			if (verb === 'LIST') return Promise.resolve({ ok: true, data: [...this._mediaEntries().lines] })
			if (verb === 'RETRIEVE') return Promise.resolve({ ok: true, data: PLACEHOLDER_PNG_B64 })
			return Promise.resolve({ ok: true, data: '202 THUMBNAIL OK' })
		}
		if (first === 'MIXER') {
			// `MIXER 1-10 OPACITY 0.5 …` stores; `MIXER 1-10 OPACITY` returns the stored value.
			const m = rest.match(/^(\S+)\s+(\S+)\s*(.*)$/)
			if (m) {
				const key = `${m[1]}/${m[2].toUpperCase()}`
				if (m[3].trim() === '') {
					const v = this.state.mixerStore.get(key)
					return Promise.resolve({ ok: true, data: v !== undefined ? v : '' })
				}
				if (m[2].toUpperCase() === 'CLEAR') {
					for (const k of [...this.state.mixerStore.keys()]) if (k.startsWith(`${m[1]}/`)) this.state.mixerStore.delete(k)
				} else {
					this.state.mixerStore.set(key, m[3].trim())
				}
			}
			this.emit('command', { cmd: trimmed })
			return Promise.resolve({ ok: true, data: '202 MIXER OK' })
		}
		if (first === 'CG') {
			this.state.applyCg(rest)
			this.emit('command', { cmd: trimmed })
			return Promise.resolve({ ok: true, data: `202 CG OK` })
		}
		if (this.state.apply(first, rest)) {
			this.emit('command', { cmd: trimmed })
			return Promise.resolve({ ok: true, data: `202 ${first} OK` })
		}

		return Promise.resolve({ ok: true, data: '202 OK' })
	}
}

/** Query-shaped commands stay out of the console — CINF sweeps alone are ~100 lines at boot. */
AmcpSimulated.QUIET = new Set([
	'VERSION', 'INFO', 'CLS', 'TLS', 'FLS', 'CINF', 'DATA', 'THUMBNAIL', 'GL', 'DIAG', 'HELP', 'PING', 'MIXER',
])

module.exports = { AmcpSimulated }
