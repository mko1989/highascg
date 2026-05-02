'use strict'

const { execSync } = require('child_process')
const { multiviewGeneratedConfigIncludesScreen } = require('../config/multiview-helpers')
const { getModeDimensions, STANDARD_VIDEO_MODES } = require('../config/config-modes')
const logger = require('./logger').defaultLogger

function readScreenSetting(config, key) {
	if (!config || typeof config !== 'object') return undefined
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	if (Object.prototype.hasOwnProperty.call(config, key)) return config[key]
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	return undefined
}

function resolveScreenDimsFromTopology(config, screenIdx1) {
	const topology = config?.tandemTopology && typeof config.tandemTopology === 'object' ? config.tandemTopology : {}
	const list = Array.isArray(topology.destinations) ? topology.destinations : []
	if (!list.length) return null
	const idx0 = Math.max(0, (parseInt(String(screenIdx1), 10) || 1) - 1)
	const routable = list.filter((d) => {
		const mode = String(d?.mode || 'pgm_prv')
		return mode !== 'multiview' && mode !== 'stream'
	})
	const perMain = routable.filter((d) => (parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) === idx0)
	if (!perMain.length) return null
	const picked = perMain.find((d) => String(d?.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]
	const vm = String(picked?.videoMode || '').trim()
	if (vm && STANDARD_VIDEO_MODES[vm]) return { width: STANDARD_VIDEO_MODES[vm].width, height: STANDARD_VIDEO_MODES[vm].height }
	const w = parseInt(String(picked?.width ?? 0), 10) || 0
	const h = parseInt(String(picked?.height ?? 0), 10) || 0
	if (w > 0 && h > 0) return { width: w, height: h }
	return null
}

/**
 * @param {string} mode
 * @returns {string} xrandr mode name e.g. 1920x1080
 */
function mapCasparModeToXrandrRes(mode) {
	if (!mode) return '1920x1080'
	const s = String(mode)
	if (s === '1080p5000' || s === '1080p50') return '1920x1080'
	if (s === '720p5000' || s === '720p50') return '1280x720'
	const m = s.match(/^(\d+)x(\d+)/)
	return m ? `${m[1]}x${m[2]}` : '1920x1080'
}

/**
 * Left-to-right order of Caspar screen indices for xrandr --pos (1 = leftmost).
 * @param {number} screenCount
 * @param {boolean} swap - When true, reverse order (e.g. [2,1] or [4,3,2,1]).
 * @returns {number[]}
 */
function getHorizontalLayoutOrder(screenCount, swap) {
	const order = []
	for (let i = 1; i <= screenCount; i++) order.push(i)
	if (swap) order.reverse()
	return order
}

/**
 * One main screen + multiview: second physical head for the multiview window (Caspar screen_count still 1).
 * @param {object} config
 * @param {object} cs - casparServer
 * @param {number} screenCount
 * @returns {boolean}
 */
function includeMultiviewSecondHead(config, cs, screenCount) {
	if (screenCount !== 1) return false
	const mvOn = cs.multiview_enabled !== false && cs.multiview_enabled !== 'false'
	const mvSc = multiviewGeneratedConfigIncludesScreen(cs)
	if (!mvOn || !mvSc) return false
	const mvId =
		String(config.multiview_system_id || '').trim() || String(config.screen_2_system_id || '').trim()
	return mvId !== ''
}

/**
 * Applies X11 screen positioning using xrandr.
 * Maps screen_N_system_id (e.g. HDMI-0) to its target resolution and position.
 * Optional screen_N_os_mode / screen_N_os_rate set OS output mode; otherwise derived from casparServer.screen_N_mode.
 * Optional `x11_horizontal_swap`: when true, reverse horizontal placement order.
 * When **one** main Caspar screen + multiview screen consumer, also places `multiview_system_id` (or `screen_2_system_id`)
 * as the second head so both monitors are not cloned.
 * @param {object} config - Unified app config
 */
/**
 * Attempts to find the XAUTHORITY file for the session user.
 */
function getXAuthority() {
	if (process.env.XAUTHORITY) return process.env.XAUTHORITY
	const user = process.env.USER || 'casparcg'
	return `/home/${user}/.Xauthority`
}

/**
 * Calculates target coordinates and dimensions for each GPU head.
 * @param {object} config
 */
function calculateLayoutPositions(config) {
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const screenCount = Math.min(16, Math.max(1, parseInt(String(config.screen_count ?? cs.screen_count ?? 1), 10) || 1))
	const swap = !!(config.x11_horizontal_swap === true || config.x11_horizontal_swap === 'true' || config.x11_horizontal_swap === 1 || config.x11_horizontal_swap === '1')
	
	const allGpuAssignments = new Map()
	const mvAssignments = []
	const explicitScreenAssignments = new Map()
	
	// Collect from legacy config
	for (let n = 1; n <= 8; n++) {
		const sysId = config[`screen_${n}_system_id`]
		if (sysId) {
			allGpuAssignments.set(n, {
				sysId,
				osMode: config[`screen_${n}_os_mode`],
				osBackend: String(config[`screen_${n}_os_backend`] || 'xrandr').trim().toLowerCase(),
				osRate: config[`screen_${n}_os_rate`],
				casparMode: readScreenSetting(config, `screen_${n}_mode`),
				manualX: Number.isFinite(config[`screen_${n}_os_x`]) ? config[`screen_${n}_os_x`] : null,
				manualY: Number.isFinite(config[`screen_${n}_os_y`]) ? config[`screen_${n}_os_y`] : null
			})
		}
	}
	if (config.multiview_system_id) {
		mvAssignments.push({
			sysId: config.multiview_system_id,
			osMode: config.multiview_os_mode,
			osBackend: String(config.multiview_os_backend || 'xrandr').trim().toLowerCase(),
			osRate: config.multiview_os_rate,
			casparMode: cs.multiview_mode,
			manualX: Number.isFinite(config.multiview_os_x) ? config.multiview_os_x : null,
			manualY: Number.isFinite(config.multiview_os_y) ? config.multiview_os_y : null
		})
	}
	
	// Collect from device graph
	const connectors = Array.isArray(config?.deviceGraph?.connectors) ? config.deviceGraph.connectors : []
	const edges = Array.isArray(config?.deviceGraph?.edges) ? config.deviceGraph.edges : []
	const topology = config?.tandemTopology && typeof config.tandemTopology === 'object' ? config.tandemTopology : {}
	const dests = Array.isArray(topology.destinations) ? topology.destinations : []

	connectors.forEach(c => {
		if (c.kind !== 'gpu_out' && c.kind !== 'gpu_output') return
		const sysId = String(c.externalRef || '').trim()
		if (!sysId) return

		// 1. Direct binding on connector
		let binding = c.caspar?.outputBinding
		let mainIndex = c.caspar?.mainIndex
		let inferredFromEdge = false
		let edgeDerivedMode = null
		let edgeDerivedMainIndex = null
		const inEdge = edges.find(e => e.sinkId === c.id)
		if (inEdge) {
			const srcId = String(inEdge.sourceId || '')
			if (srcId.startsWith('dst_in_')) {
				const dstId = srcId.slice('dst_in_'.length)
				const dest = dests.find(d => d.id === dstId)
				if (dest) {
					const dMode = String(dest.mode || 'pgm_prv').toLowerCase()
					if (dMode === 'multiview') {
						edgeDerivedMode = 'multiview'
					} else if (dMode !== 'stream') {
						edgeDerivedMode = 'screen'
						edgeDerivedMainIndex = Math.max(0, parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0)
					}
				}
			}
		}
		
		// 2. Edges are source-of-truth when present (override stale direct bindings).
		if (edgeDerivedMode === 'screen') {
			mainIndex = edgeDerivedMainIndex
			binding = { type: 'screen', index: edgeDerivedMainIndex + 1 }
			inferredFromEdge = true
		} else if (edgeDerivedMode === 'multiview') {
			binding = { type: 'multiview', index: 1 }
			mainIndex = null
			inferredFromEdge = true
		}

		// 3. Legacy infer from edges only when still unresolved.
		if (!binding && mainIndex == null) {
			if (inEdge) {
				const srcId = String(inEdge.sourceId || '')
				if (srcId.startsWith('dst_in_')) {
					const dstId = srcId.slice('dst_in_'.length)
					const dest = dests.find(d => d.id === dstId)
					if (dest) {
						mainIndex = dest.mainScreenIndex
						binding = { type: 'screen', index: (parseInt(mainIndex, 10) || 0) + 1 }
						inferredFromEdge = true
					}
				}
			}
		}

		// Only treat connector as a main screen when explicitly bound to screen,
		// or when legacy mainIndex exists without an explicit binding.
		const isScreenBinding = binding?.type === 'screen'
		const isLegacyMainIndexOnly = !binding && mainIndex != null
		if (isScreenBinding || isLegacyMainIndexOnly) {
			const n = Math.min(16, Math.max(1, parseInt(String(binding?.index ?? (Number(mainIndex) + 1) ?? 1), 10) || 1))
			const assign = {
				sysId,
				osMode: config[`screen_${n}_os_mode`] || c.caspar?.mode,
				osBackend: String(config[`screen_${n}_os_backend`] || c.caspar?.osBackend || 'xrandr').trim().toLowerCase(),
				osRate: config[`screen_${n}_os_rate`] || c.caspar?.refreshHz,
				casparMode: readScreenSetting(config, `screen_${n}_mode`) || c.caspar?.mode,
				manualX: Number.isFinite(config[`screen_${n}_os_x`]) ? config[`screen_${n}_os_x`] : null,
				manualY: Number.isFinite(config[`screen_${n}_os_y`]) ? config[`screen_${n}_os_y`] : null
			}
			allGpuAssignments.set(n, assign)
			if (isScreenBinding || inferredFromEdge) explicitScreenAssignments.set(n, assign)
		} else {
			// Explicit non-screen binding (e.g. multiview) must not leak through stale legacy screen_N_system_id.
			if (binding && binding.type && String(binding.type) !== 'screen') {
				for (const [k, v] of allGpuAssignments.entries()) {
					if (String(v?.sysId || '') === sysId) allGpuAssignments.delete(k)
				}
			}
			// Find if this is a multiviewer output
			let mvIndex = null
			if (binding?.type === 'multiview') {
				mvIndex = parseInt(binding.index, 10) || 1
			} else {
				const inEdge = edges.find(e => e.sinkId === c.id)
				if (inEdge) {
					const srcId = String(inEdge.sourceId || '')
					if (srcId.startsWith('dst_in_')) {
						const dstId = srcId.slice('dst_in_'.length)
						const mvDests = dests.filter(d => String(d.mode || '').toLowerCase() === 'multiview')
						const mvIdx = mvDests.findIndex(d => d.id === dstId)
						if (mvIdx >= 0) {
							mvIndex = mvIdx + 1
						}
					} else if (srcId === 'caspar_mv_out' || c.id === 'caspar_mv_out' || c.label?.toLowerCase().includes('multiview')) {
						mvIndex = 1
					}
				}
			}

			if (mvIndex != null) {
				const n = mvIndex
				if (mvAssignments.some(a => a.sysId === sysId)) return
				mvAssignments.push({ 
					sysId, 
					n,
					osMode: config[`multiview_${n}_os_mode`] || config.multiview_os_mode || c.caspar?.mode, 
					osBackend: String(config[`multiview_${n}_os_backend`] || config.multiview_os_backend || c.caspar?.osBackend || 'xrandr').trim().toLowerCase(), 
					osRate: config[`multiview_${n}_os_rate`] || config.multiview_os_rate || c.caspar?.refreshHz, 
					casparMode: config[`multiview_${n}_mode`] || cs.multiview_mode || c.caspar?.mode, 
					manualX: Number.isFinite(config[`multiview_${n}_os_x`]) ? config[`multiview_${n}_os_x`] : (Number.isFinite(config.multiview_os_x) ? config.multiview_os_x : null), 
					manualY: Number.isFinite(config[`multiview_${n}_os_y`]) ? config[`multiview_${n}_os_y`] : (Number.isFinite(config.multiview_os_y) ? config.multiview_os_y : null) 
				})
			}
		}
	})

	// If graph has explicit screen bindings, they are source-of-truth for screen lanes.
	if (explicitScreenAssignments.size > 0) {
		allGpuAssignments.clear()
		for (const [n, assign] of explicitScreenAssignments.entries()) allGpuAssignments.set(n, assign)
	}

	const placements = []
	const screens = getHorizontalLayoutOrder(screenCount, swap)
	for (const n of screens) placements.push({ kind: 'screen', n })
	mvAssignments.forEach((mv, idx) => placements.push({ kind: 'multiview', n: idx + 1, data: mv }))
	
	// If swap is true, we reverse the WHOLE thing to match user's physical preference
	if (swap) placements.reverse()

	const results = { screens: {}, multiview: {} }
	let cumulativeX = 0
	for (const p of placements) {
		let data = null
		if (p.kind === 'screen') {
			data = allGpuAssignments.get(p.n)
		} else {
			data = p.data
		}
		if (!data || !data.sysId) continue

		const rawOsMode = data.osMode && String(data.osMode).trim()
		let modeForXrandr = rawOsMode || mapCasparModeToXrandrRes(data.casparMode)
		let w = 1920
		let h = 1080
		let hasCasparDims = false
		if (p.kind === 'screen') {
			// Keep xrandr cumulative positioning in sync with the same destination-driven dimensions as Caspar XML generation.
			const topoDims = resolveScreenDimsFromTopology(config, p.n)
			if (topoDims && topoDims.width > 0 && topoDims.height > 0) {
				w = topoDims.width
				h = topoDims.height
				hasCasparDims = true
				// Topology dimensions are source-of-truth for main screen outputs; avoid stale legacy os_mode here.
				modeForXrandr = `${w}x${h}`
			} else {
				const dims = getModeDimensions(String(data.casparMode || ''), config, p.n)
				if (Number.isFinite(dims?.width) && dims.width > 0) {
					w = dims.width
					hasCasparDims = true
				}
				if (Number.isFinite(dims?.height) && dims.height > 0) h = dims.height
			}
		}
		const resMatch = modeForXrandr.match(/^(\d+)x(\d+)/)
		if (resMatch && !hasCasparDims) {
			w = parseInt(resMatch[1], 10) || w
			h = parseInt(resMatch[2], 10) || h
		}
		const posX = data.manualX !== null ? data.manualX : cumulativeX
		const posY = data.manualY !== null ? data.manualY : 0

		const info = {
			sysId: data.sysId,
			x: posX,
			y: posY,
			width: w,
			height: h,
			mode: modeForXrandr,
			rate: data.osRate,
			backend: data.osBackend
		}

		if (p.kind === 'screen') results.screens[p.n] = info
		else results.multiview[p.n] = info

		if (data.manualX === null) cumulativeX += w
	}

	try {
		const screenEntries = Object.entries(results.screens)
		const mvEntries = Object.entries(results.multiview)
		if (screenEntries.length === 0 && mvEntries.length === 0) {
			logger.info('[OS-Config] Layout plan: no assigned outputs')
		} else {
			for (const [idx, info] of screenEntries) {
				logger.info(
					`[OS-Config] Layout screen_${idx}: id=${info.sysId} mode=${info.mode} pos=${info.x},${info.y} size=${info.width}x${info.height} backend=${info.backend}${info.rate != null ? ` rate=${info.rate}` : ''}`
				)
			}
			for (const [idx, info] of mvEntries) {
				logger.info(
					`[OS-Config] Layout multiview_${idx}: id=${info.sysId} mode=${info.mode} pos=${info.x},${info.y} size=${info.width}x${info.height} backend=${info.backend}${info.rate != null ? ` rate=${info.rate}` : ''}`
				)
			}
		}
	} catch (_) {}

	return results
}

/**
 * Applies X11 screen positioning using xrandr or nvidia-settings.
 */
function applyX11Layout(config) {
	logger.info('[OS-Config] applyX11Layout start')
	const layout = calculateLayoutPositions(config)
	const metaModeParts = []
	const xrandrParts = []
	const configuredSysIds = new Set()
	let useNvidia = false
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
			const modeMatch = line.match(/^\s+(\d+x\d+)\b/)
			if (modeMatch) byOut.get(currentOut).add(modeMatch[1])
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
			const mm = String(mode).match(/^(\d+)x(\d+)$/)
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
		if (info.backend === 'nvidia') useNvidia = true
		const avail = availableModesByOutput.get(safeSysId)
		const plannedMode = String(info.mode || '').trim()
		const resolvedMode = pickBestAvailableMode(plannedMode, avail)
		if (resolvedMode && plannedMode && resolvedMode !== plannedMode) {
			logger.warn(
				`[OS-Config] Mode fallback for ${safeSysId}: planned=${plannedMode} unavailable, using=${resolvedMode}`
			)
		}

		const rateSuffix = safeRate != null ? `_${Math.round(safeRate * 100) / 100}` : ''
		metaModeParts.push(`${safeSysId}: ${resolvedMode || info.mode}${rateSuffix} +${info.x}+${info.y}`)
		// Position-only apply is more robust across mixed EDID/custom-mode environments.
		// Output modes are managed separately by the OS/display stack.
		const xPart = `--output ${safeSysId} --pos ${info.x}x${info.y}`
		xrandrParts.push(xPart)
		configuredSysIds.add(safeSysId)
	}

	try {
		xrandrQueryOut = execSync('xrandr --display :0 --query', { env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() } }).toString()
		const parsed = parseOutputModes(xrandrQueryOut)
		for (const [out, modes] of parsed.entries()) availableModesByOutput.set(out, modes)
	} catch (e) { logger.warn(`[OS-Config] Failed to query connected outputs: ${e.message}`) }

	Object.values(layout.screens).forEach(processHead)
	Object.values(layout.multiview).forEach(processHead)

	try {
		const connectedMatches = String(xrandrQueryOut || '').matchAll(/^([A-Za-z0-9._-]+)\s+connected/gm)
		for (const m of connectedMatches) {
			if (!configuredSysIds.has(m[1])) {
				metaModeParts.push(`${m[1]}: NULL`)
				xrandrParts.push(`--output ${m[1]} --off`)
			}
		}
	} catch (e) { logger.warn(`[OS-Config] Failed to process connected outputs list: ${e.message}`) }

	const env = { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() }
	let applied = false
	let persisted = false
	if (useNvidia && metaModeParts.length > 0) {
		try {
			const meta = metaModeParts.join(', ')
			const ncmd = `nvidia-settings --display :0 --assign "CurrentMetaMode=${meta}"`
			logger.info(`[OS-Config] Applying (nvidia): ${ncmd}`)
			const out = execSync(ncmd, { env, encoding: 'utf8' })
			if (out) logger.debug(`[OS-Config] nvidia-settings output: ${out}`)
			applied = true
			persisted = persistLayoutScript(ncmd)
		} catch (e) { 
			logger.error(`[OS-Config] NVIDIA apply failed: ${e.message}`)
			if (e.stderr) logger.error(`[OS-Config] stderr: ${e.stderr}`)
		}
	} else if (xrandrParts.length > 0) {
		try {
			const xcmd = `xrandr --display :0 ${xrandrParts.join(' ')}`
			logger.info(`[OS-Config] Applying (xrandr): ${xcmd}`)
			const out = execSync(xcmd, { env, encoding: 'utf8' })
			if (out) logger.debug(`[OS-Config] xrandr output: ${out}`)
			applied = true
			persisted = persistLayoutScript(xcmd)
		} catch (e) { 
			logger.error(`[OS-Config] xrandr apply failed: ${e.message}`)
			if (e.stderr) logger.error(`[OS-Config] stderr: ${e.stderr}`)
		}
	} else {
		logger.warn('[OS-Config] No xrandr/nvidia outputs to apply')
	}
	logger.info('[OS-Config] applyX11Layout end')
	return { applied, persisted }
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
	getHorizontalLayoutOrder,
	includeMultiviewSecondHead,
}
