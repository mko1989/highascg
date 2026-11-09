'use strict'

/**
 * WO-1012 — the Zoom device: the stock Zoom desktop client (/usr/bin/zoom) on :0, its windows grabbed as live inputs.
 *
 * Sources are fixed — presenter, share, gallery — and each one is a shm ring `zoom-<source>` (zoom-grab.js), so it is
 * a Live-tab source at once (/api/shm/sources, `shm://zoom-share`) and a host channel can PLAY it (SHM NAME).
 * The operator assigns a Zoom window to a source. A hidden source's window goes to Openbox's BELOW layer at the
 * operator GUI's rect, sized to the ring: covered by the GUI, never on a program monitor, still rendering (XComposite).
 * Why not other virtual desktops (the owner's first idea): Openbox UNMAPS windows on other desktops, and an unmapped
 * window has no pixels to grab (spike 09.11). Why not off-screen: Openbox clamps moves past the screen edge, so the
 * window landed on the program monitor (spike 09.11).
 *
 * When Zoom recreates a window (a share starts or stops, the view changes) the grab reports "window gone"; a 2 s check
 * re-binds the source to a window with the same title (or role) that no other source uses, and hides it again.
 *
 * `createZoomSession(deps)` takes injectable exec / spawn / listWindows / guiRect / grab factories for the smoke test.
 */

const fs = require('fs')
const { spawn: nodeSpawn, execFile } = require('child_process')
const { promisify } = require('util')
const { displaySessionEnv } = require('../utils/x-display-session-runtime-env')
const zoomWindows = require('./zoom-windows')
const zoomGrab = require('./zoom-grab')

const SOURCES = ['presenter', 'share', 'gallery']
const ZOOM_BIN = '/usr/bin/zoom'
const DEFAULT_SIZE = '1920x1080'
const DEFAULT_FPS = 30
const REBIND_MS = 2000

/** A Zoom meeting link or number → the zoommtg:// URL the client joins, or '' when it is neither. */
function joinUrl(raw) {
	const s = String(raw || '').trim()
	if (!s) return ''
	if (/^zoommtg:\/\//i.test(s)) return s
	const digits = s.replace(/[\s-]/g, '')
	if (/^\d{9,12}$/.test(digits)) return `zoommtg://zoom.us/join?action=join&confno=${digits}`
	let u
	try {
		u = new URL(s)
	} catch {
		return ''
	}
	const m = u.pathname.match(/\/(?:j|w|s)\/(\d{9,12})/)
	if (!/(^|\.)zoom\.us$/i.test(u.hostname) || !m) return ''
	const pwd = u.searchParams.get('pwd')
	return `zoommtg://${u.hostname}/join?action=join&confno=${m[1]}${pwd ? `&pwd=${encodeURIComponent(pwd)}` : ''}`
}

/** "1920x1080" with sane bounds, else the default. */
function cleanSize(raw) {
	const m = String(raw || '').match(/^(\d{2,4})x(\d{2,4})$/)
	if (!m) return DEFAULT_SIZE
	const w = Math.min(3840, Math.max(320, parseInt(m[1], 10)))
	const h = Math.min(2160, Math.max(180, parseInt(m[2], 10)))
	return `${w - (w % 2)}x${h - (h % 2)}`
}

function createZoomSession(deps = {}) {
	const exec = deps.exec || promisify(execFile)
	const spawn = deps.spawn || nodeSpawn
	const exists = deps.exists || fs.existsSync
	const listWindows = deps.listWindows || (() => zoomWindows.listZoomWindows())
	const guiRect = deps.guiRect || (() => zoomWindows.operatorGuiRect())
	const makeGrab = deps.createGrab || zoomGrab.createGrab
	const ensureBinary = deps.ensureBinary || zoomGrab.ensureBinary
	const log = deps.log || (() => {})
	const timers = deps.timers || { setInterval, clearInterval }

	/** @type {Record<string, { window: string|null, title: string, role: string, hidden: boolean, size: string, fps: number, grab: any }>} */
	const src = {}
	for (const s of SOURCES) src[s] = { window: null, title: '', role: '', hidden: false, size: DEFAULT_SIZE, fps: DEFAULT_FPS, grab: null }
	let rebindTimer = null
	let lastError = ''

	async function zoomPids() {
		try {
			const { stdout } = await exec('pgrep', ['-x', 'zoom'], { timeout: 3000 })
			return stdout.split(/\s+/).filter(Boolean).map(Number)
		} catch {
			return []
		}
	}

	async function placeHidden(s) {
		const e = src[s]
		if (!e.grab) return
		const [w, h] = e.size.split('x').map(Number)
		const r = (await guiRect()) || { x: 0, y: 0, width: w, height: h }
		e.grab.below()
		e.grab.move(r.x, r.y, Math.min(w, r.width), Math.min(h, r.height))
	}

	function stopGrab(s) {
		const e = src[s]
		if (e.grab) e.grab.stop()
		e.grab = null
	}

	function ensureGrab(s) {
		const e = src[s]
		if (e.grab && e.grab.alive && e.grab.size === e.size && e.grab.fps === e.fps) return true
		stopGrab(s)
		const bin = ensureBinary()
		if (!bin.ok) {
			lastError = bin.error || 'window grabber unavailable'
			return false
		}
		e.grab = makeGrab({
			ring: `zoom-${s}`,
			size: e.size,
			fps: e.fps,
			window: e.window,
			bin: bin.bin,
			onStatus: (st) => {
				if (st.note === 'window gone') log('info', `[zoom] ${s}: window ${e.window} gone — waiting to re-bind`)
			},
			onExit: (code) => {
				if (code) log('warn', `[zoom] ${s} grabber exited ${code}: ${e.grab?.stderr || ''}`)
			},
		})
		log('info', `[zoom] ${s}: grabbing ${e.window || '(none)'} → shm ring zoom-${s} ${e.size}@${e.fps}`)
		return true
	}

	/** Re-bind sources whose window Zoom destroyed to a same-title (else same-role) window nobody else uses. */
	async function rebind() {
		const lost = SOURCES.filter((s) => src[s].window && src[s].grab && src[s].grab.alive && !src[s].grab.status.window)
		if (!lost.length) return
		const wins = await listWindows()
		for (const s of lost) {
			const used = new Set(SOURCES.filter((o) => o !== s).map((o) => src[o].window))
			const free = wins.filter((w) => !used.has(w.id))
			const hit = free.find((w) => w.title === src[s].title) || free.find((w) => w.role === src[s].role && w.role !== 'home')
			if (!hit) continue
			src[s].window = hit.id
			src[s].title = hit.title
			src[s].grab.setWindow(hit.id)
			if (src[s].hidden) await placeHidden(s)
			log('info', `[zoom] ${s}: re-bound to ${hit.id} "${hit.title}"`)
		}
	}

	function syncTimer() {
		const want = SOURCES.some((s) => src[s].grab)
		if (want && !rebindTimer) {
			rebindTimer = timers.setInterval(() => rebind().catch(() => {}), REBIND_MS)
			rebindTimer.unref?.()
		} else if (!want && rebindTimer) {
			timers.clearInterval(rebindTimer)
			rebindTimer = null
		}
	}

	async function status() {
		const [pids, windows] = await Promise.all([zoomPids(), listWindows()])
		const sources = {}
		for (const s of SOURCES) {
			const e = src[s]
			const g = e.grab
			sources[s] = {
				ring: `zoom-${s}`,
				value: `shm://zoom-${s}`,
				window: e.window,
				title: e.title,
				hidden: e.hidden,
				size: e.size,
				fps: e.fps,
				grabbing: !!(g && g.alive),
				mapped: !!(g && g.status.mapped),
				published: g ? g.status.published || 0 : 0,
				error: g && !g.alive ? g.stderr : '',
			}
		}
		return { ok: true, installed: exists(ZOOM_BIN), running: pids.length > 0, windows, sources, error: lastError }
	}

	/** WO-1012 C: only the PULSE_* lines of zoom-audio's zoomEnv() reach Zoom's env. */
	function audioEnv(env) {
		const out = {}
		for (const k of ['PULSE_SERVER', 'PULSE_SINK', 'PULSE_SOURCE']) if (env && typeof env[k] === 'string' && env[k]) out[k] = env[k]
		return out
	}

	/** Start the Zoom client (and join `url` — a meeting link or number — when given). */
	async function launch(opts = {}) {
		if (!exists(ZOOM_BIN)) throw new Error('Zoom is not installed (/usr/bin/zoom)')
		const raw = String(opts.url || '').trim()
		const url = joinUrl(raw)
		if (raw && !url) throw new Error('not a Zoom meeting link or number')
		const uid = typeof process.getuid === 'function' ? process.getuid() : 1000
		// WO-780: a system-unit child has no user-session env — Zoom needs it for PipeWire audio and D-Bus
		const env = { ...displaySessionEnv(), XDG_RUNTIME_DIR: `/run/user/${uid}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`, ...audioEnv(opts.env) }
		const child = spawn(ZOOM_BIN, url ? [`--url=${url}`] : [], { env, detached: true, stdio: 'ignore' })
		child.unref?.()
		log('info', `[zoom] started the client${url ? ' (joining a meeting)' : ''}`)
		return { ok: true, joining: !!url }
	}

	/** Stop every grab and quit the Zoom client (leaves any meeting). */
	async function quit() {
		for (const s of SOURCES) {
			stopGrab(s)
			src[s].window = null
			src[s].hidden = false
		}
		syncTimer()
		const pids = await zoomPids()
		for (const p of pids) {
			try {
				process.kill(p, 'SIGTERM')
			} catch {
				/* gone */
			}
		}
		log('info', `[zoom] quit (${pids.length} process(es))`)
		return { ok: true, stopped: pids.length }
	}

	/**
	 * Point a source at a Zoom window (null = stop that source).
	 * @param {string} s presenter | share | gallery
	 * @param {{ window?: string|null, hidden?: boolean, size?: string, fps?: number }} o
	 */
	async function assign(s, o = {}) {
		if (!SOURCES.includes(s)) throw new Error(`unknown Zoom source "${s}" (presenter, share, gallery)`)
		const e = src[s]
		if (o.size != null) e.size = cleanSize(o.size)
		if (o.fps != null) e.fps = Math.max(5, Math.min(60, parseInt(String(o.fps), 10) || DEFAULT_FPS))
		if (o.window !== undefined) {
			if (!o.window) {
				if (e.grab && e.hidden) e.grab.normal()
				stopGrab(s)
				e.window = null
				e.title = ''
				e.role = ''
				e.hidden = false
				syncTimer()
				return status()
			}
			const wins = await listWindows()
			const w = wins.find((x) => x.id === String(o.window).toLowerCase())
			if (!w) throw new Error(`no Zoom window ${o.window} on screen`)
			const other = SOURCES.find((x) => x !== s && src[x].window === w.id)
			if (other) throw new Error(`that window already feeds "${other}"`)
			if (e.grab && e.window && e.window !== w.id && e.hidden) e.grab.normal() // the old window comes back
			e.window = w.id
			e.title = w.title
			e.role = w.role
		}
		if (!e.window) throw new Error(`pick a Zoom window for "${s}" first`)
		lastError = ''
		if (!ensureGrab(s)) throw new Error(lastError)
		e.grab.setWindow(e.window)
		const hide = o.hidden !== undefined ? !!o.hidden : e.hidden
		if (hide) await placeHidden(s)
		else if (e.hidden) e.grab.normal()
		e.hidden = hide
		syncTimer()
		return status()
	}

	function stopAll() {
		for (const s of SOURCES) stopGrab(s)
		syncTimer()
	}

	return { status, launch, quit, assign, stopAll, rebind, SOURCES }
}

let instance = null
/** The box instance (routes); tests build their own with injected deps. */
function getZoomSession(log) {
	if (!instance) instance = createZoomSession({ log })
	return instance
}

module.exports = { createZoomSession, getZoomSession, joinUrl, cleanSize, SOURCES }
