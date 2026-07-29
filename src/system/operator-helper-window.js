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
 * WHY THE HELPER MUST NOT RELY ON STACKING TO STAY OFF PGM (regression found 2026-07-20). The same
 * day WO-283 landed, PGM screen consumers began defaulting to always-on-top, which puts them in the
 * SAME EWMH ABOVE layer the promote above uses. Once both windows are in one layer, raise order
 * decides — and the helper is deliberately raised and focused, so it wins over program output. The
 * protection is therefore GEOMETRIC, not stacking-based: `resolveHelperWindowRect()`
 * (src/utils/x-display-session-layout.js) sizes and positions the helper INSIDE the operator monitor
 * rect — the same `resolveOperatorMonitorRect` SSOT the kiosk launcher and pointer confinement use —
 * so it physically cannot overlap a program head. It also refuses to place when no operator monitor
 * is configured, instead of the old behaviour of falling back to `resolveOperatorDisplayRect()`,
 * whose documented last resort is the FIRST PGM SCREEN CONSUMER HEAD. Measured on this box: operator
 * GUI DP-5 1920x1080+3072+0, program DP-0 3072x1728+0+0 — different outputs, so the confinement is
 * total. Stacking is otherwise untouched, so operator-shape-overlay.py's separate pin of the
 * operator_gui consumer (BELOW the kiosk + input-dead) is not fought: that consumer is on the
 * operator head and is not program output.
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
const {
	STATE,
	WATCHDOG_INTERVAL_MS,
	WATCHDOG_APPEAR_TICKS,
	WATCHDOG_EARLY_EXIT_GRACE_TICKS,
	nextHelperState,
	decideRestoreOnExit,
	classifyHelperWindows,
} = require('./operator-helper-window-state')

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

/**
 * WO-387. Is this an action the operator may open? The five above keep their bespoke launch paths
 * (isolated Firefox profile, media-path file manager, NVIDIA display policy), and ANY app installed
 * on the box is additionally addressable as `app:<desktop-id>`.
 *
 * The catalog is re-read here rather than trusted from the request: this is the gate that keeps the
 * vocabulary "installed applications" and not "any command". An ID that no longer resolves to a
 * launchable .desktop entry — package removed between the menu render and the click — is refused
 * exactly like a made-up one.
 * @param {string} action
 * @returns {boolean}
 */
function isHelperAction(action) {
	if (HELPER_ACTIONS.includes(/** @type {any} */ (action))) return true
	try {
		return require('../utils/desktop-app-catalog').isAppAction(action)
	} catch {
		return false
	}
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
	/** Saw a "Close Firefox"/profile-in-use modal instead of a real window. */
	profileLocked: false,
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

/**
 * WO-387 — hand this single session over to a NEW helper.
 *
 * The session above tracks exactly one helper, and `open_requested` refuses while it is busy ("two
 * helpers would race the same restore"). That refusal is correct for the WO-283 single-helper
 * configuration and WRONG once the WO-317 taskbar is on: the coordinator is then the multi-helper
 * authority, and delegating launches through here capped the whole box at ONE open window — owner,
 * 29.07: *"when i have zoom open the open window button just shows zoom app is open and i cant open
 * anything else"*.
 *
 * Yielding is not "forget the helper": the previous helper stays in the coordinator's registry, its
 * chip stays live, and its window is reaped by `reconcileHelperWindows` on the taskbar poll instead
 * of by this watchdog. Only the single session — the thing that can track one helper at a time —
 * moves to the newcomer. Called ONLY from the coordinator's launch path, so the WO-283 refusal is
 * untouched when the taskbar is off.
 *
 * @param {string} reason
 * @param {Function} [log]
 * @returns {boolean} whether a session was actually handed over
 */
function yieldOperatorHelperSession(reason, log) {
	if (session.state === STATE.IDLE) return false
	say(log, 'info', `session yielded (was ${session.action} in ${session.state}) — ${reason}`)
	// Deliberately NOT a restore: the kiosk top-assert stays suspended because the incoming helper
	// suspends it again immediately, and the coordinator's refcount is the authority while the
	// taskbar is on. resetSession clears the old watchdog so it cannot restore under the newcomer.
	resetSession()
	return true
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
	session.profileLocked = false
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
	// WHY we gave up, in one greppable line — reason code, how long we actually waited, whether a
	// window was ever seen, whether the child died, and whether a profile-lock modal was involved.
	const waitedMs = session.startedAt ? Date.now() - session.startedAt : 0
	say(
		ctx.log,
		'info',
		`restoring after ${reason} (helper=${session.action} waited=${waitedMs}ms ticks=${session.ticks}/${WATCHDOG_APPEAR_TICKS} everSawWindow=${session.everSawWindow} childExited=${session.childExited} profileLocked=${session.profileLocked})`,
	)
	await runActions(t.actions, { action: session.action || '', config: ctx.config, log: ctx.log, deps: ctx.deps })
	const done = nextHelperState(session.state, 'restore_done')
	say(ctx.log, 'info', `restored — state=${done.state}`)
	resetSession()
	/* todos27.07.26: the kiosk is now re-asserted over everything — if the WO-317 taskbar
	 * coordinator is active, its raised helpers are effectively parked; tell it so the next
	 * chip click raises instead of double-parking. */
	try {
		require('./operator-helper-live').noteKioskRestored()
	} catch {
		/* taskbar feature absent — single-helper boxes */
	}
}

/**
 * Which windows for `action` are mapped right now? Ground truth for both the watchdog and the
 * reuse check. Normalises the two shapes findGuiWindowIds can return (bare ids, or `{id,name}` when
 * asked `withNames`) so an injected test double may return either.
 *
 * @param {string} action @param {object} [deps]
 * @returns {Promise<{ usable: {id:string,name:string}[], blocked: {id:string,name:string}[] }>}
 */
async function findHelperWindows(action, deps = {}) {
	try {
		const find = deps.findGuiWindowIds || require('../utils/x-display-session').findGuiWindowIds
		const found = await find(action, { excludeTitle: OPERATOR_TITLE_MARKER, withNames: true })
		return classifyHelperWindows(found)
	} catch {
		return { usable: [], blocked: [] }
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
	if (!isHelperAction(action)) return { ok: false, reason: `unknown_action_${action}`, state: session.state }

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
	session.profileLocked = false
	say(log, 'info', `open requested: ${action}`)

	// suspend_kiosk_top runs BEFORE the spawn so the helper never maps under a re-raising kiosk.
	await runActions(t.actions.filter((a) => a !== 'spawn_helper'), { action, config, log, deps })

	// REUSE BEFORE LAUNCH. If a helper of this kind is already up, promote THAT window instead of
	// starting a second process. This is the case the operator actually hit: a Firefox was already
	// running on the single fixed operator profile, so launching another produced a "Close Firefox"
	// modal and no browser window at all, and the open timed out. Reuse also matches what the
	// operator means by the button — "put the browser in front of me" — regardless of how it got
	// there. Nothing is spawned, so there is no child to watch; the watchdog falls straight through
	// to window-presence tracking and restores normally when the operator closes the window.
	const existing = await findHelperWindows(action, deps)
	if (existing.usable.length) {
		session.everSawWindow = true
		const reuse = nextHelperState(session.state, 'window_raised')
		if (reuse.ok) {
			session.state = reuse.state
			say(log, 'info', `reusing ${existing.usable.length} existing ${action} window(s) — no second process launched`)
			await runActions(reuse.actions, { action, config, log, deps })
			startWatchdog({ config, log, deps })
			return { ok: true, action, reused: true, state: session.state }
		}
	}
	if (existing.blocked.length) {
		// e.g. a leftover "Close Firefox" modal from an earlier failed attempt. Say so loudly — this
		// is the state that previously produced a silent 6s timeout and no explanation.
		say(log, 'warn', `${action}: profile-lock/error dialog already on screen (${existing.blocked.map((w) => w.name).join(', ')}) — it will be raised for dismissal`)
		session.profileLocked = true
	}

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
	const windows = await findHelperWindows(session.action || '', ctx.deps || {})
	// A profile-lock modal counts as "something is on screen" — the operator must be able to see and
	// dismiss it — but it is remembered separately so the give-up reason can name it.
	if (windows.blocked.length) session.profileLocked = true
	const present = windows.usable.length > 0 || windows.blocked.length > 0
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
		profileLocked: session.profileLocked,
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
	classifyHelperWindows,
	STATE,
	HELPER_ACTIONS,
	isHelperAction,
	WATCHDOG_APPEAR_TICKS,
	WATCHDOG_INTERVAL_MS,
	WATCHDOG_EARLY_EXIT_GRACE_TICKS,
	// runtime
	openOperatorHelperWindow,
	closeOperatorHelperWindow,
	getOperatorHelperState,
	yieldOperatorHelperSession,
}
