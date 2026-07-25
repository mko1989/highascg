'use strict'

const { execFile } = require('child_process')
const { promisify } = require('util')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const {
	resolveNvidiaXApplyScript,
	buildNvidiaDisplayPolicyShellLines,
	applyNvidiaDisplayPolicy,
} = require('./nvidia-display-policy')
const {
	isOperatorPointerConfineDesired,
	resolveOperatorMonitorRect,
	nvidiaSyncToDisplayPortIndex,
	readCasparSetting,
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
		'if command -v unclutter >/dev/null 2>&1; then',
		'  pgrep -x unclutter >/dev/null 2>&1 || unclutter -idle 2 -root &',
		'fi',
	]
}

/**
 * @param {object} config
 * @returns {string|null}
 */
function resolveNvidiaSyncToDisplayOutput(config) {
	const port = nvidiaSyncToDisplayPortIndex(config)
	if (!port) return null
	const sysId = String(readCasparSetting(config, `screen_${port}_system_id`) || '').trim()
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
			lines.push(
				'if command -v xdotool >/dev/null 2>&1; then',
				`  xdotool mousemove --sync ${cx} ${cy} 2>/dev/null || true`,
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
 * Apply operator display session live (after xrandr layout).
 * @param {object} config
 * @param {{ log?: (level: string, msg: string) => void, layout?: object }} [opts]
 */
async function applyOperatorDisplaySession(config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const layout = opts.layout || calculateLayoutPositions(config)
	const confineDesired = isOperatorPointerConfineDesired(config)
	const rect = confineDesired ? resolveOperatorMonitorRect(config, layout) : null
	if (!confineDesired) {
		const env = displaySessionEnv()
		await execFileAsync('pkill', ['-f', 'confine-cursor.py'], { env, timeout: 3000 }).catch(() => {})
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
				await execFileAsync('xdotool', ['mousemove', '--sync', String(cx), String(cy)], { env, timeout: 5000 })
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
	if (await commandExists('nvidia-settings')) {
		const syncOut = resolveNvidiaSyncToDisplayOutput(config)
		const policyEnv = syncOut ? { ...env, HIGHASCG_NVIDIA_SYNC_OUTPUT: syncOut } : env
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
