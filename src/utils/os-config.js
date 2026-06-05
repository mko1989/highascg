'use strict'

const { execSync } = require('child_process')
const logger = require('./logger').defaultLogger
const { getXAuthority } = require('./hardware-info')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const { readCreateMissingModes, tryAddXrandrModeFromCvt, pickBestExistingModeForPlan } = require('./xrandr-custom-mode')
const { readOsTimingSourceForOutput } = require('./modeline-timings')



/**
 * Applies X11 screen positioning using xrandr or nvidia-settings.
 */
function applyX11Layout(config) {
	logger.info('[OS-Config] applyX11Layout start')
	const layout = calculateLayoutPositions(config)
	const xrandrParts = []
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

	const processHead = (info) => {
		const safeSysId = String(info.sysId).trim()
		if (!/^[A-Za-z0-9._-]+$/.test(safeSysId)) return
		
		const r = typeof info.rate === 'number' ? info.rate : parseFloat(String(info.rate || ''))
		const safeRate = Number.isFinite(r) && r > 0 ? r : null
		let avail = availableModesByOutput.get(safeSysId)
		if (!avail) {
			avail = new Set()
			availableModesByOutput.set(safeSysId, avail)
		}
		const plannedMode = String(info.mode || '').trim()
		const allowCreate = readCreateMissingModes(config)
		let resolvedMode = plannedMode
		let usedCvtCreate = false
		let existingToken =
			plannedMode && /^\d+x\d+$/i.test(plannedMode) ? pickBestExistingModeForPlan(plannedMode, avail, safeRate) : null
		if (!existingToken && plannedMode && avail.has(plannedMode)) existingToken = plannedMode
		if (existingToken) {
			resolvedMode = existingToken
			if (existingToken !== plannedMode) {
				logger.info(
					`[OS-Config] Using existing xrandr mode for ${safeSysId}: planned=${plannedMode} --mode ${existingToken}`
				)
			}
		}
		if (avail && plannedMode && allowCreate && /^\d+x\d+$/i.test(plannedMode) && !existingToken) {
			const wm = plannedMode.match(/^(\d+)x(\d+)$/i)
			if (wm) {
				const cw = parseInt(wm[1], 10)
				const ch = parseInt(wm[2], 10)
		const timingKind = readOsTimingSourceForOutput(config, safeSysId)
				const created = tryAddXrandrModeFromCvt({
					output: safeSysId,
					width: cw,
					height: ch,
					refreshHz: safeRate != null ? safeRate : 60,
					env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() },
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
		}
		if (!resolvedMode || !avail.has(resolvedMode)) {
			resolvedMode = pickBestAvailableMode(plannedMode, avail)
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

		// Include --mode for strict enforcement as requested by user
		const modeArg = String(resolvedMode || info.mode || '').trim()
		const xPart = `--output ${safeSysId} --pos ${info.x}x${info.y} --mode ${modeArg}`
		const xPartWithRate = safeRate != null ? `${xPart} --rate ${Math.round(safeRate * 100) / 100}` : xPart
		logger.info(
			`[OS-Config] xrandr head: output=${safeSysId} pos=${info.x}x${info.y} mode=${modeArg || '(empty)'} planned=${plannedMode || '(none)'} rate=${safeRate != null ? Math.round(safeRate * 100) / 100 : '(none)'}`
		)
		xrandrParts.push(xPartWithRate)
	}

	try {
		xrandrQueryOut = execSync('xrandr --display :0 --query', { env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() } }).toString()
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
	mapGpu.forEach(processHeadDeduped)
	Object.values(layout.screens).forEach(processHeadDeduped)
	Object.values(layout.multiview).forEach(processHeadDeduped)

	const env = { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() }
	let applied = false
	let persisted = false
	/** @type {string|null} */
	let xrandrCommand = null
	if (xrandrParts.length > 0) {
		try {
			const xcmd = `xrandr --display :0 ${xrandrParts.join(' ')}`
			xrandrCommand = `DISPLAY=:0 ${xcmd}`
			logger.info(`[OS-Config] Applying (xrandr): ${xcmd}`)
			const out = execSync(xcmd, { env, encoding: 'utf8', maxBuffer: 1024 * 1024 })
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
			persisted = persistLayoutScript(xcmd)
		} catch (e) {
			logger.error(`[OS-Config] xrandr apply failed: ${e.message}`)
			if (e.stderr) logger.error(`[OS-Config] xrandr stderr: ${String(e.stderr).trim()}`)
			if (e.stdout) logger.error(`[OS-Config] xrandr stdout (on error): ${String(e.stdout).trim().slice(0, 8000)}`)
		}
	} else {
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
	return { applied, persisted, xrandrCommand }
}

function persistLayoutScript(cmd) {
	try {
		logger.info('[OS-Config] Persisting layout startup script')
		const scriptContent = `#!/bin/bash\n# Generated by HighAsCG\nexport DISPLAY=:0\nexport XAUTHORITY=${getXAuthority()}\n${cmd}\n`
		execSync(`sudo mkdir -p /etc/highascg && echo '${scriptContent}' | sudo tee /etc/highascg/apply-layout.sh && sudo chmod +x /etc/highascg/apply-layout.sh`, { stdio: 'inherit' })
		execSync(`if [ -d /etc/X11/Xsession.d ]; then echo "/etc/highascg/apply-layout.sh &" | sudo tee /etc/X11/Xsession.d/99highascg-layout; fi`, { stdio: 'inherit' })
		execSync(`if [ -d ~/.config/openbox ]; then grep -q "apply-layout.sh" ~/.config/openbox/autostart || echo "/etc/highascg/apply-layout.sh &" >> ~/.config/openbox/autostart; fi`, { stdio: 'inherit' })
		logger.info(`[OS-Config] Persisted layout to /etc/highascg/apply-layout.sh`)
		return true
	} catch (pe) {
		logger.warn(`[OS-Config] Could not persist layout script: ${pe.message}`)
		if (pe && pe.stderr) logger.warn(`[OS-Config] Persist stderr: ${String(pe.stderr).trim()}`)
	}
	return false
}

/**
 * Restarts the Linux display manager (nodm).
 * Requires passwordless sudo for the node user.
 */
function restartDisplayManager() {
	// Use sudo -n to fail fast if password is required
	const cmd = 'sudo -n systemctl restart nodm'
	logger.info(`[OS-Config] Restarting display manager: ${cmd}`)
	try {
		execSync(cmd, { stdio: 'inherit' })
		return true
	} catch (e) {
		logger.error(`[OS-Config] Failed to restart nodm (requires passwordless sudo): ${e.message}`)
		return false
	}
}

module.exports = {
	applyX11Layout,
	calculateLayoutPositions,
	restartDisplayManager,
}
