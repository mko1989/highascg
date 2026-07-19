/**
 * operator-shape-overlay.js — WO-255 T255.1 / WO-262 pivot: spawn/manage the python-xlib shape
 * helper (tools/runtime/operator-shape-overlay.py) that punches the reported preview rects as
 * HOLES in the operator_gui FIREFOX kiosk window, so the Caspar screen-consumer BELOW shows video
 * through them. (Inverted in WO-262 from the original "shape the always-on-top Caspar consumer"
 * design, which broke the moment the operator clicked: Firefox took focus and raised above the
 * video. Firefox is the window that must stay on top, so we hole IT instead.) This JS side only
 * spawns the helper and feeds it `{monitor, rects, channel}` over stdin — the targeting/shaping
 * all live in the python helper.
 *
 * Mirrors cef-interactive-bridge-lifecycle.js's spawn/stderr-log/exit-log pattern: spawn once with
 * `displaySessionEnv()`, pipe stdio, log stdout/stderr lines through `ctx.log`, null the process
 * ref on exit so the NEXT `updateShapeRects()` call transparently respawns (no retry storm — it's
 * lazy, driven by demand).
 *
 * Test/CI safety: never spawns when `NODE_TEST_CONTEXT` is set (the same env var
 * src/utils/persistence.js already relies on to detect a `node --test` child) — the curated gate
 * calls `applyOperatorGuiLayout()` directly against a fake `ctx.amcp`, and that must never shell
 * out to a real `python3` process. This is belt-and-suspenders on top of the natural gate (no
 * resolvable monitor rect in a config-only test fixture -> callers never even reach here).
 */
'use strict'

const path = require('path')
const { spawn } = require('child_process')
const { REPO_ROOT } = require('../repo-paths')
const { swallow } = require('../utils/swallow')
const { displaySessionEnv } = require('../utils/x-display-session')

const SHAPE_SCRIPT = path.join(REPO_ROOT, 'tools/runtime/operator-shape-overlay.py')

// URL-tied guard sent to the helper: it only shapes a Firefox whose window title carries this
// marker (the operator page forces it via client/lib/operator-gui-mode.js's OPERATOR_GUI_TITLE_MARKER).
// Stops the helper holing WO-258 browser-source firefoxes / any other browser. Keep all three in sync.
const OPERATOR_TITLE_MARKER = 'HIGHASCG-OPERATOR-GUI'

/** @type {import('child_process').ChildProcess | null} */
let proc = null
/** Last-known {monitor, rects} sent — re-sent verbatim by {@link reapplyOperatorShapeOverlay} on
 * Caspar reconnect (a fresh consumer window has no custom shape yet) and after a lazy respawn. */
let lastMonitor = null
let lastRects = null
let lastChannel = null
let lastLog = null
/** WO-269: last stdin line actually written — identical re-applies are skipped while the helper
 * lives, so draw-loop re-reports can't flood the helper log. */
let _lastWrittenPayload = null

/** @returns {boolean} helper process currently alive */
function isRunning() {
	return !!(proc && proc.stdin && !proc.stdin.destroyed)
}

function isTestContext() {
	return !!process.env.NODE_TEST_CONTEXT
}

function ensureSpawned(log) {
	if (proc) return proc
	if (isTestContext()) return null
	const fs = require('fs')
	if (!fs.existsSync(SHAPE_SCRIPT)) {
		log?.('warn', `[Shape overlay] missing ${SHAPE_SCRIPT}`)
		return null
	}
	const env = displaySessionEnv()
	const child = spawn('python3', ['-u', SHAPE_SCRIPT], { env, stdio: ['pipe', 'pipe', 'pipe'] })
	child.stdout.on('data', (chunk) => {
		const t = String(chunk).trim()
		if (t) log?.('info', `[Shape overlay] ${t}`)
	})
	child.stderr.on('data', (chunk) => {
		const t = String(chunk).trim()
		if (t) log?.('warn', `[Shape overlay] ${t}`)
	})
	child.on('exit', (code, sig) => {
		log?.('warn', `[Shape overlay] exited code=${code} sig=${sig}`)
		if (proc === child) proc = null
	})
	proc = child
	log?.('info', '[Shape overlay] started')
	return proc
}

/**
 * Send `{ monitor, rects, channel }` as one JSON line to the helper's stdin, spawning (or
 * respawning after an unexpected exit) it first. Caches the payload so
 * {@link reapplyOperatorShapeOverlay} can re-send it without a fresh layout apply.
 * `channel` is carried for protocol compatibility but is no longer used to match the target window
 * (WO-262: the helper now matches the FIREFOX kiosk by WM_CLASS, not the Caspar consumer by title).
 * @param {{x: number, y: number, w: number, h: number}} monitorRect - ROOT/absolute pixels
 * @param {Array<[number, number, number, number]>} rectsPx - monitor-relative pixel rects; empty -> restore Firefox unshaped (fill holes)
 * @param {{ log?: Function, channel?: number|null, force?: boolean }} [opts] - force bypasses the WO-269 identical-payload skip
 */
function updateShapeRects(monitorRect, rectsPx, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : lastLog
	lastLog = log || lastLog
	if (!monitorRect || !(monitorRect.w > 0) || !(monitorRect.h > 0)) return
	lastMonitor = monitorRect
	lastRects = Array.isArray(rectsPx) ? rectsPx : []
	if (Number.isFinite(Number(opts.channel))) lastChannel = Number(opts.channel)
	const alreadyRunning = isRunning()
	const p = ensureSpawned(log)
	if (!p || !p.stdin || p.stdin.destroyed) return
	const payload = JSON.stringify({
		monitor: { x: monitorRect.x, y: monitorRect.y, w: monitorRect.w, h: monitorRect.h },
		rects: lastRects,
		channel: lastChannel,
		titleMarker: OPERATOR_TITLE_MARKER,
	})
	// WO-269: preview draw loops re-apply identical layouts continuously — skip the write (and
	// the helper's per-line log) when nothing changed AND the helper was already alive (a fresh
	// spawn must always receive the current payload). `opts.force` (reapply path) bypasses.
	if (!opts.force && alreadyRunning && payload === _lastWrittenPayload) return
	try {
		p.stdin.write(payload + '\n')
		_lastWrittenPayload = payload
	} catch (e) {
		_lastWrittenPayload = null
		swallow(e, { tag: 'operator-shape-overlay' })
	}
}

/**
 * WO-255 T255.2: "re-feed the shape helper ... on Caspar reconnect" — a Caspar restart spawns a
 * brand-new screen-consumer window id with no custom shape, and the helper's own 2s poll will find
 * it, but re-sending the last-known payload here is a cheap way to also (re)spawn the helper itself
 * if it wasn't running yet (e.g. first boot, before any client ever POSTed cell rects). No-op when
 * nothing has ever been applied.
 * @param {{ log?: Function }} [opts]
 */
function reapplyOperatorShapeOverlay(opts = {}) {
	if (lastMonitor == null) return
	// force: a reconnect means a new consumer window — the helper must re-shape even if the
	// payload is byte-identical to the last one (WO-269 dedupe would otherwise skip it).
	updateShapeRects(lastMonitor, lastRects || [], { ...opts, force: true })
}

/** Stop the helper (SIGTERM — the python side cleans up its own shape state on stdin EOF/SIGTERM,
 * see operator-shape-overlay.py's `finally` block). Hooked from src/bootstrap/shutdown.js. */
function stopOperatorShapeOverlay() {
	if (proc) {
		try {
			proc.kill('SIGTERM')
		} catch (err) {
			swallow(err, { tag: 'operator-shape-overlay' })
		}
		proc = null
	}
	lastMonitor = null
	lastRects = null
	_lastWrittenPayload = null
}

module.exports = {
	updateShapeRects,
	reapplyOperatorShapeOverlay,
	stopOperatorShapeOverlay,
}
