/**
 * operator-helper-window.js — WO-283: let the operator open a foreign window (DeckLink setup,
 * nvidia-settings, file manager, a plain browser) ON TOP of the shaped kiosk, on request, without
 * weakening the WO-255/WO-262/WO-263 shaped-video contract.
 *
 * WHY A PLAIN RAISE IS NOT ENOUGH (measured on this box, 2026-07-19, read-only X queries):
 *   $ xprop -id 31457325 _NET_WM_STATE
 *     _NET_WM_STATE(ATOM) = _NET_WM_STATE_FULLSCREEN, _NET_WM_STATE_ABOVE
 * The kiosk client permanently carries `_NET_WM_STATE_ABOVE` — tools/runtime/operator-shape-
 * overlay.py's `lock_window_above()` sets it on every `apply_holes()` and that is what stops a
 * click routed through a bounding hole from letting Openbox raise the Caspar consumer over the
 * GUI. Openbox stacks strictly by layer (below < normal < ABOVE < fullscreen) and clamps every
 * restack request to the window's own layer, so `xdotool windowraise`/`windowactivate` on a
 * NORMAL-layer helper can never put it over an ABOVE-layer kiosk. WO-283 option C therefore needs
 * two things the WO did not spell out:
 *
 *   1. PROMOTE THE HELPER INTO THE SAME LAYER — `xdotool windowstate --add ABOVE <wid>`. Once both
 *      windows are in the ABOVE layer, ordinary raise order decides, and the raise wins. The
 *      kiosk's own FULLSCREEN state promotes it to Openbox's fullscreen layer only while it is
 *      FOCUSED; giving the helper focus (`windowactivate`) drops the kiosk back to ABOVE. This is
 *      Openbox's designed "fullscreen yields when unfocused" behaviour, not a hack.
 *   2. SUSPEND THE OVERLAY'S TOP-ASSERT — `apply_holes()` ends with
 *      `toplevel.configure(stack_mode=X.Above)`, i.e. every new rects payload re-raises the kiosk
 *      to the top of the ABOVE layer and would bury the helper again. While a helper is open the
 *      overlay is told to skip that one call (see setOperatorShapeHelperOpen). The HOLES, the
 *      kiosk's `_NET_WM_STATE_ABOVE`, the Caspar consumer's input-dead lock and the pointer
 *      confinement are ALL left exactly as they are — nothing about the shaped-video contract is
 *      touched, and nothing changes until the operator presses the button.
 *
 * RESTORE-ON-CRASH. Requirement 2 of the WO: a helper that segfaults or is `kill -9`ed must not
 * strand the GUI with a suspended top-assert. Restore is therefore driven by a WATCHDOG POLL
 * (see decideRestoreOnExit) rather than only by a clean-close handler:
 *   - the direct child's 'exit' event is one input, not the trigger;
 *   - the poll independently asks "is a helper X window still mapped?", which also covers apps
 *     that fork and let the launcher exit immediately (thunar), and apps that die before ever
 *     mapping a window;
 *   - restore is idempotent (`restoreDone`) so exit + poll racing cannot double-restore.
 * Restore itself is unconditional cleanup: resume the overlay top-assert and re-activate the
 * kiosk. Both are the identical operations the boot path already performs, so "restore" and
 * "steady state" are the same code.
 *
 * Every transition is logged with the `[Operator helper]` tag so a stuck state is readable
 * straight out of the journal (WO-283 requirement 4).
 */

'use strict'

const { swallow } = require('../utils/swallow')

/** The operator kiosk forces this marker into its window title (client/lib/operator-gui-mode.js's
 * OPERATOR_GUI_TITLE_MARKER; the shape helper matches on the same string). The 'firefox' helper is
 * the SAME binary as the kiosk and therefore has an identical WM_CLASS — the title is the ONLY way
 * to keep the kiosk out of the helper's window lookup. Without this the watchdog would see a
 * "helper" window forever and never restore, and the promote would set ABOVE on the kiosk itself. */
const OPERATOR_TITLE_MARKER = 'HIGHASCG-OPERATOR-GUI'

/** Helper actions the operator may raise over the kiosk. Same vocabulary as
 * `/api/system/gui-launch` (src/api/system-hardware-gui.js) — this module adds the stacking, it
 * does not invent a second launcher. @readonly */
const HELPER_ACTIONS = /** @type {const} */ ([
	'nvidia-settings',
	'desktopvideo_setup',
	'desktop_video_updater',
	'firefox',
	'file-manager',
])

/** @readonly */
const STATE = /** @type {const} */ ({
	IDLE: 'idle',
	OPENING: 'opening',
	OPEN: 'open',
	RESTORING: 'restoring',
})

/** Watchdog cadence. 8 ticks * 750ms = 6s for a helper to map its first window before we treat it
 * as dead — nvidia-settings and the DeckLink setup GUI are slow starters on this box. @readonly */
const WATCHDOG_INTERVAL_MS = 750
const WATCHDOG_APPEAR_TICKS = 8

/* ------------------------------------------------------------------------------------------- *
 * PURE LOGIC (offline-tested: tools/smoke/smoke-wo283-operator-helper-window.test.js)
 * ------------------------------------------------------------------------------------------- */

/**
 * PURE. The idle → opening → open → restoring → idle state machine, plus the side effects each
 * transition owes. Unknown events are refused rather than silently ignored, so a double-press or a
 * late exit callback can never desync the real X state from `state`.
 *
 * @param {string} state current state (one of STATE)
 * @param {string} event one of: open_requested | window_raised | launch_failed | close_requested |
 *                       helper_gone | restore_done
 * @returns {{ state: string, actions: string[], ok: boolean, reason?: string }}
 *   `actions` are the side effects the caller must run, in order:
 *     suspend_kiosk_top | spawn_helper | promote_helper | resume_kiosk_top | reactivate_kiosk
 */
function nextHelperState(state, event) {
	switch (event) {
		case 'open_requested':
			// Refuse rather than stack a second helper: two helpers would race the same restore.
			if (state !== STATE.IDLE) return { state, actions: [], ok: false, reason: `busy_${state}` }
			return { state: STATE.OPENING, actions: ['suspend_kiosk_top', 'spawn_helper'], ok: true }

		case 'window_raised':
			if (state !== STATE.OPENING) return { state, actions: [], ok: false, reason: `not_opening_${state}` }
			return { state: STATE.OPEN, actions: ['promote_helper'], ok: true }

		case 'launch_failed':
			// The spawn threw — undo the suspend immediately, the kiosk must not stay demoted.
			if (state !== STATE.OPENING) return { state, actions: [], ok: false, reason: `not_opening_${state}` }
			return { state: STATE.RESTORING, actions: ['resume_kiosk_top', 'reactivate_kiosk'], ok: true }

		case 'close_requested':
		case 'helper_gone':
			// Accepted from OPENING too: a helper can die before it ever maps a window.
			if (state !== STATE.OPENING && state !== STATE.OPEN)
				return { state, actions: [], ok: false, reason: `not_open_${state}` }
			return { state: STATE.RESTORING, actions: ['resume_kiosk_top', 'reactivate_kiosk'], ok: true }

		case 'restore_done':
			if (state !== STATE.RESTORING) return { state, actions: [], ok: false, reason: `not_restoring_${state}` }
			return { state: STATE.IDLE, actions: [], ok: true }

		default:
			return { state, actions: [], ok: false, reason: `unknown_event_${event}` }
	}
}

/**
 * PURE. The restore-on-crash decision, evaluated once per watchdog tick. Deliberately NOT "the
 * child process exited" — that alone is both too eager (thunar forks and the launcher exits while
 * the window lives on) and too lax (a `kill -9`ed app whose exit event we missed). The mapped X
 * window is the ground truth; the child exit only decides how fast we trust its absence.
 *
 * @param {{ state: string, childExited: boolean, windowPresent: boolean, everSawWindow: boolean,
 *           restoreDone: boolean, ticks: number, maxAppearTicks?: number }} s
 * @returns {{ restore: boolean, reason: string }}
 */
function decideRestoreOnExit(s) {
	const maxAppearTicks = Number.isFinite(s.maxAppearTicks) ? Number(s.maxAppearTicks) : WATCHDOG_APPEAR_TICKS
	if (s.restoreDone) return { restore: false, reason: 'already_restored' }
	if (s.state !== STATE.OPENING && s.state !== STATE.OPEN) return { restore: false, reason: 'not_open' }
	// A live window outranks a dead child: the launcher/forking app is allowed to have exited.
	if (s.windowPresent) return { restore: false, reason: 'helper_window_alive' }
	if (s.everSawWindow) {
		return { restore: true, reason: s.childExited ? 'helper_closed' : 'helper_window_gone' }
	}
	// Never mapped anything. A dead child means it crashed on startup — restore now, do not make
	// the operator wait out the appear window for a helper that is already gone.
	if (s.childExited) return { restore: true, reason: 'helper_died_before_mapping' }
	if (s.ticks >= maxAppearTicks) return { restore: true, reason: 'helper_never_appeared' }
	return { restore: false, reason: 'waiting_for_window' }
}

/* ------------------------------------------------------------------------------------------- *
 * RUNTIME
 * ------------------------------------------------------------------------------------------- */

/** Single in-process session — one helper at a time (see nextHelperState's `busy_` refusal). */
const session = {
	state: STATE.IDLE,
	action: /** @type {string|null} */ (null),
	startedAt: /** @type {number|null} */ (null),
	childExited: false,
	everSawWindow: false,
	restoreDone: false,
	ticks: 0,
	/** @type {NodeJS.Timeout|null} */
	timer: null,
}

/** @param {Function} [log] @param {string} level @param {string} msg */
function say(log, level, msg) {
	try {
		log?.(level, `[Operator helper] ${msg}`)
	} catch (e) {
		swallow(e, { tag: 'operator-helper-window' })
	}
}

/** @returns {{ state: string, action: string|null, since: number|null }} */
function getOperatorHelperState() {
	return { state: session.state, action: session.action, since: session.startedAt }
}

function clearWatchdog() {
	if (session.timer) {
		clearInterval(session.timer)
		session.timer = null
	}
}

function resetSession() {
	clearWatchdog()
	session.state = STATE.IDLE
	session.action = null
	session.startedAt = null
	session.childExited = false
	session.everSawWindow = false
	session.restoreDone = false
	session.ticks = 0
}

/**
 * Suspend/resume the shape overlay's per-payload `stack_mode=X.Above` on the kiosk. The holes and
 * the kiosk's own `_NET_WM_STATE_ABOVE` are NOT touched — see the module header.
 * @param {boolean} open @param {Function} [log]
 */
function setKioskTopAssert(open, log) {
	try {
		const { setOperatorShapeHelperOpen } = require('./operator-shape-overlay')
		setOperatorShapeHelperOpen(open, { log })
		say(log, 'info', open ? 'kiosk lowered: shape-overlay top-assert SUSPENDED' : 'kiosk raised: shape-overlay top-assert RESUMED')
	} catch (e) {
		say(log, 'warn', `top-assert toggle failed (${e?.message || e})`)
	}
}

/**
 * Run the ordered side effects nextHelperState asked for.
 * @param {string[]} actions
 * @param {{ action: string, config: object, log?: Function, deps?: object }} ctx
 */
async function runActions(actions, ctx) {
	const log = ctx.log
	const deps = ctx.deps || {}
	for (const a of actions) {
		if (a === 'suspend_kiosk_top') {
			;(deps.setKioskTopAssert || setKioskTopAssert)(true, log)
		} else if (a === 'promote_helper') {
			const promote = deps.promoteGuiWindowsAboveKiosk || require('../utils/x-display-session').promoteGuiWindowsAboveKiosk
			const ok = await promote(ctx.action, ctx.config || {}, { log, excludeTitle: OPERATOR_TITLE_MARKER })
			say(log, ok ? 'info' : 'warn', `helper ${ctx.action}: promote above kiosk ${ok ? 'ok' : 'FAILED (no window matched)'}`)
		} else if (a === 'resume_kiosk_top') {
			;(deps.setKioskTopAssert || setKioskTopAssert)(false, log)
		} else if (a === 'reactivate_kiosk') {
			try {
				const raiseKiosk = deps.raiseOperatorGuiBrowser || require('./operator-gui-launcher').raiseOperatorGuiBrowser
				const r = await raiseKiosk({ config: ctx.config || {}, log })
				say(log, r?.ok ? 'info' : 'warn', `kiosk re-activated: ${r?.ok ? 'ok' : r?.reason || 'failed'}`)
			} catch (e) {
				say(log, 'warn', `kiosk re-activate threw (${e?.message || e})`)
			}
		}
	}
}

/**
 * Restore, exactly once, whatever killed the helper.
 * @param {string} reason @param {{ config: object, log?: Function, deps?: object }} ctx
 */
async function restoreNow(reason, ctx) {
	if (session.restoreDone) return
	const t = nextHelperState(session.state, 'helper_gone')
	if (!t.ok) return
	session.restoreDone = true
	session.state = t.state
	clearWatchdog()
	say(ctx.log, 'info', `restoring after ${reason} (helper=${session.action})`)
	await runActions(t.actions, { action: session.action || '', config: ctx.config, log: ctx.log, deps: ctx.deps })
	const done = nextHelperState(session.state, 'restore_done')
	say(ctx.log, 'info', `restored — state=${done.state}`)
	resetSession()
}

/**
 * Is a window for `action` still mapped? Ground truth for the watchdog.
 * @param {string} action @param {object} [deps]
 * @returns {Promise<boolean>}
 */
async function helperWindowPresent(action, deps = {}) {
	try {
		const find = deps.findGuiWindowIds || require('../utils/x-display-session').findGuiWindowIds
		const ids = await find(action, { excludeTitle: OPERATOR_TITLE_MARKER })
		return Array.isArray(ids) && ids.length > 0
	} catch {
		return false
	}
}

/**
 * Open a helper window over the kiosk (WO-283 option C). Returns as soon as the spawn is away; the
 * promote and the restore both run on the watchdog.
 * @param {string} action one of HELPER_ACTIONS
 * @param {object} config
 * @param {{ log?: Function, url?: string, deps?: object }} [opts]
 * @returns {Promise<{ ok: boolean, action?: string, reason?: string, state: string }>}
 */
async function openOperatorHelperWindow(action, config, opts = {}) {
	const log = opts.log
	const deps = opts.deps || {}
	if (!HELPER_ACTIONS.includes(/** @type {any} */ (action)))
		return { ok: false, reason: `unknown_action_${action}`, state: session.state }

	const t = nextHelperState(session.state, 'open_requested')
	if (!t.ok) {
		say(log, 'warn', `open ${action} REFUSED: ${t.reason}`)
		return { ok: false, reason: t.reason, state: session.state }
	}
	session.state = t.state
	session.action = action
	session.startedAt = Date.now()
	session.childExited = false
	session.everSawWindow = false
	session.restoreDone = false
	session.ticks = 0
	say(log, 'info', `open requested: ${action}`)

	// suspend_kiosk_top runs BEFORE the spawn so the helper never maps under a re-raising kiosk.
	await runActions(t.actions.filter((a) => a !== 'spawn_helper'), { action, config, log, deps })

	try {
		const spawnGui = deps.spawnGuiDetached || require('../api/system-hardware-gui').spawnGuiDetached
		const exe = spawnGui(action, {
			config,
			log,
			url: opts.url,
			// The direct child is ONE watchdog input, never the sole trigger — see decideRestoreOnExit.
			onSpawn: (child) => {
				try {
					child.on('exit', (code, sig) => {
						session.childExited = true
						say(log, 'info', `helper child exited code=${code} sig=${sig} (watchdog decides restore)`)
					})
				} catch (e) {
					swallow(e, { tag: 'operator-helper-window' })
				}
			},
		})
		say(log, 'info', `helper launched: ${action} exe=${exe}`)
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		say(log, 'warn', `helper launch FAILED: ${action}: ${msg}`)
		const f = nextHelperState(session.state, 'launch_failed')
		session.state = f.state
		session.restoreDone = true
		await runActions(f.actions, { action, config, log, deps })
		resetSession()
		return { ok: false, reason: msg, state: session.state }
	}

	startWatchdog({ config, log, deps })
	return { ok: true, action, state: session.state }
}

/**
 * One watchdog tick: sample the world, ask the pure decision, act.
 * @param {{ config: object, log?: Function, deps?: object }} ctx
 */
async function watchdogTick(ctx) {
	if (session.state !== STATE.OPENING && session.state !== STATE.OPEN) return
	session.ticks += 1
	const present = await helperWindowPresent(session.action || '', ctx.deps || {})
	if (present && !session.everSawWindow) {
		session.everSawWindow = true
		const t = nextHelperState(session.state, 'window_raised')
		if (t.ok) {
			session.state = t.state
			say(ctx.log, 'info', `helper window mapped: ${session.action} — raising above kiosk`)
			await runActions(t.actions, { action: session.action || '', config: ctx.config, log: ctx.log, deps: ctx.deps })
		}
	}
	const d = decideRestoreOnExit({
		state: session.state,
		childExited: session.childExited,
		windowPresent: present,
		everSawWindow: session.everSawWindow,
		restoreDone: session.restoreDone,
		ticks: session.ticks,
	})
	if (d.restore) await restoreNow(d.reason, ctx)
}

/** @param {{ config: object, log?: Function, deps?: object }} ctx */
function startWatchdog(ctx) {
	clearWatchdog()
	const interval = ctx.deps?.watchdogIntervalMs || WATCHDOG_INTERVAL_MS
	session.timer = setInterval(() => {
		watchdogTick(ctx).catch((e) => swallow(e, { tag: 'operator-helper-window' }))
	}, interval)
	if (typeof session.timer.unref === 'function') session.timer.unref()
}

/**
 * Operator pressed "done" (or the API was asked to close). The helper itself is left alone — the
 * operator closes its own window; this only guarantees the kiosk comes back.
 * @param {object} config @param {{ log?: Function, deps?: object }} [opts]
 */
async function closeOperatorHelperWindow(config, opts = {}) {
	if (session.state === STATE.IDLE) return { ok: true, state: STATE.IDLE, reason: 'already_idle' }
	await restoreNow('close requested', { config, log: opts.log, deps: opts.deps })
	return { ok: true, state: session.state }
}

module.exports = {
	// pure
	nextHelperState,
	decideRestoreOnExit,
	STATE,
	HELPER_ACTIONS,
	WATCHDOG_APPEAR_TICKS,
	// runtime
	openOperatorHelperWindow,
	closeOperatorHelperWindow,
	getOperatorHelperState,
}
