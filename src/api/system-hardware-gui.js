/**
 * Resolve paths for hardware GUI tools + detached spawn on :0 (WO-39).
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { checkNuclearPassword } = require('./routes-system-setup')
const { getXAuthority } = require('../utils/hardware-info')
const { resolveAlsamixer } = require('../audio/alsa-mixer')
const { applyNvidiaDisplayPolicy } = require('../utils/nvidia-display-policy')
const { getMediaIngestBasePath } = require('../media/local-media')
const { resolveHelperIcon } = require('./operator-helper-icon')
const {
	resolveOperatorFirefoxLauncher,
	resolveFirefox,
	resolveFileManager,
	resolveNvidiaSettings,
	resolveDesktopvideoSetup,
	resolveBmdUpdater,
} = require('./system-hardware-gui-resolve')

/**
 * @param {string} action
 * @param {{ card?: number, config?: object, log?: Function }} [opts]
 */
function spawnGuiDetached(action, opts = {}) {
	let bin = null
	/** @type {string[]} */
	let args = []
	/* WO-387: an `app:<desktop-id>` action is any application installed on this box. The command
	 * comes from the on-disk .desktop entry, never from the request — see
	 * src/utils/desktop-app-catalog-parse.js for the security model. Console tools (Terminal=true)
	 * come back already wrapped in the box's terminal emulator. */
	if (String(action || '').startsWith('app:')) {
		const { resolveAppLaunch, invalidateAppCatalog } = require('../utils/desktop-app-catalog')
		invalidateAppCatalog()
		const launch = resolveAppLaunch(action)
		if (!launch) throw new Error(`Not an installed application: ${action}`)
		bin = launch.bin
		args = launch.args
	} else if (action === 'nvidia-settings') bin = resolveNvidiaSettings()
	else if (action === 'desktopvideo_setup') bin = resolveDesktopvideoSetup()
	else if (action === 'desktop_video_updater') bin = resolveBmdUpdater()
	else if (action === 'alsamixer') {
		bin = resolveAlsamixer()
		const card = parseInt(String(opts.card ?? 0), 10)
		if (Number.isFinite(card) && card >= 0) args = ['-c', String(card)]
	} else if (action === 'firefox') {
		const startUrl = String(opts.url || 'about:blank').trim() || 'about:blank'
		const launcher = resolveOperatorFirefoxLauncher()
		if (launcher) {
			bin = launcher
			args = [startUrl]
		} else {
			bin = resolveFirefox()
			if (bin?.includes('/snap/')) {
				const { ensureOperatorSnapHome } = require('../system/operator-snap-home')
				const snapHome = ensureOperatorSnapHome({ log: opts.log })
				if (!snapHome.ok) throw new Error(snapHome.error)
			}
			args = [
				'-profile',
				path.join(process.env.HOME || '/home/casparcg', '.highascg', 'firefox-operator'),
				'-url',
				startUrl,
			]
		}
	} else if (action === 'file-manager') {
		const fm = resolveFileManager()
		if (fm) {
			bin = fm.bin
			const media = getMediaIngestBasePath(opts.config || {})
			args = [media]
		}
	}

	if (!bin || !fs.existsSync(bin)) {
		if (action === 'firefox') {
			throw new Error(
				'Firefox is not installed. Install the .deb: sudo apt install firefox-esr (Ubuntu: Mozilla Team PPA). Caspar CEF is separate.',
			)
		}
		if (action === 'file-manager') {
			throw new Error('File manager not installed (apt install thunar).')
		}
		if (action === 'desktopvideo_setup') {
			throw new Error(
				'Desktop Video Setup GUI not installed (desktopvideo-gui package is optional). Caspar decklink playout needs desktopvideo only when the card firmware is current.',
			)
		}
		if (action === 'desktop_video_updater') {
			throw new Error(
				'Desktop Video Updater GUI not installed (desktopvideo-gui package is optional).',
			)
		}
		throw new Error(`Launcher not installed or not on PATH (${action}).`)
	}

	const operatorHome = process.env.HOME || '/home/casparcg'
	const env = {
		...process.env,
		HOME: operatorHome,
		USER: process.env.USER || 'casparcg',
		DISPLAY: ':0',
		XAUTHORITY: getXAuthority(),
		MOZ_ENABLE_WAYLAND: '0',
		GDK_BACKEND: 'x11',
	}

	if (action === 'nvidia-settings') {
		void applyNvidiaDisplayPolicy(env, { log: opts.log })
	}

	const proc = spawn(bin, args, {
		env,
		detached: true,
		stdio: 'ignore',
	})
	// WO-283: hand the child to the caller BEFORE unref() so the operator-helper watchdog can
	// attach its 'exit' listener. unref() only drops the event-loop reference — 'exit' still fires
	// while the server lives — but the child ref is otherwise unreachable from here.
	if (typeof opts.onSpawn === 'function') {
		try {
			opts.onSpawn(proc)
		} catch (e) {
			opts.log?.('warn', `[GUI launch] onSpawn hook threw: ${e?.message || e}`)
		}
	}
	proc.unref()
	if (opts.config) {
		const { scheduleGuiWindowPosition } = require('../utils/x-display-session')
		scheduleGuiWindowPosition(action, opts.config, { log: opts.log })
	}
	return bin
}

/**
 * Spawn Firefox on operator :0 (deb firefox-esr preferred; optional launcher wrapper).
 * @param {string} url allow-listed https URL (caller must validate)
 * @param {{ log?: Function }} [opts]
 */
function spawnOperatorFirefox(url, opts = {}) {
	return spawnGuiDetached('firefox', { ...opts, url })
}

/**
 * @param {string} body
 * @param {*} ctx
 */
async function handlePointerConfinePost(body, ctx) {
	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }

	const b = parseBody(body)
	const enabled = b?.enabled === true || b?.enabled === 'true'
	const {
		startPointerConfine,
		stopPointerConfine,
		isPointerConfineActive,
	} = require('../system/pointer-confine')
	const log = (level, msg) => {
		if (typeof ctx.log === 'function') ctx.log(level, msg)
	}
	if (enabled) {
		const r = await startPointerConfine(ctx.config || {}, { log })
		if (!r.ok) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'No operator display (multiview or screen consumer) to confine pointer to.' }),
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, enabled: true, rect: r.rect }),
		}
	}
	stopPointerConfine()
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, enabled: false, active: isPointerConfineActive() }) }
}

/**
 * WO-283 — POST /api/system/operator-helper-window. Open a foreign window (DeckLink setup,
 * nvidia-settings, file manager, browser) ON TOP of the shaped operator kiosk, on operator
 * request, and guarantee the kiosk comes back when it closes or dies.
 *
 * This is `/api/system/gui-launch` plus stacking: the same `spawnGuiDetached` launcher, the same
 * nuclear-password gate, the same action vocabulary. The difference lives in
 * src/system/operator-helper-window.js — it suspends the shape overlay's kiosk top-assert, puts
 * the helper in Openbox's ABOVE layer so the raise can actually win, and runs a watchdog that
 * restores the kiosk on ANY helper exit (clean close, crash, or kill -9).
 *
 * `mode: 'close'` does not kill the helper — the operator closes their own window. It only forces
 * the restore, so a helper that somehow outlives its window can never strand the GUI.
 *
 * @param {string} body
 * @param {*} ctx
 */
async function handleOperatorHelperWindowPost(body, ctx) {
	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }

	const b = parseBody(body)
	const mode = String(b?.mode ?? 'open').trim() || 'open'
	const log = (level, msg) => {
		if (typeof ctx.log === 'function') ctx.log(level, msg)
	}
	const {
		openOperatorHelperWindow,
		closeOperatorHelperWindow,
		getOperatorHelperState,
		HELPER_ACTIONS,
		isHelperAction,
	} = require('../system/operator-helper-window')

	if (mode === 'close') {
		const r = await closeOperatorHelperWindow(ctx.config || {}, { log })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ...r, ...getOperatorHelperState() }) }
	}
	if (mode !== 'open') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Unknown mode: ${mode}` }) }
	}

	const action = String(b?.action ?? '').trim()
	if (!isHelperAction(action)) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: `Unknown action: ${action} (expected one of ${HELPER_ACTIONS.join(', ')}, or app:<id> for an installed application)`,
			}),
		}
	}
	const r = await openOperatorHelperWindow(action, ctx.config || {}, { log, url: b?.url })
	return {
		status: r.ok ? 200 : 409,
		headers: JSON_HEADERS,
		body: jsonBody(r.ok ? { ...r, ...getOperatorHelperState() } : { error: r.reason, ...getOperatorHelperState() }),
	}
}

/**
 * WO-317 — GET /api/system/operator-helper-taskbar. Returns the multi-helper taskbar model when the
 * feature is enabled, else `{ enabled: false }` so the client renders the WO-283 single button.
 */
/* todos27.07.26: taskbar chips show the real app icons; WO-387 extends that to every installed
 * app by resolving the .desktop `Icon=` through the standard icon directories. The five pinned
 * tools keep their exact hard-coded paths. Path safety and the candidate order live in
 * ./operator-helper-icon.js. */

/** GET /api/system/operator-helper-icon?action=<helper action> → the app's system icon. */
function handleOperatorHelperIconGet(query) {
	const action = String(query?.action || '')
	const icon = resolveHelperIcon(action)
	if (!icon) return { status: 404, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'icon not found' }) }
	try {
		return {
			status: 200,
			headers: { 'Content-Type': icon.contentType, 'Cache-Control': 'public, max-age=86400' },
			body: fs.readFileSync(icon.file),
		}
	} catch {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'icon not readable' }) }
	}
}

/**
 * WO-387 — GET /api/system/apps. The installed-application catalog behind the operator's "Open
 * window" menu: every launchable .desktop entry on the box, name + action only. Read-only and
 * unauthenticated like the other operator GET routes (the launch POST keeps the nuclear-password
 * gate); it discloses nothing an `ls /usr/share/applications` would not.
 */
function handleSystemAppsGet() {
	try {
		const { listAppsForMenu } = require('../utils/desktop-app-catalog')
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, apps: listAppsForMenu() }) }
	} catch (e) {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: false, apps: [], error: e?.message || String(e) }) }
	}
}

async function handleOperatorHelperTaskbarGet(ctx) {
	const { getHelperCoordinator, isMultiHelperTaskbarEnabled, reconcileHelperWindows } = require('../system/operator-helper-live')
	if (!isMultiHelperTaskbarEnabled(ctx?.config)) {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, enabled: false, helpers: [] }) }
	}
	const coord = getHelperCoordinator(ctx)
	/* todos27.07.26: the 1.5s client poll is the only signal a helper's window was closed by the
	 * operator — reconcile registry vs live windows here so chips never show ghosts. */
	try {
		await reconcileHelperWindows(ctx)
	} catch {
		/* reconcile is best-effort — never fail the poll */
	}
	const { HELPER_ACTIONS } = require('../system/operator-helper-window')
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, enabled: true, helpers: coord ? coord.taskbar() : [], actions: HELPER_ACTIONS }),
	}
}

/**
 * WO-317 — POST /api/system/operator-helper-taskbar. Body: { id, action?, password }. Runs the
 * coordinator's decide→plan→apply pipeline (launch / raise / park). Password-gated like the WO-283
 * helper POST. Returns 400 when the feature flag is off (the client should not have called it).
 */
async function handleOperatorHelperTaskbarPost(body, ctx) {
	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }

	const { getHelperCoordinator, isMultiHelperTaskbarEnabled } = require('../system/operator-helper-live')
	if (!isMultiHelperTaskbarEnabled(ctx?.config)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'multi-helper taskbar disabled' }) }
	}
	const coord = getHelperCoordinator(ctx)
	if (!coord) return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'coordinator unavailable' }) }

	const b = parseBody(body)
	const id = String(b?.id ?? '').trim()
	if (!id) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'id required' }) }
	const action = b?.action ? String(b.action).trim() : id
	/* WO-387: refuse an unknown action HERE rather than letting the coordinator register a helper
	 * that can never launch — a chip for a non-existent app would sit in 'launching' until the
	 * 20s poll gives up. Validation is the same gate the WO-283 path uses (pinned five + any
	 * installed app), so both routes share one vocabulary. */
	const { isHelperAction } = require('../system/operator-helper-window')
	if (!isHelperAction(action)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Unknown action: ${action}` }) }
	}
	const r = await coord.handleAction(id, { action })
	return {
		status: r.ok ? 200 : 409,
		headers: JSON_HEADERS,
		body: jsonBody({ ...r, helpers: coord.taskbar() }),
	}
}

/**
 * WO-283 — GET /api/system/operator-helper-window. Lets the operator button render "Close helper"
 * while one is up, and lets a stuck state be seen without reading the journal.
 */
function handleOperatorHelperWindowGet() {
	const { getOperatorHelperState, HELPER_ACTIONS } = require('../system/operator-helper-window')
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, ...getOperatorHelperState(), actions: HELPER_ACTIONS }),
	}
}

/**
 * @param {string} body
 * @param {*} ctx
 */
async function handleGuiLaunchPost(body, ctx) {
	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }

	const b = parseBody(body)
	const action = String(b?.action ?? '').trim()
	const okActions = /** @type {const} */ ([
		'nvidia-settings',
		'desktopvideo_setup',
		'desktop_video_updater',
		'alsamixer',
		'firefox',
		'file-manager',
	])
	if (!okActions.includes(/** @type {any} */ (action))) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: `Unknown action: ${action}` }),
		}
	}
	try {
		const card = b?.card != null ? parseInt(String(b.card), 10) : 0
		const log = (level, msg) => {
			if (typeof ctx.log === 'function') ctx.log(level, msg)
		}
		const guiOpts = {
			card: Number.isFinite(card) ? card : 0,
			config: ctx.config,
			log,
		}
		if (action === 'firefox' || action === 'file-manager') {
			const {
				raiseOperatorGuiWindows,
				parkPointerOnOperatorDisplay,
			} = require('../utils/x-display-session')
			const raised = await raiseOperatorGuiWindows(action, ctx.config || {}, { log })
			await parkPointerOnOperatorDisplay(ctx.config || {}, { log })
			if (raised) {
				return {
					status: 200,
					headers: JSON_HEADERS,
					body: jsonBody({ ok: true, action, raised: true, card: guiOpts.card }),
				}
			}
		}
		const exe = spawnGuiDetached(action, guiOpts)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, action, exe, card: guiOpts.card }) }
	} catch (e) {
		const m = e instanceof Error ? e.message : String(e)
		return {
			status: 502,
			headers: JSON_HEADERS,
			body: jsonBody({ error: m }),
		}
	}
}

module.exports = {
	resolveNvidiaSettings,
	resolveDesktopvideoSetup,
	resolveBmdUpdater,
	resolveFirefox,
	resolveOperatorFirefoxLauncher,
	resolveFileManager,
	spawnGuiDetached,
	spawnOperatorFirefox,
	handleGuiLaunchPost,
	handleOperatorHelperWindowPost,
	handleOperatorHelperWindowGet,
	handleOperatorHelperTaskbarGet,
	handleOperatorHelperIconGet,
	handleSystemAppsGet,
	handleOperatorHelperTaskbarPost,
	handlePointerConfinePost,
}
