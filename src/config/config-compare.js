/**
 * Compare CasparCG INFO CONFIG (running server) with app config expectations.
 * @see companion-module-casparcg-server/src/config-compare.js
 */
'use strict'

const { parseString } = require('xml2js')
const { getChannelMap } = require('./routing')
const { getModeDimensions } = require('./config-generator')
const { pixelSizeForVideoMode, getExtraAudioModeDimensions } = require('./config-modes')
const { multiviewGeneratedConfigIncludesScreen } = require('./multiview-helpers')

/**
 * @param {string} xmlStr - INFO CONFIG XML
 * @returns {Promise<Array<{ index: number, videoMode: string, hasScreen: boolean, hasDecklinkOutput: boolean, screenWidth: number, screenHeight: number, resolutionLabel: string }>>}
 */
function parseServerChannels(xmlStr) {
	return new Promise((resolve) => {
		if (!xmlStr || typeof xmlStr !== 'string') {
			resolve([])
			return
		}
		parseString(xmlStr, (err, result) => {
			if (err || !result) {
				resolve([])
				return
			}
			try {
				const channels = result.configuration?.channels?.[0]?.channel
				if (!Array.isArray(channels)) {
					resolve([])
					return
				}
				const out = channels.map((ch, i) => {
					const vm = ch['video-mode'] && ch['video-mode'][0] != null ? String(ch['video-mode'][0]) : ''
					const cons = ch.consumers?.[0]
					const screens = cons?.screen ? (Array.isArray(cons.screen) ? cons.screen : [cons.screen]) : []
					const decklinks = cons?.decklink
						? Array.isArray(cons.decklink)
							? cons.decklink
							: [cons.decklink]
						: []
					let screenWidth = NaN
					let screenHeight = NaN
					if (screens.length > 0) {
						const s0 = screens[0]
						const wRaw = s0?.width?.[0]
						const hRaw = s0?.height?.[0]
						if (wRaw != null) screenWidth = parseInt(String(wRaw), 10)
						if (hRaw != null) screenHeight = parseInt(String(hRaw), 10)
					}
					if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight)) {
						const px = pixelSizeForVideoMode(vm)
						screenWidth = px.width
						screenHeight = px.height
					}
					// todos03.08: custom modes are NAMED by their resolution ("1728x960") — appending
					// the mode id would print the resolution twice on the test pattern.
					const vmIsResolution = String(vm || '').toLowerCase() === `${screenWidth}x${screenHeight}`
					const resolutionLabel = vm && !vmIsResolution
						? `${screenWidth}×${screenHeight} · ${vm}`
						: `${screenWidth}×${screenHeight}`
					return {
						index: i + 1,
						videoMode: vm,
						hasScreen: screens.length > 0,
						hasDecklinkOutput: decklinks.length > 0,
						screenWidth,
						screenHeight,
						resolutionLabel,
					}
				})
				resolve(out)
			} catch {
				resolve([])
			}
		})
	})
}

/**
 * Expected channels from settings (same order as buildConfigXml).
 * @param {Record<string, unknown>} config
 */
function buildModuleChannelExpectation(config) {
	const cfg = config || {}
	const map = getChannelMap(cfg)
	const screenCount = map.screenCount
	const list = []
	for (let s = 1; s <= screenCount; s++) {
		const modeKey = String(cfg[`screen_${s}_mode`] || '1080p5000')
		const dims = getModeDimensions(modeKey, cfg, s)
		const modeId = dims.modeId
		list.push({ index: (s - 1) * 2 + 1, role: `Screen ${s} program`, videoMode: modeId, hasScreen: true })
		list.push({ index: (s - 1) * 2 + 2, role: `Screen ${s} preview`, videoMode: modeId, hasScreen: false })
	}
	if (map.multiviewCh != null) {
		const mvMode = String(cfg.multiview_mode || '1080p5000')
		const mvHasScreen = multiviewGeneratedConfigIncludesScreen({
			...cfg,
			...(cfg.casparServer && typeof cfg.casparServer === 'object' ? cfg.casparServer : {}),
		})
		list.push({ index: map.multiviewCh, role: 'Multiview', videoMode: mvMode, hasScreen: mvHasScreen })
	}
	// WO-53: one dedicated channel per live input (DeckLink = full mode, ALSA = cheap mode).
	for (const entry of Array.isArray(map.inputChannels) ? map.inputChannels : []) {
		const role =
			entry.kind === 'live_audio'
				? `Live audio input ${entry.slot}`
				: entry.kind === 'v4l2'
					? `V4L2 / USB video input ${entry.slot}`
					: `DeckLink input ${entry.slot}`
		list.push({ index: entry.channel, role, videoMode: String(entry.mode || '1080p5000'), hasScreen: false })
	}
	const extraN = map.audioOnlyChannels?.length ?? 0
	for (let i = 0; i < extraN; i++) {
		const idx = i + 1
		// WO-898: same resolver as the generator (default = tiny audio-only mode, not screen 1's raster).
		const dims = getExtraAudioModeDimensions(cfg, idx)
		const chNum = map.audioOnlyChannels[i]
		list.push({ index: chNum, role: `Extra audio ${idx}`, videoMode: dims.modeId, hasScreen: false })
	}
	return list
}

/**
 * @param {Array} serverChannels
 * @param {Array} moduleChannels
 */
function buildIssues(serverChannels, moduleChannels) {
	const issues = []
	if (!serverChannels.length) {
		issues.push('No server channels parsed (empty INFO CONFIG or not connected yet).')
		return issues
	}
	if (serverChannels.length !== moduleChannels.length) {
		issues.push(
			`Channel count: server ${serverChannels.length} vs app settings ${moduleChannels.length} (screens/multiview/inputs).`
		)
	}
	const n = Math.min(serverChannels.length, moduleChannels.length)
	for (let i = 0; i < n; i++) {
		const s = serverChannels[i]
		const m = moduleChannels[i]
		const sv = (s.videoMode || '').trim()
		const mv = (m.videoMode || '').trim()
		if (sv && mv && sv !== mv) {
			issues.push(`Ch ${s.index} (${m.role}): server "${sv}" ≠ app "${mv}"`)
		}
	}
	return issues
}

/**
 * WO-919 F2: what Apply WOULD write for the loaded project, as parsed channels. Uses the same effective XML as
 * writeCasparConfig (routes-caspar-config.js:125 — manual override, else the generator over the project-derived
 * `ctx.config`), so "Module expects" is the loaded project's layout, not a mirror of the running server.
 * @param {Record<string, unknown>} config - `ctx.config`
 * @returns {Promise<Array>}
 */
function parseExpectedChannels(config) {
	const override = String(config?.casparServer?.casparConfigOverride || '').trim()
	const { buildConfigXml } = require('./config-generator')
	const { buildCasparGeneratorFlatConfig } = require('./build-caspar-generator-config')
	return parseServerChannels(override || buildConfigXml(buildCasparGeneratorFlatConfig(config || {})))
}

/**
 * Pure: expected (project) channels vs running channels. Same-index pairs differ in mode, Caspar screen consumer or
 * DeckLink output; a different channel count is reported once and the common prefix is still compared.
 * @param {Array} serverChannels
 * @param {Array} expected
 */
function compareExpectedToServer(serverChannels, expected) {
	const issues = []
	if (serverChannels.length !== expected.length) {
		issues.push(`Channel count: server ${serverChannels.length} vs loaded project ${expected.length}.`)
	}
	const n = Math.min(serverChannels.length, expected.length)
	for (let i = 0; i < n; i++) {
		const s = serverChannels[i]
		const m = expected[i]
		const sv = (s.videoMode || '').trim()
		const mv = (m.videoMode || '').trim()
		if (sv && mv && sv !== mv) issues.push(`Ch ${s.index}: server "${sv}" ≠ project "${mv}"`)
		if (s.hasScreen !== m.hasScreen) {
			issues.push(`Ch ${s.index}: Caspar screen output is ${s.hasScreen ? 'on' : 'off'}, the project expects ${m.hasScreen ? 'on' : 'off'}`)
		}
		if (s.hasDecklinkOutput !== m.hasDecklinkOutput) {
			issues.push(`Ch ${s.index}: DeckLink output is ${s.hasDecklinkOutput ? 'on' : 'off'}, the project expects ${m.hasDecklinkOutput ? 'on' : 'off'}`)
		}
	}
	return issues
}

/**
 * Compute comparison and store on ctx; optional WebSocket broadcast.
 * @param {object} self - app context (`gatheredInfo`, `config`, `_wsBroadcast`)
 */
function refreshConfigComparison(self) {
	const xml = self.gatheredInfo?.infoConfig || ''
	const settingsExpectation = buildModuleChannelExpectation(self.config || {})

	const done = (serverChannels, expected, expectError) => {
		const serverPhysicalScreens = serverChannels
			.filter((s) => s.hasScreen)
			.map((s) => ({ index: s.index, videoMode: s.videoMode || '' }))

		let moduleChannels
		let issues
		let aligned
		let screensCountMismatch
		let moduleScreenCount
		let hint

		if (serverChannels.length > 0) {
			// WO-919 F2: expectation = the loaded project's layout (what Apply writes), compared with the running one.
			moduleChannels = (expected || []).map((m) => ({
				index: m.index,
				videoMode: m.videoMode,
				hasScreen: m.hasScreen,
				hasDecklinkOutput: m.hasDecklinkOutput,
				role: `Channel ${m.index}`,
				source: 'project',
			}))
			issues = expectError
				? [`Could not build the loaded project's Caspar config: ${expectError}`]
				: compareExpectedToServer(serverChannels, moduleChannels)
			moduleScreenCount = moduleChannels.filter((m) => m.hasScreen).length
			screensCountMismatch = !expectError && serverPhysicalScreens.length !== moduleScreenCount
			aligned = issues.length === 0
			hint = aligned
				? 'The running Caspar config matches what Apply would write for the loaded project.'
				: 'The running CasparCG config differs from the loaded project. Apply (Devices) writes the project layout to Caspar and restarts it.'
		} else {
			moduleChannels = settingsExpectation
			issues = buildIssues(serverChannels, moduleChannels)
			const map = getChannelMap(self.config || {})
			moduleScreenCount = map.screenCount
			screensCountMismatch =
				serverPhysicalScreens.length > 0 &&
				moduleScreenCount > 0 &&
				serverPhysicalScreens.length !== moduleScreenCount
			if (screensCountMismatch) {
				const idx = serverPhysicalScreens.map((s) => s.index).join(', ')
				issues = issues.concat([
					`Screen outputs: Caspar has ${serverPhysicalScreens.length} (ch ${idx}); app is set to ${moduleScreenCount} screen(s).`,
				])
			}
			aligned = false
			hint =
				'To apply app screen settings to CasparCG, use config apply / restart when wired (**T10**), or edit caspar.config.xml on the server.'
		}

		self._configComparison = {
			updatedAt: Date.now(),
			aligned,
			serverChannelCount: serverChannels.length,
			moduleChannelCount: moduleChannels.length,
			serverChannels,
			moduleChannels,
			settingsChannelExpectation: settingsExpectation,
			moduleScreenCount,
			serverPhysicalScreens,
			screensCountMismatch,
			issues,
			serverConfigDriven: serverChannels.length > 0,
			hint,
		}

		if (self._wsBroadcast) {
			self._wsBroadcast('change', { path: 'configComparison', value: self._configComparison })
		}
	}

	if (!xml.trim()) {
		done([])
		return Promise.resolve()
	}

	return parseServerChannels(xml)
		.then(async (serverChannels) => {
			let expected = []
			let expectError = ''
			if (serverChannels.length > 0) {
				try {
					expected = await parseExpectedChannels(self.config)
				} catch (e) {
					expectError = e?.message || String(e)
				}
			}
			done(serverChannels, expected, expectError)
		})
		.catch(() => done([]))
}

module.exports = {
	parseServerChannels,
	compareExpectedToServer,
	buildModuleChannelExpectation,
	refreshConfigComparison,
}
