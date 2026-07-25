/**
 * operator-gui-launcher.js — WO-255 T255.2: launch/raise the fullscreen Firefox-ESR process that
 * hosts the operator GUI web page. Firefox runs 100% native (no CEF, no compositor) — the operator
 * GUI Caspar channel's screen consumer window sits shaped ABOVE it (operator-shape-overlay.js).
 *
 * WO-279 — xdotool window-match, corrected against the live box. Firefox-ESR here reports
 * `WM_CLASS(STRING) = "Navigator", "firefox-esr-esr140"`: "Navigator" is the *instance* (WM_CLASS
 * res_name, which `xdotool search --classname` searches) and "firefox-esr-esr140" is the *class*
 * (res_class, which `xdotool search --class` searches). The pre-WO-279 list tried
 * `--class Navigator` FIRST, which can never match — combined with `--sync` (blocks until a match)
 * that call was killed by its own 8s execFile timeout on every launch, so the first placement
 * attempt landed ~8s after spawn instead of as soon as the window mapped (journal 2026-07-20
 * 00:03:57.530 spawn -> 00:04:05.544 "kiosk window found +8014ms"). Matchers are now ordered
 * most-specific-first and `--sync` is gone: we poll on our own backoff schedule so a
 * non-matching pattern costs one short timeout, not the whole budget.
 *
 * WO-279 — placement is verified, not assumed. `--kiosk` Firefox holds
 * `_NET_WM_STATE_FULLSCREEN` (verified live via xprop on wid 0x1e0002d), and a fullscreen window's
 * geometry belongs to the WM: a single unverified `windowmove` can be silently dropped or undone
 * by Firefox's own kiosk/fullscreen transition, which is exactly the wrong-monitor symptom WO-279
 * was filed for. `placeKioskWindow` therefore moves, reads the resulting geometry back, and
 * retries with bounded backoff — escalating once to a FULLSCREEN off/move/on toggle, the standard
 * way to relocate a fullscreen window between monitors, using the xdotool already required here
 * rather than adding wmctrl.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { promisify } = require('util')
const { REPO_ROOT } = require('../repo-paths')
const { displaySessionEnv } = require('../utils/x-display-session')
const {
	resolveOperatorGuiChannel,
	resolveOperatorGuiChannelDims,
	DEFAULT_GUI_URL,
} = require('./operator-gui-channel')
const { writeOperatorGuiScalePref } = require('./operator-gui-scale')
const {
	XDOTOOL_WINDOW_MATCHERS,
	PLACEMENT_ATTEMPTS,
	WINDOW_WAIT_ATTEMPTS,
	placementAttemptDelays,
	parseXdotoolGeometry,
	geometryMatches,
	formatRect,
	resolveKioskMonitorRect,
	findFirefoxWindowIds,
	waitForFirefoxWindowIds,
	placeKioskWindow,
	positionFirefoxWindow,
	probeLaunchPhase,
	markLaunchSpawn,
} = require('./operator-gui-launcher-placement')

const execFileAsync = promisify(execFile)

const PROFILE_DIR = path.join(REPO_ROOT, '.operator-firefox-profile')
const FIREFOX_BINARIES = ['/usr/bin/firefox-esr', '/usr/bin/firefox']
const AUTO_LAUNCH_RETRIES = 5
const AUTO_LAUNCH_RETRY_MS = 10_000
// After a boot-time spawn, firefox that came up before X was ready exits within a couple of
// seconds — wait this long before trusting the pid as a successful launch.
const AUTO_LAUNCH_VERIFY_MS = 3000

/** @type {import('child_process').ChildProcess | null} */
let firefoxProc = null
let firefoxPid = null

function isRunning() {
	if (!firefoxPid) return false
	try {
		process.kill(firefoxPid, 0)
		return true
	} catch (_) {
		firefoxPid = null
		firefoxProc = null
		return false
	}
}

function resolveFirefoxBin() {
	for (const p of FIREFOX_BINARIES) {
		try {
			if (fs.statSync(p).isFile()) return p
		} catch (_) {
			/* try next candidate */
		}
	}
	return null
}

/**
 * @param {{ config: object, log?: Function }} ctx
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function raiseOperatorGuiBrowser(ctx) {
	const env = displaySessionEnv()
	const ids = await findFirefoxWindowIds(env)
	if (!ids.length) return { ok: false, reason: 'not_running' }
	const wid = ids[ids.length - 1]
	try {
		await execFileAsync('xdotool', ['windowactivate', wid], { env, timeout: SEARCH_TIMEOUT_MS })
		return { ok: true }
	} catch (e) {
		ctx?.log?.('warn', `[Operator GUI] raise failed: ${e?.message || e}`)
		return { ok: false, reason: 'xdotool_failed' }
	}
}

/**
 * POST /api/operator-gui/launch handler body. Raises the already-running instance instead of
 * spawning a second one (kiosk profiles are single-instance anyway — `--new-instance` just avoids
 * silently handing off to an unrelated already-running Firefox on the box).
 * @param {{ config: object, log?: Function }} ctx
 * @returns {Promise<{ ok: boolean, action?: 'launched'|'raised', pid?: number|null, reason?: string }>}
 */
async function launchOperatorGuiBrowser(ctx) {
	if (isRunning()) {
		const raised = await raiseOperatorGuiBrowser(ctx)
		return { ok: raised.ok, action: 'raised', pid: firefoxPid, reason: raised.reason }
	}

	const bin = resolveFirefoxBin()
	if (!bin) {
		ctx.log?.('warn', '[Operator GUI] launch: firefox-esr not installed')
		return { ok: false, reason: 'firefox_not_installed' }
	}

	const resolved = resolveOperatorGuiChannel(ctx.config)
	const guiUrl = resolved?.guiUrl || DEFAULT_GUI_URL

	try {
		fs.mkdirSync(PROFILE_DIR, { recursive: true })
	} catch (e) {
		ctx.log?.('warn', `[Operator GUI] launch: profile dir failed: ${e?.message || e}`)
		return { ok: false, reason: 'profile_dir_failed' }
	}

	// WO-310-ish (2026-07-21 report: "the gui has no scaling for 4k") — force Firefox's DPI-scale
	// pref to match the destination's resolution over the 1920x1080 CSS baseline, so buttons/text
	// read at a consistent physical size whether the operator_gui destination is 1080p or 2160p.
	const dims = resolveOperatorGuiChannelDims(ctx.config)
	const scaleRatio = writeOperatorGuiScalePref(PROFILE_DIR, dims, ctx.log)
	if (scaleRatio != null) {
		ctx.log?.('info', `[Operator GUI] launch: UI scale ${scaleRatio}x for ${dims?.width || '?'}x${dims?.height || '?'}`)
	}

	const env = displaySessionEnv()
	// child pid tracked below; a relaunch (isRunning() false — the old child already exited) simply
	// replaces the tracked proc/pid, no explicit kill needed.
	const child = spawn(bin, ['--kiosk', '--new-instance', '--profile', PROFILE_DIR, guiUrl], {
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	firefoxProc = child
	firefoxPid = child.pid
	markLaunchSpawn()
	probeLaunchPhase(ctx.log, 'kiosk spawned', `pid=${child.pid} bin=${bin}`)
	child.stdout.on('data', (chunk) => {
		const t = String(chunk).trim()
		if (t) ctx.log?.('info', `[Operator GUI firefox] ${t}`)
	})
	child.stderr.on('data', (chunk) => {
		const t = String(chunk).trim()
		if (t) ctx.log?.('info', `[Operator GUI firefox] ${t}`)
	})
	child.on('exit', (code, sig) => {
		ctx.log?.('warn', `[Operator GUI] firefox exited code=${code} sig=${sig}`)
		if (firefoxProc === child) {
			firefoxProc = null
			firefoxPid = null
		}
	})

	const monitorRect = resolveKioskMonitorRect(ctx.config)
	await positionFirefoxWindow(env, monitorRect, ctx.log)
	return { ok: true, action: 'launched', pid: firefoxPid }
}

/** @param {object} config @returns {object|null} the `operator_gui`-mode screen destination, if any */
function findOperatorGuiDestination(config) {
	const dests = config?.screenDestinations?.destinations
	if (!Array.isArray(dests)) return null
	return dests.find((d) => d && d.mode === 'operator_gui') || null
}

/**
 * WO-264 T264.1: pure boot-time auto-launch decision. Launch only when an operator_gui destination
 * is defined, its `autoLaunch` field (default true) isn't off, and a monitor resolves — an explicit
 * `physicalPort` on the destination counts (the generator honors it before the resolver, see
 * config-generator-operator-gui.js resolveOperatorGuiPort), otherwise resolveOperatorMonitorPort
 * decides. Mode 'none' (multiple displays, no screen_N_operator_monitor flag) deliberately does
 * NOT launch: guessing a monitor on a live multi-output box risks covering a program screen.
 * @param {object} config
 * @param {{ resolveMonitorPort?: (config: object) => { port: number|null, mode: string } }} [opts] injectable for offline tests
 * @returns {{ launch: boolean, reason: string }}
 */
function shouldAutoLaunchOperatorGui(config, opts = {}) {
	const dest = findOperatorGuiDestination(config)
	if (!dest) return { launch: false, reason: 'no_operator_gui_destination' }
	// WO-325: a headless operator GUI exists only to feed the remote NVENC stream — never spawn the
	// Firefox kiosk on a physical monitor for it (the generator also omits its <screen> consumer).
	if (dest.headless === true) return { launch: false, reason: 'headless' }
	if (dest.autoLaunch === false) return { launch: false, reason: 'auto_launch_disabled' }
	if (Number.isFinite(dest.physicalPort)) return { launch: true, reason: 'explicit_port' }
	const resolveMonitorPort =
		opts.resolveMonitorPort || require('../utils/operator-monitor-resolve').resolveOperatorMonitorPort
	const resolved = resolveMonitorPort(config) || {}
	if (resolved.mode === 'none') return { launch: false, reason: 'no_monitor_resolved' }
	return { launch: true, reason: String(resolved.mode || 'resolved') }
}

/** @type {Promise<void>|null} in-flight auto-launch retry loop (at most one) */
let autoLaunchChain = null

/** @type {Promise<void>|null} in-flight boot monitor picker (at most one, never re-prompts) */
let bootPickerChain = null

/**
 * True when any channel has a live look on air — the picker must never paint over program.
 * On a genuinely fresh boot this is empty; a box that rebooted mid-show restores its live state
 * before routing-setup runs, so that case refuses too.
 * @returns {boolean}
 */
function anyLiveLookOnAir() {
	try {
		const st = require('../state/live-scene-state').getAll()
		return Object.values(st || {}).some((e) => (e?.scene?.layers || []).length > 0)
	} catch (_) {
		return false
	}
}

/**
 * WO-290 boot call site (owner request, todos21.07.26): fresh multi-display boot with no operator
 * monitor chosen → full-screen "press this to run the operator GUI on this screen" prompt on every
 * output. Fire-and-forget; a successful click persists the flag via configManager and re-enters
 * maybeAutoLaunchOperatorGui, which now resolves the monitor and launches.
 * @param {{ config: object, configManager?: object, log?: Function }} ctx
 */
function maybeRunBootMonitorPicker(ctx) {
	if (bootPickerChain) return
	const log = typeof ctx?.log === 'function' ? ctx.log : () => {}
	bootPickerChain = (async () => {
		const { runOperatorMonitorPicker } = require('./operator-monitor-picker')
		const res = await runOperatorMonitorPicker({
			config: ctx.config,
			log,
			freshBoot: true,
			playoutActive: anyLiveLookOnAir(),
			persist: (next) => {
				try {
					if (!ctx.configManager?.save) return false
					ctx.configManager.save(next)
					if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
					return true
				} catch (e) {
					log('error', `[Operator monitor picker] persist failed: ${e?.message || e}`)
					return false
				}
			},
		})
		if (res?.ok) {
			log('info', `[Operator GUI] monitor picked (${res.output}, port ${res.port}) — launching`)
			maybeAutoLaunchOperatorGui(ctx)
		}
	})()
		.catch((e) => log('warn', `[Operator monitor picker] ${e?.message || e}`))
		.finally(() => {
			/* deliberately NOT reset: one prompt per process. An abandoned picker (Esc/timeout) must
			 * not re-appear on every reconnect — the operator said no; the inspector Launch button
			 * and Device View flag remain the manual paths. */
		})
}

/**
 * WO-264 T264.2: fire-and-forget boot/reconnect auto-launch. Never throws and never blocks the
 * caller (routing-setup awaits nothing here) — the retry loop covers the `:0` X session coming up
 * after highascg at boot. On reconnects the isRunning() guard makes this a no-op, matching the
 * manual Launch button's raise-instead-of-respawn semantics.
 * @param {{ config: object, log?: Function }} ctx
 */
function maybeAutoLaunchOperatorGui(ctx) {
	try {
		if (process.env.NODE_TEST_CONTEXT) return
		if (isRunning() || autoLaunchChain) return
		const verdict = shouldAutoLaunchOperatorGui(ctx.config)
		if (!verdict.launch) {
			ctx?.log?.('info', `[Operator GUI] auto-start skipped: ${verdict.reason}`)
			// Fresh multi-display boot: nothing chose a monitor yet. Paint the WO-290 "press this to
			// run the operator GUI on this screen" prompt on every connected output; a click persists
			// screen_N_operator_monitor and re-enters this function, which then launches normally.
			// Every WO-290 hard gate still applies inside (configured / pinned / on-air all refuse).
			if (verdict.reason === 'no_monitor_resolved') maybeRunBootMonitorPicker(ctx)
			return
		}
		autoLaunchChain = (async () => {
			for (let attempt = 1; attempt <= AUTO_LAUNCH_RETRIES; attempt++) {
				try {
					if (isRunning()) return
					const res = await launchOperatorGuiBrowser(ctx)
					if (res?.ok && res.action !== 'launched') return
					if (res?.ok) {
						await new Promise((r) => setTimeout(r, AUTO_LAUNCH_VERIFY_MS))
						if (isRunning()) {
							ctx?.log?.('info', `[Operator GUI] auto-started (attempt ${attempt}, ${verdict.reason})`)
							return
						}
						ctx?.log?.('info', `[Operator GUI] auto-start attempt ${attempt}/${AUTO_LAUNCH_RETRIES}: firefox exited right after spawn (display not ready?)`)
					} else {
						ctx?.log?.('info', `[Operator GUI] auto-start attempt ${attempt}/${AUTO_LAUNCH_RETRIES} failed: ${res?.reason || 'unknown'}`)
					}
				} catch (e) {
					ctx?.log?.('info', `[Operator GUI] auto-start attempt ${attempt}/${AUTO_LAUNCH_RETRIES} threw: ${e?.message || e}`)
				}
				if (attempt < AUTO_LAUNCH_RETRIES) await new Promise((r) => setTimeout(r, AUTO_LAUNCH_RETRY_MS))
			}
			ctx?.log?.('warn', `[Operator GUI] auto-start gave up after ${AUTO_LAUNCH_RETRIES} attempts — use the inspector Launch button`)
		})().finally(() => {
			autoLaunchChain = null
		})
	} catch (e) {
		ctx?.log?.('warn', `[Operator GUI] auto-start: ${e?.message || e}`)
	}
}

module.exports = {
	launchOperatorGuiBrowser,
	maybeRunBootMonitorPicker,
	anyLiveLookOnAir,
	raiseOperatorGuiBrowser,
	shouldAutoLaunchOperatorGui,
	maybeAutoLaunchOperatorGui,
	PROFILE_DIR,
	// WO-279: pure/injectable placement parts — exercised offline by
	// tools/smoke/smoke-wo279-operator-gui-monitor-placement.test.js (no live X server).
	XDOTOOL_WINDOW_MATCHERS,
	PLACEMENT_ATTEMPTS,
	WINDOW_WAIT_ATTEMPTS,
	placementAttemptDelays,
	parseXdotoolGeometry,
	geometryMatches,
	formatRect,
	resolveKioskMonitorRect,
	placeKioskWindow,
	waitForFirefoxWindowIds,
	positionFirefoxWindow,
}
