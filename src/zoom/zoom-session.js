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
const os = require('os')
const path = require('path')
const { spawn: nodeSpawn, execFile } = require('child_process')
const { promisify } = require('util')
const { displaySessionEnv } = require('../utils/x-display-session-runtime-env')
const { zoomClientEnv, userScopeArgv } = require('./zoom-launch-env')
const zoomWindows = require('./zoom-windows')
const zoomGrab = require('./zoom-grab')

const SOURCES = ['presenter', 'share', 'gallery']
const ZOOM_BIN = '/usr/bin/zoom'
const DEFAULT_SIZE = '1920x1080'
const DEFAULT_FPS = 30
const REBIND_MS = 2000
/**
 * Zoom 7.1 dark theme: background, title bar, window frame, video tile frame. A source with `fit` on shows only the
 * picture inside the window (the share, the speaker's video), scaled to fill the ring: no title bar, no toolbar.
 */
const ZOOM_CHROME = '131619,2a2b2d,242424,1a1a1a'

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
	for (const s of SOURCES) src[s] = { window: null, title: '', role: '', hidden: false, fit: true, size: DEFAULT_SIZE, fps: DEFAULT_FPS, grab: null }
	let rebindTimer = null
	let lastError = ''

	// The bindings outlive a node restart (Zoom runs in its own scope and keeps its windows): the title, never the
	// window id, is kept, and restore() re-finds the window. Only the box instance has a state file.
	const stateFile = deps.stateFile || null
	/** @type {Record<string, { title: string, role: string, hidden: boolean, size: string, fps: number }>} */
	let pending = {}
	if (stateFile) {
		try {
			const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
			for (const s of SOURCES) if (saved && saved[s] && typeof saved[s].title === 'string' && saved[s].title) pending[s] = saved[s]
		} catch {
			/* nothing saved */
		}
	}
	function save() {
		if (!stateFile) return
		const out = { ...pending }
		for (const s of SOURCES) if (src[s].window) out[s] = { title: src[s].title, role: src[s].role, hidden: src[s].hidden, fit: src[s].fit, size: src[s].size, fps: src[s].fps }
		try {
			fs.mkdirSync(path.dirname(stateFile), { recursive: true })
			fs.writeFileSync(stateFile, JSON.stringify(out))
		} catch (e) {
			log('warn', `[zoom] bindings not saved: ${e.message}`)
		}
	}

	/** Bring back the saved bindings whose window is on screen again (largest window of that title nobody uses). */
	let restoring = false
	async function restore() {
		if (restoring) return // the boot call and the timer tick may overlap
		restoring = true
		try {
			await restoreOnce()
		} finally {
			restoring = false
		}
	}
	async function restoreOnce() {
		const todo = Object.keys(pending).filter((s) => !src[s].window)
		if (!todo.length) return
		const wins = await listWindows()
		for (const s of todo) {
			const used = new Set(SOURCES.map((o) => src[o].window).filter(Boolean))
			if (!pending[s]) continue
			const hit = zoomWindows.autoBindable(wins).filter((w) => !used.has(w.id) && w.title === pending[s].title).sort((a, b) => b.width * b.height - a.width * a.height)[0]
			if (!hit) continue
			const want = pending[s]
			delete pending[s]
			await assign(s, { window: hit.id, hidden: !!want.hidden, fit: want.fit !== false, size: want.size, fps: want.fps }).then(
				() => log('info', `[zoom] ${s}: binding restored to ${hit.id} "${hit.title}"`),
				(e) => log('warn', `[zoom] ${s}: binding not restored: ${e.message}`)
			)
		}
	}

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
		// 1 px inside the GUI's rect on every side, never the monitor's exact size: Openbox treats an undecorated window
		// that fills a monitor as fullscreen and lifts it above everything when it takes focus. Live 10.11: the "hidden"
		// gallery window covered the whole operator GUI after one click. The ring pads the 1 px.
		e.grab.move(r.x + 1, r.y + 1, Math.min(w, r.width) - 2, Math.min(h, r.height) - 2)
	}

	function stopGrab(s) {
		const e = src[s]
		if (e.grab) e.grab.stop()
		e.grab = null
	}

	async function ensureGrab(s) {
		const e = src[s]
		const fit = e.fit ? ZOOM_CHROME : ''
		if (e.grab && e.grab.alive && e.grab.size === e.size && e.grab.fps === e.fps && (e.grab.fit || '') === fit) return true
		// The old grabber unlinks the ring when it exits. Started before that, the new one lost its ring (10.11, live:
		// a fit change left /dev/shm without highascg-zoom-gallery). Wait for the exit, 2 s at most.
		const old = e.grab
		stopGrab(s)
		if (old && old.exited) await Promise.race([old.exited, new Promise((r) => setTimeout(r, 2000))])
		const bin = ensureBinary()
		if (!bin.ok) {
			lastError = bin.error || 'window grabber unavailable'
			return false
		}
		e.grab = makeGrab({
			ring: `zoom-${s}`,
			size: e.size,
			fps: e.fps,
			fit,
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
			// same title only, and only what autoBindable allows (the role fallback took the join preview, 10.11)
			const hit = zoomWindows.autoBindable(wins).find((w) => !used.has(w.id) && w.title === src[s].title)
			if (!hit) continue
			src[s].window = hit.id
			src[s].title = hit.title
			src[s].grab.setWindow(hit.id)
			if (src[s].hidden) await placeHidden(s)
			log('info', `[zoom] ${s}: re-bound to ${hit.id} "${hit.title}"`)
		}
	}

	function syncTimer() {
		const want = SOURCES.some((s) => src[s].grab) || Object.keys(pending).length > 0
		if (want && !rebindTimer) {
			rebindTimer = timers.setInterval(() => rebind().then(restore).catch(() => {}), REBIND_MS)
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
				fit: e.fit,
				box: (g && g.status.box) || null,
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

	/** Start the Zoom client (and join `url` — a meeting link or number — when given). */
	async function launch(opts = {}) {
		if (!exists(ZOOM_BIN)) throw new Error('Zoom is not installed (/usr/bin/zoom)')
		const raw = String(opts.url || '').trim()
		const url = joinUrl(raw)
		if (raw && !url) throw new Error('not a Zoom meeting link or number')
		// WO-780: a system-unit child has no user-session env. Zoom needs it for PipeWire audio and D-Bus.
		// WO-1012 C: only the PULSE_* lines of zoom-audio's zoomEnv() reach Zoom's env (zoom-launch-env.js).
		const env = { ...displaySessionEnv(), ...zoomClientEnv(opts.env) }
		// its own user scope: a node restart must not end the meeting (zoom-launch-env.js userScopeArgv)
		const cmd = userScopeArgv(ZOOM_BIN, url ? [`--url=${url}`] : [], { exists })
		const child = spawn(cmd.bin, cmd.args, { env, detached: true, stdio: 'ignore' })
		child.unref?.()
		log('info', `[zoom] started the client${url ? ' (joining a meeting)' : ''}`)
		return { ok: true, joining: !!url }
	}

	/** Stop every grab and quit the Zoom client (leaves any meeting). */
	async function quit() {
		for (const s of SOURCES) {
			// kept as a saved binding: the next Zoom start re-binds by title
			if (src[s].window) pending[s] = { title: src[s].title, role: src[s].role, hidden: src[s].hidden, fit: src[s].fit, size: src[s].size, fps: src[s].fps }
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
		if (typeof o.fit === 'boolean') e.fit = o.fit
		if (o.window !== undefined) {
			if (!o.window) {
				if (e.grab && e.hidden) e.grab.normal()
				stopGrab(s)
				e.window = null
				e.title = ''
				e.role = ''
				e.hidden = false
				delete pending[s]
				save()
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
		if (!(await ensureGrab(s))) throw new Error(lastError)
		e.grab.setWindow(e.window)
		const hide = o.hidden !== undefined ? !!o.hidden : e.hidden
		if (hide) await placeHidden(s)
		else if (e.hidden) e.grab.normal()
		e.hidden = hide
		delete pending[s]
		save()
		syncTimer()
		return status()
	}

	function stopAll() {
		for (const s of SOURCES) stopGrab(s)
		syncTimer()
	}

	syncTimer()
	return { status, launch, quit, assign, stopAll, rebind, restore, SOURCES }
}

let instance = null
/** The box instance (routes); tests build their own with injected deps. */
function getZoomSession(log) {
	// node:test children never touch the box's saved bindings
	const stateFile = process.env.NODE_TEST_CONTEXT ? null : path.join(os.homedir(), '.highascg', 'zoom-sources.json')
	if (!instance) instance = createZoomSession({ log, stateFile })
	return instance
}

/**
 * Node start (Caspar connected): the saved window bindings and Zoom audio come back without waiting for the first
 * GET from a client that happens to show the Zoom page. Never under node:test (it would start the real daemon).
 */
function restoreZoomOnBoot(ctx) {
	if (process.env.NODE_TEST_CONTEXT) return
	const warn = (what) => (e) => ctx?.log?.('warn', `[zoom] ${what} not restored: ${e?.message || e}`)
	try {
		getZoomSession((l, m) => ctx?.log?.(l, m)).restore().catch(warn('bindings'))
		require('./zoom-audio').getZoomAudio(ctx).restore().catch(warn('audio'))
	} catch (e) {
		warn('state')(e)
	}
}

module.exports = { restoreZoomOnBoot, createZoomSession, getZoomSession, joinUrl, cleanSize, SOURCES }
