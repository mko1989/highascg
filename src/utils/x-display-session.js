'use strict'

const { execFile, spawn } = require('child_process')
const { promisify } = require('util')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const { getXAuthority } = require('./hardware-info')
const {
	resolveNvidiaXApplyScript,
	buildNvidiaDisplayPolicyShellLines,
	applyNvidiaDisplayPolicy,
} = require('./nvidia-display-policy')

const execFileAsync = promisify(execFile)

/**
 * @typedef {{ x: number, y: number, width: number, height: number, sysId: string|null, kind: 'multiview'|'screen', index: number }} OperatorDisplayRect
 */

function readCasparSetting(config, key) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	if (config && Object.prototype.hasOwnProperty.call(config, key)) return config[key]
	return undefined
}

function screenConsumerEnabled(config, n) {
	const v = readCasparSetting(config, `screen_${n}_screen_consumer`)
	return v !== false && v !== 'false' && v !== 0 && v !== '0'
}

function multiviewScreenConsumerEnabled(config) {
	const cs = config?.casparServer || config
	const mvOn = cs.multiview_enabled !== false && cs.multiview_enabled !== 'false'
	if (!mvOn) return false
	const { multiviewGeneratedConfigIncludesScreen } = require('../config/multiview-helpers')
	return multiviewGeneratedConfigIncludesScreen(cs)
}

/**
 * Operator-facing display: multiview screen consumer when enabled, else first PGM screen consumer head.
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {OperatorDisplayRect|null}
 */
function resolveOperatorDisplayRect(config, layout) {
	const plan = layout || calculateLayoutPositions(config)
	const mv = plan?.multiview?.[1]
	if (multiviewScreenConsumerEnabled(config) && mv && mv.width > 0 && mv.height > 0) {
		return {
			x: mv.x,
			y: mv.y,
			width: mv.width,
			height: mv.height,
			sysId: mv.sysId ? String(mv.sysId) : null,
			kind: 'multiview',
			index: 1,
		}
	}
	for (let n = 1; n <= 8; n++) {
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n)) continue
		return {
			x: sc.x,
			y: sc.y,
			width: sc.width,
			height: sc.height,
			sysId: sc.sysId ? String(sc.sysId) : null,
			kind: 'screen',
			index: n,
		}
	}
	return null
}

function displaySessionEnv() {
	return {
		...process.env,
		DISPLAY: ':0',
		XAUTHORITY: getXAuthority(),
	}
}

async function commandExists(bin) {
	try {
		await execFileAsync('/usr/bin/command', ['-v', bin], { timeout: 2000, env: displaySessionEnv() })
		return true
	} catch {
		return false
	}
}

/**
 * Shell lines appended to apply-layout.sh (primary head, mouse, NVIDIA vsync policy).
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {string[]}
 */
function buildOperatorDisplaySessionShellLines(config, layout) {
	const rect = resolveOperatorDisplayRect(config, layout)
	if (!rect) return []
	const lines = []
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
	const rect = resolveOperatorDisplayRect(config, layout)
	if (!rect) {
		log('info', '[X-Display] No multiview/screen consumer head — skip primary/mouse session')
		return { ok: false, reason: 'no_head' }
	}
	const env = displaySessionEnv()
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
	if (await commandExists('nvidia-settings')) {
		const result = await applyNvidiaDisplayPolicy(env, { log })
		if (!result.ok && resolveNvidiaXApplyScript()) {
			// Script exists but first pass can race empty MetaMode after xrandr — one delayed retry.
			setTimeout(() => {
				applyNvidiaDisplayPolicy(env, { log, timeoutMs: 20_000 }).catch(() => {})
			}, 6000)
		}
	}
	return { ok: true, rect }
}

/** @type {Record<string, string>} */
const GUI_WINDOW_CLASS = {
	'nvidia-settings': 'nvidia-settings',
	desktopvideo_setup: 'DesktopVideo',
	desktop_video_updater: 'DesktopVideo',
	alsamixer: 'Alsamixer',
}

/**
 * Move a spawned GUI tool onto the operator (multiview) head.
 * @param {string} action
 * @param {object} config
 * @param {{ log?: Function }} [opts]
 */
async function positionGuiWindowForAction(action, config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const rect = resolveOperatorDisplayRect(config)
	if (!rect) return false
	const winClass = GUI_WINDOW_CLASS[action]
	if (!winClass || !(await commandExists('xdotool'))) return false
	const env = displaySessionEnv()
	const x = rect.x + Math.max(0, Math.floor(rect.width * 0.05))
	const y = rect.y + Math.max(0, Math.floor(rect.height * 0.05))
	for (let attempt = 0; attempt < 8; attempt++) {
		await new Promise((r) => setTimeout(r, attempt === 0 ? 400 : 350))
		try {
			const { stdout } = await execFileAsync(
				'xdotool',
				['search', '--class', winClass, '--onlyvisible'],
				{ env, timeout: 3000 },
			)
			const ids = String(stdout || '')
				.trim()
				.split(/\s+/)
				.filter(Boolean)
			if (!ids.length) continue
			for (const wid of ids) {
				await execFileAsync('xdotool', ['windowmove', wid, String(x), String(y)], { env, timeout: 3000 })
				await execFileAsync('xdotool', ['windowactivate', wid], { env, timeout: 3000 }).catch(() => {})
			}
			log('info', `[X-Display] ${action} window → ${x},${y} (${rect.kind} head)`)
			return true
		} catch {
			/* retry until window appears */
		}
	}
	return false
}

/**
 * Schedule GUI reposition without blocking the HTTP handler.
 * @param {string} action
 * @param {object} config
 * @param {{ log?: Function }} [opts]
 */
function scheduleGuiWindowPosition(action, config, opts = {}) {
	setTimeout(() => {
		positionGuiWindowForAction(action, config, opts).catch(() => {})
	}, 0)
}

module.exports = {
	resolveOperatorDisplayRect,
	buildOperatorDisplaySessionShellLines,
	applyOperatorDisplaySession,
	positionGuiWindowForAction,
	scheduleGuiWindowPosition,
	displaySessionEnv,
}
