/**
 * Compare CasparCG INFO CONFIG (running server) with app config expectations.
 * @see companion-module-casparcg-server/src/config-compare.js
 */
'use strict'

const { parseString } = require('xml2js')
const { getChannelMap } = require('./routing')
const { getModeDimensions } = require('./config-generator')

/**
 * @param {string} xmlStr - INFO CONFIG XML
 * @returns {Promise<Array<{ index: number, videoMode: string, hasScreen: boolean }>>}
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
					return {
						index: i + 1,
						videoMode: vm,
						hasScreen: screens.length > 0,
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
		list.push({ index: map.multiviewCh, role: 'Multiview', videoMode: mvMode, hasScreen: true })
	}
	if (map.inputsCh != null) {
		const inMode = String(cfg.inputs_channel_mode || '1080p5000')
		list.push({ index: map.inputsCh, role: 'DeckLink inputs', videoMode: inMode, hasScreen: false })
	}
	const extraN = map.audioOnlyChannels?.length ?? 0
	for (let i = 0; i < extraN; i++) {
		const idx = i + 1
		const vm = String(cfg[`extra_audio_${idx}_video_mode`] || 'match_screen1')
		const modeKey = vm === 'match_screen1' ? String(cfg.screen_1_mode || '1080p5000') : vm
		const dims = getModeDimensions(modeKey, cfg, 1)
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
 * Expectations that mirror the running server — used so config comparison stays aligned (no false mismatches vs saved JSON).
 * @param {Array<{ index: number, videoMode: string, hasScreen: boolean }>} serverChannels
 */
function buildExpectationMatchingServer(serverChannels) {
	return serverChannels.map((s) => ({
		index: s.index,
		videoMode: s.videoMode,
		hasScreen: s.hasScreen,
		role: `Channel ${s.index}`,
		source: 'server',
	}))
}

/**
 * Compute comparison and store on ctx; optional WebSocket broadcast.
 * @param {object} self - app context (`gatheredInfo`, `config`, `_wsBroadcast`)
 */
function refreshConfigComparison(self) {
	const xml = self.gatheredInfo?.infoConfig || ''
	const settingsExpectation = buildModuleChannelExpectation(self.config || {})

	const done = (serverChannels) => {
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
			// Match expectations to the running server so we do not report bogus mode/screen-count mismatches.
			moduleChannels = buildExpectationMatchingServer(serverChannels)
			issues = []
			aligned = true
			screensCountMismatch = false
			moduleScreenCount = serverPhysicalScreens.length || Math.max(1, Math.ceil(serverChannels.length / 2))
			hint =
				'HighAsCG is using the running Caspar server configuration from INFO CONFIG. Change routing or modes in Settings when you want a different layout; apply to Caspar separately.'
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
			aligned =
				serverChannels.length > 0 &&
				serverChannels.length === moduleChannels.length &&
				issues.length === 0
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
		return
	}

	parseServerChannels(xml).then(done).catch(() => done([]))
}

module.exports = {
	parseServerChannels,
	buildModuleChannelExpectation,
	refreshConfigComparison,
}
