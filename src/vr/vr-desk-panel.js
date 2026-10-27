'use strict'

/**
 * WO-792 — the lighting desk's UI (ChamSys MagicQ PC) as its own panel in the headset, during a VR session.
 *
 * WayVR (an OpenXR overlay, ~/.local/opt/wayvr/WayVR-*.AppImage) runs on WiVRn next to the XR client. Started
 * `--headless` it captures no desktop screens; its own compositor starts the bundled xwayland-satellite on a spare
 * X display (`xwayland-satellite :N`, needs the `xwayland` package), and an X11 app on that display becomes a panel
 * of its own. MagicQ's bundled Qt is xcb-only, so it runs there: `DISPLAY=:N QT_QPA_PLATFORM=xcb runmagicq.sh`.
 * On the operator's desktop nothing changes (no window on DP-0 / DP-4).
 *
 * WayVR only gets that far once OpenXR is up: while no headset is connected WiVRn has no active_runtime.json and
 * `--wait` keeps WayVR waiting. So Start waits in the background (`pending`, up to WAIT_MAX_MS; End / Close cancels)
 * for the X display AND for someone to wear the headset: WayVR answers its IPC (src/vr/wayvr-ipc.js) with a head pose
 * that moves (worn()). Then, on a fresh WayVR, it summons the overlays (show / hide puts WayVR's anchor 1 m in
 * front of the head; until then anchored panels sit at the play-space origin, under the operator's feet) and only
 * then opens MagicQ, so its panel spawns in view. Afterwards it checks over IPC that WayVR shows the window: a WayVR
 * that stops answering (27.10 it froze as MagicQ's window arrived mid presence-change) surfaces as `error`.
 *
 * MagicQ is started detached in its own process group; the group id is kept in ~/.highascg/run/vr-desk.json so a
 * node restart can still stop it. Stop: that group's MagicQ gets SIGTERM first (it saves its show), then WayVR —
 * SIGKILL to WayVR's process group (satellite + Xwayland) if it ignores the TERM (a frozen WayVR does). A MagicQ the
 * operator runs on the desktop is another group: never stopped, and Start refuses a second one.
 *
 * Licensing (ChamSys manual): MagicQ PC without ChamSys hardware runs in Demo Mode — fine for the panel; PSN input
 * and the ChamSys remote protocol need a MagicQ interface / Wing (WO-793).
 *
 * `createDeskPanel(deps)` takes injectable spawn / procScan / kill / fs / timers / ipc for the smoke test.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const WAYVR_DIR = path.join(os.homedir(), '.local/opt/wayvr')
const MAGICQ_RUN = '/opt/magicq/runmagicq.sh'
const STATE_FILE = path.join(os.homedir(), '.highascg/run/vr-desk.json')
const LOG_DIR = path.join(os.homedir(), '.highascg/log')
const WAIT_MAX_MS = 10 * 60 * 1000
const WAIT_POLL_MS = 1000
const POLL_MS = 250
const STOP_WAIT_MS = 5000
// --no-autostart: WayVR's own app autostart (set up in its dashboard) would start a second MagicQ.
// No --show: it fires 1 s after start, blind, while the headset may sit on the desk; the launch summons instead.
const WAYVR_ARGS = ['--openxr', '--headless', '--no-autostart', '--wait']
const IPC_TIMEOUT_MS = 2000
const SUMMON_SETTLE_MS = 1000
const PANEL_CHECK_MS = 15000
// Worn = the head pose moves: a headset lying on the desk is tracked still to well under a millimetre, a worn one
// sways by several. (WayVR answers its IPC right after start even with nobody in the headset — 27.10 14:12:20,
// WiVRn's "user presence" false since 14:06:38 — so an answer alone would summon to the desk.)
const HEAD_SAMPLES = 4
const HEAD_SAMPLE_MS = 400
const HEAD_MOVE_M = 0.004

/** Newest WayVR AppImage in `dir` (by name: WayVR-v26.8.0 sorts before WayVR-v26.10.0 numerically). */
function findWayvr(dir, readdir) {
	let names
	try {
		names = readdir(dir).filter((n) => /^WayVR-v[\d.]+-x86_64\.AppImage$/.test(n))
	} catch {
		return ''
	}
	names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
	return names.length ? path.join(dir, names[names.length - 1]) : ''
}

/** argv → which of ours it is: 'wayvr' (the AppImage or its mounted binary), 'satellite' (with its display), 'magicq'. */
function classify(argv) {
	const base = path.basename(String(argv[0] || ''))
	if (/^WayVR-v.*\.AppImage$/.test(base) || (base === 'wayvr' && /\.mount_WayVR/.test(argv[0]))) return { kind: 'wayvr' }
	if (base === 'xwayland-satellite' && /^:\d+$/.test(String(argv[1] || '')))
		return { kind: 'satellite', display: argv[1] }
	if (base === 'mqqt') return { kind: 'magicq' }
	return null
}

/** `/proc/<pid>/stat` → its process group (field 5, after the parenthesised name). */
function pgrpOf(stat) {
	const f = String(stat)
		.slice(String(stat).lastIndexOf(')') + 2)
		.split(' ')
	return Number(f[2]) || 0
}

/** Real /proc scan → [{ pid, pgid, kind, display? }]. */
function scanProc() {
	const out = []
	let names
	try {
		names = fs.readdirSync('/proc')
	} catch {
		return out
	}
	for (const n of names) {
		if (!/^\d+$/.test(n)) continue
		try {
			const argv = fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').split('\0').filter(Boolean)
			const c = argv.length ? classify(argv) : null
			if (c) out.push({ pid: Number(n), pgid: pgrpOf(fs.readFileSync(`/proc/${n}/stat`, 'utf8')), ...c })
		} catch {
			/* process gone */
		}
	}
	return out
}

function realSpawn(file, args, opts, logName) {
	const { spawn } = require('child_process')
	fs.mkdirSync(LOG_DIR, { recursive: true })
	const fd = fs.openSync(path.join(LOG_DIR, logName), 'a')
	const child = spawn(file, args, { ...opts, stdio: ['ignore', fd, fd], detached: true })
	child.on('error', () => {})
	child.unref()
	try {
		fs.closeSync(fd)
	} catch {
		/* ignore */
	}
	return child
}

/** @param {object} [deps] */
function createDeskPanel(deps = {}) {
	const uid = typeof deps.uid === 'number' ? deps.uid : process.getuid ? process.getuid() : 0
	const spawn = deps.spawn || realSpawn
	const procScan = deps.procScan || scanProc
	const kill = deps.kill || ((pid, sig) => process.kill(pid, sig))
	const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
	const now = deps.now || (() => Date.now())
	const exists = deps.exists || ((p) => fs.existsSync(p))
	const readdir = deps.readdir || ((d) => fs.readdirSync(d))
	const readState = deps.readState || (() => JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')))
	const writeState =
		deps.writeState ||
		((o) => {
			fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
			if (o) fs.writeFileSync(STATE_FILE, JSON.stringify(o))
			else fs.rmSync(STATE_FILE, { force: true })
		})
	const baseEnv = deps.env || process.env
	const getXAuth = deps.getXAuthority || (() => require('../utils/hardware-info').getXAuthority())
	const wayvrDir = deps.wayvrDir || WAYVR_DIR
	const magicqRun = deps.magicqRun || MAGICQ_RUN
	const ipc = deps.ipc || require('./wayvr-ipc')
	const stageMvr = deps.stageMvr || require('./magicq-mvr').stageMvrForMagicq

	let pending = null // the background wait's token while MagicQ waits for WayVR's X display
	let gen = 0 // bumped by stop(): a panel check still running for a stopped MagicQ reports nothing
	let pendingDone = Promise.resolve()
	let lastError = ''
	let mvr = '' // WO-796: the scene's MVR as MagicQ's File Manager lists it

	const sessionEnv = () => ({
		...baseEnv,
		XDG_RUNTIME_DIR: `/run/user/${uid}`,
		DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
	})
	const byKind = (list, kind) => list.filter((p) => p.kind === kind)
	const savedPgid = () => {
		try {
			const n = Number(readState().pgid)
			return n > 0 ? n : 0
		} catch {
			return 0
		}
	}

	function status() {
		const list = procScan()
		const wayvr = findWayvr(wayvrDir, readdir)
		const sat = byKind(list, 'satellite')[0]
		return {
			available: !!wayvr && exists(magicqRun),
			wayvr: wayvr ? path.basename(wayvr) : '',
			magicqInstalled: exists(magicqRun),
			wayvrRunning: byKind(list, 'wayvr').length > 0,
			display: sat ? sat.display : '',
			magicqRunning: byKind(list, 'magicq').some((p) => p.pgid && p.pgid === savedPgid()),
			magicqOnDesktop: byKind(list, 'magicq').some((p) => !(p.pgid && p.pgid === savedPgid())),
			pending: !!pending,
			mvr,
			error: lastError,
		}
	}

	const ourMagicq = (list) => {
		const pgid = savedPgid()
		return byKind(list, 'magicq').filter((p) => pgid && p.pgid === pgid)
	}

	function launchMagicq(display) {
		const env = { ...sessionEnv(), DISPLAY: display, QT_QPA_PLATFORM: 'xcb' }
		delete env.WAYLAND_DISPLAY
		delete env.XAUTHORITY
		const child = spawn(magicqRun, [], { env, cwd: path.dirname(magicqRun) }, 'magicq-vr.log')
		if (child && child.pid) writeState({ pgid: child.pid, display })
	}

	const answers = async (fn) => {
		try {
			return await fn({ timeoutMs: IPC_TIMEOUT_MS })
		} catch {
			return null
		}
	}

	/** Is someone wearing the headset? WayVR answers and the head pose moves over HEAD_SAMPLES × HEAD_SAMPLE_MS. */
	async function worn() {
		let first = null
		for (let i = 0; i < HEAD_SAMPLES; i++) {
			if (i) await sleep(HEAD_SAMPLE_MS)
			const s = await answers(ipc.inputState)
			const p = s && Array.isArray(s.hmd_pos) ? s.hmd_pos : null
			if (!p) return false
			first = first || p
			if (Math.hypot(p[0] - first[0], p[1] - first[1], p[2] - first[2]) > HEAD_MOVE_M) return true
		}
		return false
	}

	/**
	 * Background, unless cancelled: once WayVR's X display is up and someone wears the headset (worn()), summon the
	 * overlays (fresh WayVR only — show / hide is a toggle), open MagicQ, then check WayVR shows its window.
	 */
	async function waitAndLaunch(token, fresh) {
		const t0 = now()
		let sat = null
		while (pending === token) {
			sat = byKind(procScan(), 'satellite')[0]
			if (sat && (await worn()) && pending === token) break
			if (now() - t0 >= WAIT_MAX_MS) {
				pending = null
				lastError = sat
					? 'WayVR did not show in the headset — put the headset on, or Close MagicQ in VR and try again'
					: 'WayVR started no X display — is the headset connected, and the xwayland package installed?'
				return
			}
			await sleep(WAIT_POLL_MS)
		}
		if (pending !== token) return
		if (fresh) {
			await answers(ipc.showHide)
			await sleep(SUMMON_SETTLE_MS)
			if (pending !== token) return
		}
		pending = null
		launchMagicq(sat.display)
		const mine = gen
		const t1 = now()
		let answered = false
		while (now() - t1 < PANEL_CHECK_MS) {
			await sleep(WAIT_POLL_MS)
			const wins = await answers(ipc.windowList)
			if (wins && wins.length) return
			answered = answered || !!wins
		}
		if (mine !== gen) return
		lastError = answered
			? 'WayVR shows no MagicQ window — Close MagicQ in VR, then open it again'
			: 'WayVR stopped answering as MagicQ opened — Close MagicQ in VR, then open it again'
	}

	/** @param {{ serverRunning?: boolean }} [ctx] */
	async function start(ctx = {}) {
		lastError = ''
		const wayvr = findWayvr(wayvrDir, readdir)
		if (!wayvr) return fail(`WayVR is not installed (${wayvrDir}/WayVR-v*-x86_64.AppImage)`)
		if (!exists(magicqRun)) return fail(`MagicQ is not installed (${magicqRun})`)
		if (ctx.serverRunning === false) return fail('Start the VR session first')
		const list = procScan()
		if (ourMagicq(list).length || pending) return { ok: true, ...status() }
		if (byKind(list, 'magicq').length)
			return fail('MagicQ is already running on the desktop — close it first (one MagicQ per box)')
		try {
			mvr = (await stageMvr())?.name || ''
		} catch {
			mvr = '' // the rig file is a convenience: MagicQ opens without it
		}
		const fresh = !byKind(list, 'wayvr').length
		if (fresh) {
			const env = { ...sessionEnv(), DISPLAY: ':0', XAUTHORITY: getXAuth() }
			spawn(wayvr, WAYVR_ARGS, { env, cwd: path.dirname(wayvr) }, 'wayvr.log')
		}
		const token = {}
		pending = token
		pendingDone = waitAndLaunch(token, fresh).catch((e) => {
			if (pending === token) pending = null
			lastError = e.message || String(e)
		})
		return { ok: true, ...status() }
	}

	function fail(msg) {
		lastError = msg
		return { ok: false, error: msg, ...status() }
	}

	const signal = (pid, sig) => {
		try {
			kill(pid, sig)
		} catch {
			/* gone */
		}
	}

	/** TERM, wait up to STOP_WAIT_MS for `left()` to empty, then KILL what is left. */
	async function termThenKill(procs, left, killOne) {
		for (const p of procs) signal(p.pid, 'SIGTERM')
		const t0 = now()
		while (left().length && now() - t0 < STOP_WAIT_MS) await sleep(POLL_MS)
		for (const p of left()) killOne(p)
	}

	/**
	 * Our MagicQ first (TERM → it saves), then WayVR (its X display goes with it). A WayVR that ignores the TERM
	 * (frozen) is KILLed with its process group (satellite, Xwayland) when it leads one — ours always does (detached).
	 */
	async function stop() {
		pending = null
		gen++
		const pgid = savedPgid()
		const ours = () => (pgid ? byKind(procScan(), 'magicq').filter((p) => p.pgid === pgid) : [])
		await termThenKill(ours(), ours, (p) => signal(p.pid, 'SIGKILL'))
		writeState(null)
		const wayvrs = () => byKind(procScan(), 'wayvr')
		await termThenKill(wayvrs(), wayvrs, (p) => signal(p.pgid === p.pid ? -p.pgid : p.pid, 'SIGKILL'))
		lastError = ''
		return { ok: true, ...status() }
	}

	return { status, start, stop, _settled: () => pendingDone }
}

module.exports = { createDeskPanel, classify, findWayvr, pgrpOf, instance: createDeskPanel() }
