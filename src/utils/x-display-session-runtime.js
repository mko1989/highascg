'use strict'

const { execFile } = require('child_process')
const { promisify } = require('util')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const { resolveGlSyncDisplay } = require('./caspar-gl-sync-env')
const {
	resolveNvidiaXApplyScript,
	buildNvidiaDisplayPolicyShellLines,
	applyNvidiaDisplayPolicy,
} = require('./nvidia-display-policy')
const {
	isOperatorPointerConfineDesired,
	resolveOperatorMonitorRect,
} = require('./x-display-session-layout')
const {
	displaySessionEnv,
	lookupCommandPath,
	commandExists,
	resolveConfineCursorScript,
	resolveConfineBarriersScript,
	resolveXdotoolBin,
} = require('./x-display-session-runtime-env')
const {
	parkPointerOnOperatorDisplay,
	findGuiWindowIds,
	raiseOperatorGuiWindows,
	resolveWindowAbovePromoter,
	promoteGuiWindowsAboveKiosk,
	positionGuiWindowForAction,
	scheduleGuiWindowPosition,
} = require('./x-display-session-gui-windows')

const execFileAsync = promisify(execFile)

/**
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {string[]}
 */
function buildConfineCursorShellLines(config, layout) {
	if (!isOperatorPointerConfineDesired(config)) {
		return [
			"pkill -f 'confine-pointer-barriers.py' 2>/dev/null || true",
			"pkill -f 'confine-cursor.py' 2>/dev/null || true",
		]
	}
	const rect = resolveOperatorMonitorRect(config, layout)
	if (!rect?.sysId || !/^[A-Za-z0-9._-]+$/.test(rect.sysId)) return []
	const barrierScript = resolveConfineBarriersScript()
	return [
		'# Operator monitor: XFixes pointer barriers (Caspar-safe; no XGrabPointer)',
		"pkill -f 'confine-pointer-barriers.py' 2>/dev/null || true",
		"pkill -f 'confine-cursor.py' 2>/dev/null || true",
		...(barrierScript
			? [
					`if command -v python3 >/dev/null 2>&1 && [ -f '${barrierScript.replace(/'/g, `'\\''`)}' ]; then`,
					`  nohup python3 '${barrierScript.replace(/'/g, `'\\''`)}' '${String(rect.sysId).replace(/'/g, `'\\''`)}' >>"$HOME/.highascg/log/confine-pointer-barriers.log" 2>&1 &`,
					'fi',
				]
			: []),
		'# WO-568: operator monitor is set — kill unclutter so the cursor stays visible',
		'pkill -x unclutter 2>/dev/null || true',
	]
}

/**
 * The NVIDIA policy's sync head (XVideoSyncToDisplayID) — WO-888: the SAME display caspar's GL swaps gate on
 * (caspar-gl-sync-env.js: the ticked port unless it is the operator monitor, else the first PGM screen), so both
 * stick to PGM automatically; before, no tick meant no NVIDIA target at all.
 * @param {object} config
 * @returns {string|null}
 */
function resolveNvidiaSyncToDisplayOutput(config) {
	const sysId = String(resolveGlSyncDisplay(config) || '').trim()
	if (!sysId || !/^[A-Za-z0-9._-]+$/.test(sysId)) return null
	return sysId
}

/**
 * Shell lines appended to apply-layout.sh (primary head, mouse, NVIDIA vsync policy).
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {string[]}
 */
function buildOperatorDisplaySessionShellLines(config, layout) {
	const lines = []
	const confineDesired = isOperatorPointerConfineDesired(config)
	if (confineDesired) {
		const rect = resolveOperatorMonitorRect(config, layout)
		if (rect) {
			if (rect.sysId && /^[A-Za-z0-9._-]+$/.test(rect.sysId)) {
				lines.push(`xrandr --output ${rect.sysId} --primary`)
			}
			const cx = rect.x + Math.floor(rect.width / 2)
			const cy = rect.y + Math.floor(rect.height / 2)
			// WO-805: no --sync — it waits for a pointer MOTION, so a pointer already at the target never returns.
			lines.push(
				'if command -v xdotool >/dev/null 2>&1; then',
				`  xdotool mousemove ${cx} ${cy} 2>/dev/null || true`,
				'fi',
			)
		}
	}
	lines.push(...buildConfineCursorShellLines(config, layout))
	const syncOut = resolveNvidiaSyncToDisplayOutput(config)
	if (syncOut) {
		lines.push(`export HIGHASCG_NVIDIA_SYNC_OUTPUT='${syncOut.replace(/'/g, `'\\''`)}'`)
	}
	lines.push(...buildNvidiaDisplayPolicyShellLines())
	return lines
}

/**
 * Env for the NVIDIA policy script: the X session env plus HIGHASCG_NVIDIA_SYNC_OUTPUT when a port is ticked
 * "NVIDIA sync to display" (WO-805: the Apply's deferred run needs it too — it used to get the bare env).
 * @param {object} config
 * @param {NodeJS.ProcessEnv} [env]
 */
function nvidiaPolicyEnv(config, env = displaySessionEnv()) {
	const syncOut = resolveNvidiaSyncToDisplayOutput(config)
	return syncOut ? { ...env, HIGHASCG_NVIDIA_SYNC_OUTPUT: syncOut } : env
}

/**
 * Apply operator display session live (after xrandr layout).
 * `skipNvidia` (WO-805): the Caspar-config Apply runs the NVIDIA policy once, after the Caspar restart
 * (full-config-apply.js) — the blocking run here cost ~1.4 s of every Apply and was redone after the restart anyway.
 * @param {object} config
 * @param {{ log?: (level: string, msg: string) => void, layout?: object, skipNvidia?: boolean }} [opts]
 */
async function applyOperatorDisplaySession(config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const layout = opts.layout || calculateLayoutPositions(config)
	const confineDesired = isOperatorPointerConfineDesired(config)
	const rect = confineDesired ? resolveOperatorMonitorRect(config, layout) : null
	if (!confineDesired) {
		// WO-568: also restores unclutter (auto-hide) — the operator monitor exemption only
		// applies while an operator monitor is actually set.
		const { stopPointerConfine } = require('../system/pointer-confine')
		stopPointerConfine()
		log('info', '[X-Display] No operator monitor — skip primary/confine session')
	} else if (!rect) {
		log('info', '[X-Display] Operator monitor configured but no layout rect — skip primary/mouse session')
	}
	const env = displaySessionEnv()
	if (rect) {
		if (rect.sysId && /^[A-Za-z0-9._-]+$/.test(rect.sysId)) {
			try {
				await execFileAsync('xrandr', ['--display', ':0', '--output', rect.sysId, '--primary'], {
					env,
					timeout: 8000,
				})
				log('info', `[X-Display] Primary output → ${rect.sysId} (${rect.kind} ${rect.index} @ ${rect.x},${rect.y})`)
			} catch (e) {
				log('warn', `[X-Display] xrandr --primary ${rect.sysId} failed: ${e?.message || e}`)
			}
		}
		const cx = rect.x + Math.floor(rect.width / 2)
		const cy = rect.y + Math.floor(rect.height / 2)
		if (await commandExists('xdotool')) {
			try {
				// WO-805: no --sync — with the pointer already at (cx, cy) it waited out the full 5 s timeout
				// (journal 17-29.10: 4 Applies lost exactly 5 s here; reproduced on a private Xvfb). The warp request
				// itself is sent before xdotool exits; nothing after this reads the pointer position.
				await execFileAsync('xdotool', ['mousemove', String(cx), String(cy)], { env, timeout: 5000 })
				log('info', `[X-Display] Pointer → ${cx},${cy}`)
			} catch (e) {
				log('warn', `[X-Display] xdotool mousemove failed: ${e?.message || e}`)
			}
		}
	}
	if (confineDesired) {
		const { syncOperatorPointerConfine } = require('../system/pointer-confine')
		syncOperatorPointerConfine(config, { log, layout })
	}
	if (opts.skipNvidia === true) {
		log('info', '[X-Display] NVIDIA policy deferred until after the Caspar restart (WO-805)')
	} else if (await commandExists('nvidia-settings')) {
		const policyEnv = nvidiaPolicyEnv(config, env)
		const result = await applyNvidiaDisplayPolicy(policyEnv, { log })
		if (!result.ok && resolveNvidiaXApplyScript()) {
			// Script exists but first pass can race empty MetaMode after xrandr — one delayed retry.
			setTimeout(() => {
				applyNvidiaDisplayPolicy(policyEnv, { log, timeoutMs: 20_000 }).catch(() => {})
			}, 6000)
		}
	}
	return { ok: true, rect: rect || null, confineDesired }
}

module.exports = {
	resolveConfineCursorScript,
	resolveConfineBarriersScript,
	resolveXdotoolBin,
	buildConfineCursorShellLines,
	resolveNvidiaSyncToDisplayOutput,
	buildOperatorDisplaySessionShellLines,
	nvidiaPolicyEnv,
	applyOperatorDisplaySession,
	parkPointerOnOperatorDisplay,
	raiseOperatorGuiWindows,
	findGuiWindowIds,
	lookupCommandPath,
	resolveWindowAbovePromoter,
	promoteGuiWindowsAboveKiosk,
	positionGuiWindowForAction,
	scheduleGuiWindowPosition,
	displaySessionEnv,
}
