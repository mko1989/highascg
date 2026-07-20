/**
 * Resolve paths for hardware GUI tools + detached spawn on :0 (WO-39).
 */

'use strict'

const { lookupCommandPath } = require('../utils/which')

const fs = require('fs')
const path = require('path')
const { execFileSync, spawn } = require('child_process')

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { checkNuclearPassword } = require('./routes-system-setup')
const { getXAuthority } = require('../utils/hardware-info')
const { resolveAlsamixer } = require('../audio/alsa-mixer')
const { applyNvidiaDisplayPolicy } = require('../utils/nvidia-display-policy')
const { getMediaIngestBasePath } = require('../media/local-media')

/** Prefer .deb Firefox (eggs ISO); snap is legacy fallback only. @readonly */
const FIREFOX_BINARIES = ['/usr/bin/firefox-esr', '/usr/bin/firefox', '/snap/bin/firefox']

/** Dedicated :0 launcher (isolated profile; installed by 05-caspar-deps). @readonly */
const OPERATOR_FIREFOX_LAUNCHER = [
	'/usr/local/lib/highascg/highascg-launch-operator-firefox.sh',
	path.join(__dirname, '../../tools/runtime/highascg-launch-operator-firefox.sh'),
]
const FILE_MANAGER_BINARIES = [
	['/usr/bin/thunar', 'thunar'],
	['/usr/bin/pcmanfm', 'pcmanfm'],
	['/usr/bin/nautilus', 'nautilus'],
	['/usr/bin/dolphin', 'dolphin'],
]

/** @readonly */
const NVIDIA_SETTINGS_BINARIES = ['/usr/bin/nvidia-settings', '/usr/local/bin/nvidia-settings']

/**
 * @returns {string|null}
 */
function resolveOperatorFirefoxLauncher() {
	for (const launcher of OPERATOR_FIREFOX_LAUNCHER) {
		try {
			if (fs.existsSync(launcher)) return launcher
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * @returns {string|null}
 */
function resolveFirefox() {
	for (const bin of FIREFOX_BINARIES) {
		try {
			if (fs.existsSync(bin)) return bin
		} catch {
			/* ignore */
		}
	}
	for (const name of ['firefox-esr', 'firefox']) {
		try {
			const p =
				lookupCommandPath(name)
			if (p && !p.startsWith('/snap/')) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * @returns {{ bin: string, name: string } | null}
 */
function resolveFileManager() {
	for (const [bin, name] of FILE_MANAGER_BINARIES) {
		try {
			if (fs.existsSync(bin)) return { bin, name }
		} catch {
			/* ignore */
		}
	}
	for (const name of ['thunar', 'pcmanfm', 'nautilus', 'dolphin']) {
		try {
			const p =
				lookupCommandPath(name)
			if (p) return { bin: p, name }
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * @returns {string|null}
 */
function resolveNvidiaSettings() {
	for (const bin of NVIDIA_SETTINGS_BINARIES) {
		try {
			if (fs.existsSync(bin)) return bin
		} catch {
			/* ignore */
		}
	}
	try {
		const p =
			lookupCommandPath('nvidia-settings')
		return p || null
	} catch {
		return null
	}
}

/**
 * @returns {string|null}
 */
function resolveDesktopvideoSetup() {
	for (const name of ['desktopvideo_setup', 'BlackmagicDesktopVideoSetup']) {
		try {
			const p =
				lookupCommandPath(name)
			if (p) return p
		} catch {
			/* ignore */
		}
	}
	for (const p of [
		'/usr/bin/BlackmagicDesktopVideoSetup',
		'/usr/bin/desktopvideo_setup',
		'/usr/local/bin/desktopvideo_setup',
	]) {
		if (fs.existsSync(p)) return p
	}
	return null
}

/**
 * Blackmagic Desktop Video GUI updater heuristic (bundle layout varies).
 * @returns {string|null}
 */
function resolveBmdUpdater() {
	const candidates = []
	for (const pkg of ['desktopvideo-gui', 'desktopvideo']) {
		let out = ''
		try {
			out = execFileSync('dpkg', ['-L', pkg], { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 })
		} catch {
			continue
		}
		const lines = out.split('\n').map((s) => s.trim()).filter(Boolean)
		for (const line of lines) {
			if (!/^\/usr\/(s?bin)\//i.test(line)) continue
			try {
				const st = fs.statSync(line)
				if (!st.isFile() || !(st.mode & 0o111)) continue
			} catch {
				continue
			}
			const bn = path.basename(line).toLowerCase()
			const looksUpdater = bn.includes('updater') || bn.includes('installer')
			const looksBm = bn.includes('blackmagic') || bn.includes('desktopvideo')
			const looksFirmware = bn.includes('firmware')
			if ((looksBm && looksUpdater) || (looksFirmware && looksUpdater))
				candidates.push(line)
		}
	}
	return candidates.sort((a, b) => a.length - b.length)[0] || null
}

/**
 * @param {string} action
 * @param {{ card?: number, config?: object, log?: Function }} [opts]
 */
function spawnGuiDetached(action, opts = {}) {
	let bin = null
	/** @type {string[]} */
	let args = []
	if (action === 'nvidia-settings') bin = resolveNvidiaSettings()
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
	} = require('../system/operator-helper-window')

	if (mode === 'close') {
		const r = await closeOperatorHelperWindow(ctx.config || {}, { log })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ...r, ...getOperatorHelperState() }) }
	}
	if (mode !== 'open') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Unknown mode: ${mode}` }) }
	}

	const action = String(b?.action ?? '').trim()
	if (!HELPER_ACTIONS.includes(action)) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: `Unknown action: ${action} (expected one of ${HELPER_ACTIONS.join(', ')})` }),
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
	handlePointerConfinePost,
}
