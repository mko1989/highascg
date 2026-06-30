'use strict'

const fs = require('fs')
const path = require('path')
const { execFile, spawn } = require('child_process')
const { promisify } = require('util')
const { REPO_ROOT } = require('../repo-paths')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const {
	createDestinationWiringContext,
} = require('../config/device-graph-destination-wiring')
const {
	resolvePhysicalPortIndexForDestination,
} = require('../config/screen-consumer-port-resolve')
const { getXAuthority } = require('./hardware-info')
const {
	resolveNvidiaXApplyScript,
	buildNvidiaDisplayPolicyShellLines,
	applyNvidiaDisplayPolicy,
} = require('./nvidia-display-policy')

const execFileAsync = promisify(execFile)

/**
 * @typedef {{ x: number, y: number, width: number, height: number, sysId: string|null, kind: 'multiview'|'screen', index: number, interactive: boolean }} OperatorDisplayRect
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

function screenInteractiveEnabled(config, n) {
	const v = readCasparSetting(config, `screen_${n}_interactive`)
	return v === true || v === 'true'
}

function multiviewPhysicalPortIndex(config) {
	const ctx = createDestinationWiringContext(config || {})
	for (let i = 0; i < ctx.destinations.length; i++) {
		const dest = ctx.destinations[i]
		if (String(dest?.mode || '').toLowerCase() !== 'multiview') continue
		const port = resolvePhysicalPortIndexForDestination(dest, i, ctx)
		if (port) return port
	}
	return null
}

function multiviewInteractiveEnabled(config) {
	const v =
		readCasparSetting(config, 'multiview_1_interactive') ?? readCasparSetting(config, 'multiview_interactive')
	if (v === true || v === 'true') return true
	// Legacy: Device View stored interactive on screen_${port}_interactive for multiview GPU jacks.
	const port = multiviewPhysicalPortIndex(config)
	return !!(port && screenInteractiveEnabled(config, port))
}

function portFlagEnabled(config, key) {
	const v = readCasparSetting(config, key)
	return v === true || v === 'true'
}

/**
 * @param {object} config
 * @returns {number|null} 1-based physical GPU port index
 */
function operatorMonitorPortIndex(config) {
	for (let n = 1; n <= 4; n++) {
		if (portFlagEnabled(config, `screen_${n}_operator_monitor`)) return n
	}
	return null
}

/**
 * @param {object} config
 * @returns {number|null} 1-based physical GPU port index
 */
function nvidiaSyncToDisplayPortIndex(config) {
	for (let n = 1; n <= 4; n++) {
		if (portFlagEnabled(config, `screen_${n}_nvidia_sync_to_display`)) return n
	}
	return null
}

/**
 * @param {ReturnType<typeof calculateLayoutPositions>} layout
 * @param {string} sysId
 */
function findLayoutRectBySysId(layout, sysId) {
	const id = String(sysId || '').trim()
	if (!id || !layout) return null
	for (const [idx, sc] of Object.entries(layout.screens || {})) {
		if (String(sc?.sysId || '') === id && sc.width > 0 && sc.height > 0) {
			return { ...sc, kind: 'screen', index: parseInt(idx, 10) || 1 }
		}
	}
	for (const [idx, mv] of Object.entries(layout.multiview || {})) {
		if (String(mv?.sysId || '') === id && mv.width > 0 && mv.height > 0) {
			return { ...mv, kind: 'multiview', index: parseInt(idx, 10) || 1 }
		}
	}
	return null
}

/**
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @param {number} portN
 * @returns {OperatorDisplayRect|null}
 */
function resolveLayoutRectForOperatorPort(config, layout, portN) {
	const plan = layout || calculateLayoutPositions(config)
	const sysId = String(readCasparSetting(config, `screen_${portN}_system_id`) || '').trim()
	if (sysId) {
		const hit = findLayoutRectBySysId(plan, sysId)
		if (hit) {
			const interactive =
				hit.kind === 'multiview'
					? multiviewInteractiveEnabled(config)
					: screenInteractiveEnabled(config, hit.index)
			return {
				x: hit.x,
				y: hit.y,
				width: hit.width,
				height: hit.height,
				sysId,
				kind: hit.kind,
				index: hit.index,
				interactive,
			}
		}
	}
	const ctx = createDestinationWiringContext(config || {})
	for (let destIndex = 0; destIndex < ctx.destinations.length; destIndex++) {
		const dest = ctx.destinations[destIndex]
		const portIdx = resolvePhysicalPortIndexForDestination(dest, destIndex, ctx)
		if (portIdx !== portN) continue
		const mode = String(dest?.mode || '').toLowerCase()
		if (mode === 'multiview') {
			const mv = plan?.multiview?.[1]
			if (!mv || mv.width <= 0 || mv.height <= 0) continue
			return {
				x: mv.x,
				y: mv.y,
				width: mv.width,
				height: mv.height,
				sysId: mv.sysId ? String(mv.sysId) : sysId || null,
				kind: 'multiview',
				index: 1,
				interactive: multiviewInteractiveEnabled(config),
			}
		}
		const n = Math.max(1, (parseInt(String(dest?.mainScreenIndex ?? 0), 10) || 0) + 1)
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		return {
			x: sc.x,
			y: sc.y,
			width: sc.width,
			height: sc.height,
			sysId: sc.sysId ? String(sc.sysId) : sysId || null,
			kind: 'screen',
			index: n,
			interactive: screenInteractiveEnabled(config, n),
		}
	}
	return null
}

/**
 * @param {object} config
 * @returns {boolean}
 */
function isOperatorPointerConfineDesired(config) {
	if (operatorMonitorPortIndex(config) != null) return true
	if (config?.operatorTools?.pointerConfineMultiview === true) return true
	return false
}

/**
 * Operator monitor rect only when explicitly configured (GPU port checkbox or legacy setting).
 * Used for primary, confine, and apply-layout — not for Firefox/GUI positioning fallback.
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {OperatorDisplayRect|null}
 */
function resolveOperatorMonitorRect(config, layout) {
	const plan = layout || calculateLayoutPositions(config)
	const operatorPort = operatorMonitorPortIndex(config)
	if (operatorPort) {
		return resolveLayoutRectForOperatorPort(config, plan, operatorPort)
	}
	if (config?.operatorTools?.pointerConfineMultiview === true) {
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
				interactive: multiviewInteractiveEnabled(config),
			}
		}
	}
	return null
}

/**
 * Operator-facing display for GUI tools (multiview fallback when no explicit operator monitor).
 * multiview screen consumer when enabled, else first PGM screen consumer head.
 * Interactive Caspar inputs use the same head only when multiview is off (see confine tick).
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {OperatorDisplayRect|null}
 */
function resolveOperatorDisplayRect(config, layout) {
	const plan = layout || calculateLayoutPositions(config)
	const fromMonitor = resolveOperatorMonitorRect(config, plan)
	if (fromMonitor) return fromMonitor

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
			interactive: multiviewInteractiveEnabled(config),
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
			interactive: screenInteractiveEnabled(config, n),
		}
	}
	return null
}

/**
 * @param {OperatorDisplayRect|null} rect
 * @returns {string}
 */
function formatOperatorDisplaySummary(rect) {
	if (!rect) return 'No operator monitor configured (Device View → GPU port → Operator monitor).'
	const port = rect.sysId || '(unknown port)'
	const role =
		rect.kind === 'multiview' ? `multiview ${rect.index}` : `screen consumer ${rect.index}`
	const interactive = rect.interactive ? ' · interactive (Caspar mouse input)' : ''
	return `Operator monitor: ${port} — ${role} @ ${rect.x},${rect.y} ${rect.width}×${rect.height}${interactive}`
}

/**
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function pointerInRect(x, y, rect) {
	return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

/**
 * Allowed pointer zones when confine is on: operator monitor + any interactive Caspar consumer.
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} layout
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function pointerInConfineAllowance(config, layout, x, y) {
	const operator = resolveOperatorMonitorRect(config, layout)
	if (operator && pointerInRect(x, y, operator)) return true
	return pointerOverInteractiveConsumer(config, layout, x, y)
}

/**
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function pointerOverInteractiveConsumer(config, layout, x, y) {
	const plan = layout || calculateLayoutPositions(config)
	for (let n = 1; n <= 8; n++) {
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n) || !screenInteractiveEnabled(config, n)) continue
		const mvPort = multiviewPhysicalPortIndex(config)
		if (mvPort && n === mvPort) continue
		if (x >= sc.x && x < sc.x + sc.width && y >= sc.y && y < sc.y + sc.height) return true
	}
	const mv = plan?.multiview?.[1]
	if (
		multiviewScreenConsumerEnabled(config) &&
		multiviewInteractiveEnabled(config) &&
		mv &&
		mv.width > 0 &&
		mv.height > 0 &&
		x >= mv.x &&
		x < mv.x + mv.width &&
		y >= mv.y &&
		y < mv.y + mv.height
	) {
		return true
	}
	return false
}

/**
 * Move pointer to operator monitor centre (wakes unclutter; helps locate cursor).
 * @param {object} config
 * @param {{ log?: Function, layout?: object }} [opts]
 */
async function parkPointerOnOperatorDisplay(config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const rect = resolveOperatorDisplayRect(config, opts.layout)
	if (!rect || !(await commandExists('xdotool'))) return false
	const env = displaySessionEnv()
	const cx = rect.x + Math.floor(rect.width / 2)
	const cy = rect.y + Math.floor(rect.height / 2)
	try {
		await execFileAsync('xdotool', ['mousemove', '--sync', String(cx), String(cy)], { env, timeout: 5000 })
		log('info', `[X-Display] Pointer parked @ ${cx},${cy} (${rect.sysId || 'operator'})`)
		return true
	} catch (e) {
		log('warn', `[X-Display] park pointer failed: ${e?.message || e}`)
		return false
	}
}

/**
 * @param {string} action
 * @param {object} config
 * @param {{ log?: Function }} [opts]
 * @returns {Promise<boolean>}
 */
async function raiseOperatorGuiWindows(action, config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const rect = resolveOperatorDisplayRect(config)
	const winClassRaw = GUI_WINDOW_CLASS[action]
	const winClasses = Array.isArray(winClassRaw) ? winClassRaw : winClassRaw ? [winClassRaw] : []
	if (!winClasses.length || !(await commandExists('xdotool'))) return false
	const env = displaySessionEnv()
	const x = rect ? rect.x + Math.max(0, Math.floor(rect.width * 0.05)) : 0
	const y = rect ? rect.y + Math.max(0, Math.floor(rect.height * 0.05)) : 0

	for (const winClass of winClasses) {
		/** @type {string[]} */
		let ids = []
		for (const searchArgs of [['search', '--class', winClass], ['search', '--class', winClass, '--onlyvisible']]) {
			try {
				const { stdout } = await execFileAsync('xdotool', searchArgs, { env, timeout: 3000 })
				ids = String(stdout || '')
					.trim()
					.split(/\s+/)
					.filter(Boolean)
				if (ids.length) break
			} catch {
				/* try next search mode */
			}
		}
		if (!ids.length) continue
		for (const wid of ids) {
			await execFileAsync('xdotool', ['windowraise', wid], { env, timeout: 3000 }).catch(() => {})
			if (rect) {
				await execFileAsync('xdotool', ['windowmove', wid, String(x), String(y)], { env, timeout: 3000 }).catch(() => {})
			}
			await execFileAsync('xdotool', ['windowactivate', wid], { env, timeout: 3000 }).catch(() => {})
		}
		log('info', `[X-Display] Raised ${action} (${ids.length} window(s))`)
		return true
	}
	return false
}

/** @type {Record<string, string | string[]>} */
const GUI_WINDOW_CLASS = {
	'nvidia-settings': 'nvidia-settings',
	desktopvideo_setup: 'DesktopVideo',
	desktop_video_updater: 'DesktopVideo',
	alsamixer: 'Alsamixer',
	firefox: 'Navigator',
	'file-manager': ['Thunar', 'Pcmanfm', 'Nautilus', 'Dolphin'],
	calamares: 'calamares',
}

function listInteractiveConsumerSummaries(config, layout) {
	const plan = layout || calculateLayoutPositions(config)
	/** @type {string[]} */
	const out = []
	const mvPort = multiviewPhysicalPortIndex(config)
	const mv = plan?.multiview?.[1]
	if (multiviewScreenConsumerEnabled(config) && mv && mv.width > 0 && multiviewInteractiveEnabled(config)) {
		out.push(`${mv.sysId || '?'} multiview`)
	}
	for (let n = 1; n <= 8; n++) {
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n) || !screenInteractiveEnabled(config, n)) continue
		// Skip legacy mis-filed port key (interactive on multiview jack stored as screen_${port}_interactive).
		if (mvPort && n === mvPort) continue
		out.push(`${sc.sysId || '?'} screen ${n}`)
	}
	return out
}

/**
 * @param {object} config
 * @param {{ layout?: object }} [opts]
 * @returns {object}
 */
function describeOperatorDisplay(config, opts = {}) {
	const layout = opts.layout || calculateLayoutPositions(config)
	const monitorRect = resolveOperatorMonitorRect(config, layout)
	const guiRect = resolveOperatorDisplayRect(config, layout)
	const interactiveAllowance = listInteractiveConsumerSummaries(config, layout)
	return {
		rect: monitorRect,
		guiRect,
		summary: formatOperatorDisplaySummary(monitorRect),
		guiSummary: guiRect ? formatOperatorDisplaySummary(guiRect).replace('Operator monitor:', 'GUI tools target:') : null,
		interactiveAllowance,
		confineDesired: isOperatorPointerConfineDesired(config),
	}
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
 * @returns {string|null}
 */
function resolveConfineCursorScript() {
	const candidates = [
		path.join(REPO_ROOT, 'tools/runtime/confine-cursor.py'),
		'/usr/local/bin/confine-cursor.py',
	]
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * XFixes pointer barriers — confines cursor without XGrabPointer (Caspar-safe).
 * @returns {string|null}
 */
function resolveConfineBarriersScript() {
	const candidates = [
		path.join(REPO_ROOT, 'tools/runtime/confine-pointer-barriers.py'),
		'/usr/local/bin/confine-pointer-barriers.py',
	]
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/** @returns {Promise<string|null>} */
async function resolveXdotoolBin(env) {
	const candidates = ['/usr/bin/xdotool', '/usr/local/bin/xdotool']
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	if (await commandExists('xdotool')) return 'xdotool'
	return null
}

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

/**
 * Move a spawned GUI tool onto the operator head (retry until window exists).
 * @param {string} action
 * @param {object} config
 * @param {{ log?: Function }} [opts]
 */
async function positionGuiWindowForAction(action, config, opts = {}) {
	for (let attempt = 0; attempt < 8; attempt++) {
		await new Promise((r) => setTimeout(r, attempt === 0 ? 400 : 350))
		if (await raiseOperatorGuiWindows(action, config, opts)) return true
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
	operatorMonitorPortIndex,
	nvidiaSyncToDisplayPortIndex,
	resolveLayoutRectForOperatorPort,
	resolveConfineCursorScript,
	resolveConfineBarriersScript,
	resolveXdotoolBin,
	buildConfineCursorShellLines,
	resolveNvidiaSyncToDisplayOutput,
	resolveOperatorMonitorRect,
	resolveOperatorDisplayRect,
	isOperatorPointerConfineDesired,
	formatOperatorDisplaySummary,
	describeOperatorDisplay,
	pointerOverInteractiveConsumer,
	pointerInConfineAllowance,
	parkPointerOnOperatorDisplay,
	raiseOperatorGuiWindows,
	buildOperatorDisplaySessionShellLines,
	applyOperatorDisplaySession,
	positionGuiWindowForAction,
	scheduleGuiWindowPosition,
	displaySessionEnv,
	screenConsumerEnabled,
	screenInteractiveEnabled,
	multiviewScreenConsumerEnabled,
	multiviewInteractiveEnabled,
	multiviewPhysicalPortIndex,
}
