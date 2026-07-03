'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync, execFileSync } = require('child_process')
const logger = require('./buffered-logger').osDisplay
const { getXAuthority, getGpuConnectorInventory } = require('./hardware-info')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const { readCreateMissingModes, tryAddXrandrModeFromCvt, computeModelineForWxH, shouldCreateXrandrModeForPlan } = require('./xrandr-custom-mode')
const { readOsTimingSourceForOutput } = require('./modeline-timings')
const { resolveSysIdToXrandrOutput, looksLikeDrmConnectorName } = require('./xrandr-output-resolve')
const { verifyXrandrMatchesLayout } = require('./xrandr-layout-verify')
const { buildOperatorDisplaySessionShellLines, applyOperatorDisplaySession } = require('./x-display-session')
const {
	CustomXrandrModeRegistry,
	buildApplyLayoutScriptContent,
	customModesToApplyMeta,
} = require('./xrandr-persist-script')
const {
	assertSafeXrandrModeToken,
	buildXrandrLayoutArgv,
	formatXrandrLayoutShellCommand,
	formatXrandrArgvForLog,
} = require('./xrandr-safety')



/** Synchronous sleep between xrandr retries (this function runs in a sync execSync context). */
function sleepSyncMs(ms) {
	if (!(ms > 0)) return
	try {
		execFileSync('sleep', [String(Math.max(0.05, ms / 1000))], { stdio: 'ignore' })
	} catch (_) {
		/* best effort */
	}
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
function applyX11Layout(config, opts = {}) {
	const live = opts.live !== false
	const persist = opts.persist !== false
	logger.info(`[OS-Config] applyX11Layout start live=${live} persist=${persist}`)
	const layout = calculateLayoutPositions(config)
	/** @type {Array<{ output: string, x: number, y: number, mode: string, rate?: number|null }>} */
	const xrandrHeads = []
	const customModeRegistry = new CustomXrandrModeRegistry()
	let xrandrQueryOut = ''
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
		xrandrQueryOut = execFileSync(
			'xrandr',
			['--display', ':0', '--query'],
			{ env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() }, encoding: 'utf8' },
		).toString()
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
				const out = execFileSync('xrandr', xrandrArgv, { env, encoding: 'utf8', maxBuffer: 1024 * 1024 })
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
				if (attempt < maxAttempts && retryDelayMs > 0) sleepSyncMs(retryDelayMs)
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
	}
}

function writeCustomModesApplyMeta(customModes) {
	try {
		const { REPO_ROOT } = require('../repo-paths')
		const dir = path.join(REPO_ROOT, 'data', 'runtime')
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		const metaPath = path.join(dir, 'xrandr-custom-modes-last-apply.json')
		fs.writeFileSync(metaPath, JSON.stringify(customModesToApplyMeta(customModes), null, 2), 'utf8')
		logger.info(`[OS-Config] Wrote custom mode apply meta to ${metaPath}`)
	} catch (e) {
		logger.warn(`[OS-Config] Failed to write custom mode apply meta: ${e.message}`)
	}
}

function persistLayoutScript(cmd, config, layout, customModes = []) {
	try {
		logger.info('[OS-Config] Persisting layout startup script')
		const xauth = getXAuthority()
		const sessionLines = config ? buildOperatorDisplaySessionShellLines(config, layout) : []
		const scriptContent = buildApplyLayoutScriptContent({
			xauth,
			xrandrLayoutCmd: cmd,
			customModes,
			sessionLines,
		})
		if (customModes.length > 0) {
			logger.info(`[OS-Config] Persisting ${customModes.length} custom xrandr mode(s) in apply-layout.sh`)
			writeCustomModesApplyMeta(customModes)
		}
		const home = process.env.HOME || '/home/casparcg'
		const userConfigDir = path.join(home, '.config', 'highascg')
		const userScriptPath = path.join(userConfigDir, 'apply-layout.sh')
		
		try {
			if (!fs.existsSync(userConfigDir)) {
				fs.mkdirSync(userConfigDir, { recursive: true })
			}
			fs.writeFileSync(userScriptPath, scriptContent, { encoding: 'utf8', mode: 0o755 })
			logger.info(`[OS-Config] Persisted layout to ${userScriptPath}`)
		} catch (e) {
			logger.warn(`[OS-Config] Failed to write user layout script: ${e.message}`)
		}

		// Try system-wide as well, but catch errors so it doesn't abort
		try {
			const tmp = path.join(os.tmpdir(), `highascg-apply-layout-${process.pid}.sh`)
			fs.writeFileSync(tmp, scriptContent, { encoding: 'utf8', mode: 0o755 })
			execFileSync('sudo', ['-n', 'install', '-d', '/etc/highascg'], { stdio: 'ignore' })
			execFileSync('sudo', ['-n', 'install', '-m', '755', tmp, '/etc/highascg/apply-layout.sh'], {
				stdio: 'ignore',
			})
			try {
				fs.unlinkSync(tmp)
			} catch (_) {}
			const xsessionHook = '/etc/highascg/apply-layout.sh &'
			if (fs.existsSync('/etc/X11/Xsession.d')) {
				execFileSync('sudo', ['-n', 'tee', '/etc/X11/Xsession.d/99highascg-layout'], {
					input: `${xsessionHook}\n`,
					stdio: ['pipe', 'ignore', 'ignore'],
				})
			}
			logger.info('[OS-Config] Persisted system-wide layout to /etc/highascg/apply-layout.sh')
		} catch (sysErr) {
			logger.info(`[OS-Config] System-wide layout persistence skipped (requires sudo): ${sysErr.message}`)
		}

		const autostart = path.join(home, '.config/openbox/autostart')
		if (fs.existsSync(path.dirname(autostart))) {
			const cur = fs.existsSync(autostart) ? fs.readFileSync(autostart, 'utf8') : ''
			// Migrate legacy if present, or add user script
			if (!cur.includes(userScriptPath) && !cur.includes('/etc/highascg/apply-layout.sh')) {
				fs.appendFileSync(autostart, `\n${userScriptPath} &\n`)
			} else if (cur.includes('/etc/highascg/apply-layout.sh') && !cur.includes(userScriptPath)) {
				// Replace system-wide reference with user-local one in autostart just in case system-wide fails later
				const updated = cur.replace('/etc/highascg/apply-layout.sh', userScriptPath)
				fs.writeFileSync(autostart, updated, 'utf8')
			}
		}
		return true
	} catch (pe) {
		logger.warn(`[OS-Config] Could not persist layout script: ${pe.message}`)
		if (pe && pe.stderr) logger.warn(`[OS-Config] Persist stderr: ${String(pe.stderr).trim()}`)
	}
	return false
}

/**
 * Remove stale xrandr startup script (factory reset / explicit clear).
 * Openbox autostart may still invoke the path; write a no-op script so login does not restore an old layout.
 * @param {{ reason?: string }} [opts]
 * @returns {boolean}
 */
function clearPersistedOsLayout(opts = {}) {
	const reason = String(opts.reason || 'cleared').trim()
	try {
		const home = process.env.HOME || '/home/casparcg'
		const userConfigDir = path.join(home, '.config', 'highascg')
		const userScriptPath = path.join(userConfigDir, 'apply-layout.sh')
		const xauth = getXAuthority()
		const scriptContent = `#!/bin/bash
# Generated by HighAsCG — ${reason}
export DISPLAY=:0
export XAUTHORITY=${xauth}
# No GPU xrandr layout persisted. Use Device View → Apply OS after assigning screen destinations to GPU heads.
`
		if (!fs.existsSync(userConfigDir)) fs.mkdirSync(userConfigDir, { recursive: true })
		fs.writeFileSync(userScriptPath, scriptContent, { encoding: 'utf8', mode: 0o755 })
		logger.info(`[OS-Config] Cleared persisted layout script (${reason}) at ${userScriptPath}`)

		try {
			const tmp = path.join(os.tmpdir(), `highascg-apply-layout-clear-${process.pid}.sh`)
			fs.writeFileSync(tmp, scriptContent, { encoding: 'utf8', mode: 0o755 })
			execFileSync('sudo', ['-n', 'install', '-d', '/etc/highascg'], { stdio: 'ignore' })
			execFileSync('sudo', ['-n', 'install', '-m', '755', tmp, '/etc/highascg/apply-layout.sh'], {
				stdio: 'ignore',
			})
			try {
				fs.unlinkSync(tmp)
			} catch (_) {}
			logger.info('[OS-Config] Cleared system-wide /etc/highascg/apply-layout.sh')
		} catch (sysErr) {
			logger.info(`[OS-Config] System-wide layout clear skipped: ${sysErr.message}`)
		}
		return true
	} catch (e) {
		logger.warn(`[OS-Config] Failed to clear persisted layout script: ${e.message}`)
		return false
	}
}

/**
 * Compare planned OS layout against live xrandr (after nodm / apply-os).
 * @param {object} config
 */
function checkXrandrLayout(config) {
	const layout = calculateLayoutPositions(config)
	const inventory = getGpuConnectorInventory()
	return verifyXrandrMatchesLayout(layout, { inventory, config })
}

/**
 * Restarts the Linux display manager (nodm).
 * Requires passwordless sudo for the node user.
 */
function restartDisplayManager() {
	const cmd = 'sudo -n systemctl restart nodm'
	logger.info(`[OS-Config] Restarting display manager: ${cmd}`)
	try {
		execFileSync('sudo', ['-n', 'systemctl', 'restart', 'nodm'], { stdio: 'inherit' })
		return true
	} catch (e) {
		logger.error(`[OS-Config] Failed to restart nodm (requires passwordless sudo): ${e.message}`)
		return false
	}
}

module.exports = {
	applyX11Layout,
	calculateLayoutPositions,
	checkXrandrLayout,
	clearPersistedOsLayout,
	restartDisplayManager,
	looksLikeDrmConnectorName,
	resolveSysIdToXrandrOutput,
}
