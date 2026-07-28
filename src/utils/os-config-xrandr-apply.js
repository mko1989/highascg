'use strict'

const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)
const logger = require('./buffered-logger').osDisplay
const { getGpuConnectorInventory, getXAuthority } = require('./hardware-info')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const { readCreateMissingModes, tryAddXrandrModeFromCvt, computeModelineForWxH, shouldCreateXrandrModeForPlan } = require('./xrandr-custom-mode')
const { readOsTimingSourceForOutput } = require('./modeline-timings')
const { resolveSysIdToXrandrOutput } = require('./xrandr-output-resolve')
const { verifyXrandrMatchesLayout } = require('./xrandr-layout-verify')
const { applyOperatorDisplaySession } = require('./x-display-session')
const { CustomXrandrModeRegistry } = require('./xrandr-persist-script')
const {
	assertSafeXrandrModeToken,
	buildXrandrLayoutArgv,
	formatXrandrLayoutShellCommand,
	formatXrandrArgvForLog,
} = require('./xrandr-safety')
const { persistLayoutScript } = require('./os-config-persist')

/** WO-337: async now — the sync sleep + sync xrandr execs froze the whole API/WS server. */
function sleepMs(ms) {
	return new Promise((r) => setTimeout(r, Math.max(0, ms)))
}

/** Number of xrandr apply attempts (NVIDIA BadMatch often clears on identical retry). Env: HIGHASCG_XRANDR_APPLY_ATTEMPTS */
function readXrandrApplyAttempts(config) {
	const raw = process.env.HIGHASCG_XRANDR_APPLY_ATTEMPTS ?? config?.xrandr_apply_attempts
	const n = parseInt(String(raw ?? ''), 10)
	if (Number.isFinite(n) && n >= 1) return Math.min(n, 5)
	return 3
}

/** Delay between xrandr apply attempts in ms. Env: HIGHASCG_XRANDR_APPLY_RETRY_DELAY_MS */
function readXrandrApplyRetryDelayMs(config) {
	const raw = process.env.HIGHASCG_XRANDR_APPLY_RETRY_DELAY_MS ?? config?.xrandr_apply_retry_delay_ms
	const n = parseInt(String(raw ?? ''), 10)
	if (Number.isFinite(n) && n >= 0) return Math.min(n, 5000)
	return 600
}

/**
 * Applies X11 screen positioning using xrandr or nvidia-settings.
 */
async function applyX11Layout(config, opts = {}) {
	const live = opts.live !== false
	const persist = opts.persist !== false
	logger.info(`[OS-Config] applyX11Layout start live=${live} persist=${persist}`)
	const layout = calculateLayoutPositions(config)
	/** @type {Array<{ output: string, modeName: string, created: boolean, source: 'cvt'|'edid' }>} */
	const modeCreation = []
	const customModeRegistry = new CustomXrandrModeRegistry()
	/** @type {Array<{ output: string, x: number, y: number, mode: string, rate?: number|null }>} */
	const xrandrHeads = []
	let xrandrQueryOut
	/** @type {Map<string, Set<string>>} */
	const availableModesByOutput = new Map()

	const parseOutputModes = (queryText) => {
		const byOut = new Map()
		let currentOut = ''
		const lines = String(queryText || '').split('\n')
		for (const line of lines) {
			const outMatch = line.match(/^([A-Za-z0-9._-]+)\s+connected\b/)
			if (outMatch) {
				currentOut = outMatch[1]
				if (!byOut.has(currentOut)) byOut.set(currentOut, new Set())
				continue
			}
			if (!currentOut) continue
			const tokMatch = line.match(/^\s{2,}(\S+)/)
			if (!tokMatch) continue
			const token = tokMatch[1]
			if (!/^\d+x\d+/i.test(token)) continue
			const set = byOut.get(currentOut)
			set.add(token)
			const bare = token.match(/^(\d+x\d+)/i)
			if (bare && bare[1] !== token) set.add(bare[1])
		}
		return byOut
	}

	const pickBestAvailableMode = (desiredMode, availableModes) => {
		const wanted = String(desiredMode || '').trim()
		if (!wanted || !availableModes || availableModes.size === 0) return wanted
		if (availableModes.has(wanted)) return wanted
		const m = wanted.match(/^(\d+)x(\d+)$/)
		if (!m) return wanted
		const wantW = parseInt(m[1], 10) || 0
		const wantH = parseInt(m[2], 10) || 0
		let best = ''
		let bestScore = Number.POSITIVE_INFINITY
		for (const mode of availableModes) {
			const mm = String(mode).match(/^(\d+)x(\d+)/i)
			if (!mm) continue
			const w = parseInt(mm[1], 10) || 0
			const h = parseInt(mm[2], 10) || 0
			if (w <= 0 || h <= 0) continue
			const score = Math.abs(w - wantW) * 100000 + Math.abs(h - wantH)
			if (score < bestScore) {
				bestScore = score
				best = mode
			}
		}
		return best || wanted
	}

	const connectorInventory = getGpuConnectorInventory()

	const processHead = (info) => {
		const rawSysId = String(info.sysId).trim()
		const safeSysId = resolveSysIdToXrandrOutput(rawSysId, { inventory: connectorInventory, config })
		if (!safeSysId || !/^[A-Za-z0-9._-]+$/.test(safeSysId)) return
		if (rawSysId !== safeSysId) {
			logger.info(`[OS-Config] Resolved output ${rawSysId} → ${safeSysId} for xrandr`)
		}
		
		const r = typeof info.rate === 'number' ? info.rate : parseFloat(String(info.rate || ''))
		const safeRate = Number.isFinite(r) && r > 0 ? r : null
		let avail = availableModesByOutput.get(safeSysId)
		if (!avail) {
			avail = new Set()
			availableModesByOutput.set(safeSysId, avail)
		}
		const plannedMode = String(info.mode || '').trim()
		const osModeSource = String(info.osModeSource || 'edid').toLowerCase() === 'custom' ? 'custom' : 'edid'
		let resolvedMode = plannedMode
		let usedCvtCreate = false

		if (osModeSource === 'edid') {
			if (plannedMode && avail.size > 0 && !avail.has(plannedMode)) {
				logger.warn(
					`[OS-Config] EDID mode ${plannedMode} not listed for ${safeSysId} — applying token anyway (source=edid)`
				)
			}
			if (plannedMode && avail.has(plannedMode)) {
				modeCreation.push({
					output: safeSysId,
					modeName: plannedMode,
					created: false,
					source: 'edid',
				})
			}
		} else {
			const allowCreate = shouldCreateXrandrModeForPlan(config, osModeSource, plannedMode)
			if (avail && allowCreate) {
				const wm = plannedMode.match(/^(\d+)x(\d+)$/i)
				if (wm) {
					const cw = parseInt(wm[1], 10)
					const ch = parseInt(wm[2], 10)
					const timingKind = readOsTimingSourceForOutput(config, safeSysId)
					const xEnv = { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() }
					const modelinePlan = computeModelineForWxH({
						width: cw,
						height: ch,
						refreshHz: safeRate != null ? safeRate : 60,
						env: xEnv,
						timingKind,
						logger,
					})
					if (modelinePlan) {
						customModeRegistry.register(safeSysId, modelinePlan)
					}
					const created = tryAddXrandrModeFromCvt({
						output: safeSysId,
						width: cw,
						height: ch,
						refreshHz: safeRate != null ? safeRate : 60,
						env: xEnv,
						logger,
						availableModes: avail,
						timingKind,
					})
					if (created) {
						avail.add(created)
						const bare = created.match(/^(\d+x\d+)/i)
						if (bare) avail.add(bare[1])
						resolvedMode = created
						usedCvtCreate = true
						modeCreation.push({
							output: safeSysId,
							modeName: created,
							created: true,
							source: 'cvt',
						})
					}
				}
			} else if (!allowCreate && plannedMode) {
				resolvedMode = pickBestAvailableMode(plannedMode, avail)
			}
		}

		if (osModeSource === 'custom' && !usedCvtCreate && plannedMode && /^\d+x\d+$/i.test(plannedMode)) {
			if (!resolvedMode || !avail.has(resolvedMode)) {
				resolvedMode = pickBestAvailableMode(plannedMode, avail)
			}
		}
		if (resolvedMode && plannedMode && resolvedMode !== plannedMode) {
			if (usedCvtCreate) {
				logger.info(
					`[OS-Config] Custom mode from cvt for ${safeSysId}: planned=${plannedMode} applied as ${resolvedMode}`
				)
			} else {
				logger.warn(
					`[OS-Config] Mode fallback for ${safeSysId}: planned=${plannedMode} unavailable, using=${resolvedMode}`
				)
			}
		}

		const modeArg = String(resolvedMode || info.mode || '').trim()
		if (!modeArg) {
			logger.warn(`[OS-Config] Skipping ${safeSysId}: empty xrandr mode`)
			return
		}
		try {
			assertSafeXrandrModeToken(modeArg)
		} catch (e) {
			logger.warn(`[OS-Config] Skipping unsafe xrandr mode for ${safeSysId}: ${e.message}`)
			return
		}
		logger.info(
			`[OS-Config] xrandr head: output=${safeSysId} pos=${info.x}x${info.y} mode=${modeArg} planned=${plannedMode || '(none)'} source=${osModeSource} rate=${safeRate != null ? Math.round(safeRate * 100) / 100 : '(none)'}`
		)
		xrandrHeads.push({
			output: safeSysId,
			x: info.x,
			y: info.y,
			mode: modeArg,
			rate: safeRate,
		})
	}

	try {
		const q = await execFileAsync(
			'xrandr',
			['--display', ':0', '--query'],
			{ env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() }, encoding: 'utf8' },
		)
		xrandrQueryOut = String(q.stdout || '')
		const parsed = parseOutputModes(xrandrQueryOut)
		for (const [out, modes] of parsed.entries()) availableModesByOutput.set(out, modes)
	} catch (e) { logger.warn(`[OS-Config] Failed to query connected outputs: ${e.message}`) }

	const seenSysIds = new Set()
	const processHeadDeduped = (info) => {
		const sid = String(info?.sysId || '').trim()
		if (!sid || seenSysIds.has(sid)) return
		seenSysIds.add(sid)
		processHead(info)
	}
	const mapGpu = Array.isArray(layout.mappingGpuOutputs) ? layout.mappingGpuOutputs : []
	Object.values(layout.screens).forEach(processHeadDeduped)
	Object.values(layout.multiview).forEach(processHeadDeduped)
	mapGpu.forEach(processHeadDeduped)

	const env = { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() }
	let applied = false
	let persisted = false
	/** @type {string|null} */
	let xrandrCommand = null
	/** @type {string[]|null} */
	let xrandrArgv = null
	if (xrandrHeads.length > 0) {
		try {
			xrandrArgv = buildXrandrLayoutArgv(xrandrHeads)
			xrandrCommand = formatXrandrLayoutShellCommand(xrandrArgv)
		} catch (e) {
			logger.warn(`[OS-Config] xrandr layout argv rejected: ${e.message}`)
		}
	}

	if (persist && xrandrCommand) {
		persisted = persistLayoutScript(xrandrCommand, config, layout, customModeRegistry.toArray())
	}

	if (live && xrandrArgv) {
		const xrandrLog = formatXrandrArgvForLog(xrandrArgv)
		// NVIDIA RandR often rejects the first combined CRTC reconfig with BadMatch when
		// transitioning from a wedged/narrower canvas, then accepts the *identical* command on
		// retry (observed on highascg-nvidia-595). Retry on failure before giving up.
		const maxAttempts = readXrandrApplyAttempts(config)
		const retryDelayMs = readXrandrApplyRetryDelayMs(config)
		let lastErr = null
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				logger.info(`[OS-Config] Applying (xrandr) attempt ${attempt}/${maxAttempts}: ${xrandrLog}`)
				const { stdout: out } = await execFileAsync('xrandr', xrandrArgv, { env, encoding: 'utf8', maxBuffer: 1024 * 1024 })
				const trimmed = String(out || '').trim()
				if (trimmed) {
					const cap = 8000
					logger.info(
						`[OS-Config] xrandr stdout (${trimmed.length} chars): ${trimmed.length > cap ? trimmed.slice(0, cap) + '…' : trimmed}`
					)
				} else {
					logger.info('[OS-Config] xrandr stdout: (empty)')
				}
				applied = true
				lastErr = null
				break
			} catch (e) {
				lastErr = e
				const stderr = e.stderr ? String(e.stderr).trim() : ''
				logger.warn(`[OS-Config] xrandr apply attempt ${attempt}/${maxAttempts} failed: ${e.message}`)
				if (stderr) logger.warn(`[OS-Config] xrandr stderr: ${stderr}`)
				if (e.stdout) logger.warn(`[OS-Config] xrandr stdout (on error): ${String(e.stdout).trim().slice(0, 8000)}`)
				if (attempt < maxAttempts && retryDelayMs > 0) await sleepMs(retryDelayMs)
			}
		}
		if (applied) {
			try {
				require('./hardware-info').invalidateXrandrCache()
			} catch (_) {}
			const verify = verifyXrandrMatchesLayout(layout, { inventory: connectorInventory, config })
			if (!verify.ok) {
				for (const m of verify.mismatches) {
					logger.warn(
						`[OS-Config] xrandr verify mismatch: ${m.sysId} ${m.field} expected=${m.expected} actual=${m.actual}`
					)
				}
			} else {
				logger.info('[OS-Config] xrandr verify OK — live layout matches plan')
			}
			/* WO-337: full-config-apply awaits its own applyOperatorDisplaySession right after this
			 * call — running a second one here concurrently made two `xdotool mousemove --sync`
			 * race, and the loser ate its full 5s timeout on every apply (measured). Callers that
			 * handle the session themselves pass skipOperatorSession. */
			if (opts.skipOperatorSession !== true) {
				applyOperatorDisplaySession(config, {
					layout,
					log: (level, msg) => {
						if (level === 'error') logger.error(msg)
						else if (level === 'warn') logger.warn(msg)
						else logger.info(msg)
					},
				}).catch((e) => {
					logger.warn(`[OS-Config] Operator display session failed: ${e?.message || e}`)
				})
			}
		} else if (lastErr) {
			logger.error(`[OS-Config] xrandr apply failed after ${maxAttempts} attempts: ${lastErr.message}`)
		}
	} else if (!live && xrandrCommand) {
		logger.info('[OS-Config] Skipping live xrandr push (persist-only)')
	} else if (xrandrHeads.length === 0) {
		logger.warn('[OS-Config] No xrandr outputs to apply')
	}
	
	// Refresh system inventory to capture the new layout state (stores raw xrandr query)
	try {
		const { writeSystemInventoryFile } = require('../bootstrap/system-inventory-file')
		writeSystemInventoryFile((level, msg) => {
			if (level === 'error') logger.error(msg)
			else if (level === 'warn') logger.warn(msg)
			else logger.info(msg)
		}, config)
	} catch (e) {
		logger.warn(`[OS-Config] Failed to refresh system inventory after apply: ${e.message}`)
	}

	logger.info('[OS-Config] applyX11Layout end')
	const verify = applied ? verifyXrandrMatchesLayout(layout, { inventory: connectorInventory, config }) : null
	return {
		applied,
		persisted,
		xrandrCommand,
		verify,
		customModes: customModeRegistry.toArray(),
		modeCreation,
	}
}

module.exports = {
	applyX11Layout,
}
